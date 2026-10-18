#!/usr/bin/env python3
"""Stream reproducible, browser-importable category ZIPs from an installed resource manifest."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlparse
import zipfile

from resource_packs import canonical, group, RESOURCE_FORMAT, MANIFEST

PACKAGES = {
    "core": ("基础画面包", "地图、棋盘、默认模型、干员与敌人图片、界面和字体", "基础资源", "CORE"),
    "common": ("通用增强包", "官方特效、音效、音乐、个人头像、玩法说明及本土语音", "推荐追加", "ENHANCEMENT"),
    "voice-cn": ("中文语音包", "中文角色语音", "选择一种语音", "CHINESE"),
    "voice-jp": ("日语语音包", "日语角色语音", "选择一种语音", "JAPANESE"),
    "voice-en": ("英语语音包", "英语角色语音", "选择一种语音", "ENGLISH"),
    "voice-kr": ("韩语语音包", "韩语角色语音", "选择一种语音", "KOREAN"),
    "skins": ("干员皮肤包", "已部署皮肤的模型、头像与立绘", "按需追加", "OUTFITS"),
}
CHUNK = 1024 * 1024
MAX_FILE = 24 * CHUNK
MAX_ZIP = 2 * 1024 * CHUNK


def package_id(row):
    if row["tier"] == 1:
        return "core"
    category = group(row)
    if category.startswith("voice_"):
        return category.replace("_", "-")
    return "skins" if category == "skins" else "common"


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def file_digests(path):
    sha1, sha256 = hashlib.sha1(), hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK):
            sha1.update(chunk)
            sha256.update(chunk)
    return sha1.hexdigest(), sha256.hexdigest()


def zip_entry(name, size=0):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_STORED
    info.file_size = size
    return info


def atomic_json(path, document):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    temporary.replace(path)


def build_package(key, files, assets_root, output, previous):
    # Identity excludes the global version, clock and input order. UI updates do not rebuild ZIPs.
    identity = hashlib.sha256(encoded(files)).hexdigest()
    old = next((p for p in previous.get("packages", []) if p["id"] == key and p.get("inputHash") == identity), None)
    if old:
        name = Path(old["url"]).name
        if not re.fullmatch(r"[a-z0-9-]+\.zip", name):
            raise ValueError("Unsafe previous package filename")
        target = output / "files" / name
        source = previous["root"] / "files" / name
        if source.is_file() and source.stat().st_size == old["size"]:
            if not target.exists():
                try:
                    os.link(source, target)
                except OSError:
                    shutil.copyfile(source, target)
            return {**old, "reused": True}
    temporary = output / "files" / ("." + key + ".zip.tmp")
    rows = []
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for index, row in enumerate(files):
                source = (assets_root / unquote(row["url"].lstrip("/"))).resolve()
                if not source.is_relative_to(assets_root.resolve()):
                    raise ValueError("Resource escaped assets root")
                if not source.is_file() or source.stat().st_size != row["size"]:
                    raise ValueError(f"Resource size mismatch: {row['url']}")
                name = f"resources/{index}"
                digest, size = hashlib.sha1(), 0
                with source.open("rb") as stream, archive.open(zip_entry(name, row["size"]), "w") as destination:
                    while chunk := stream.read(CHUNK):
                        size += len(chunk)
                        if size > row["size"]:
                            raise ValueError(f"Resource grew: {row['url']}")
                        digest.update(chunk)
                        destination.write(chunk)
                full = digest.hexdigest()
                if size != row["size"] or full[:12] != row["hash"]:
                    raise ValueError(f"Resource digest mismatch: {row['url']}")
                rows.append({"path": name, **row, "sha1": full})
            document = {"format": RESOURCE_FORMAT, "version": 2,
                        "resourceVersion": hashlib.sha1(encoded(rows)).hexdigest()[:12], "files": rows}
            archive.writestr(zip_entry(MANIFEST), encoded(document))
        if temporary.stat().st_size > MAX_ZIP:
            raise ValueError("ZIP exceeds the browser's 2 GiB import limit")
        sha1, sha256 = file_digests(temporary)
        name = f"{key}-{sha256[:12]}.zip"
        size = temporary.stat().st_size
        temporary.replace(output / "files" / name)
        title, description, badge, micro = PACKAGES[key]
        return dict(id=key, title=title, description=description, badge=badge, micro=micro,
                    count=len(files), bytes=sum(row["size"] for row in files), size=size,
                    url="files/" + name, sha1=sha1, sha256=sha256, inputHash=identity, reused=False)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--assets-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--mirror", action="append", default=[], help="Public HTTPS directory with identical ZIP files")
    args = parser.parse_args(argv)
    for url in args.mirror:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            parser.error("Mirrors must be public HTTPS directories without credentials, query or fragment")
    manifest = json.loads(args.manifest.read_text("utf8"))
    files, seen = [], set()
    for row in manifest["files"]:
        url = canonical(row["url"])
        if url in seen or row["tier"] not in (1, 2) or not isinstance(row.get("size"), int) or not 0 <= row["size"] <= MAX_FILE:
            raise ValueError("Invalid/duplicate resource manifest entry")
        if not re.fullmatch(r"[0-9a-f]{12}", row.get("hash", "")):
            raise ValueError("Downloads require real content fingerprints")
        seen.add(url)
        files.append({"url": url, "size": row["size"], "hash": row["hash"], "tier": row["tier"]})
    files.sort(key=lambda row: row["url"])
    if len(files) > 50000:
        raise ValueError("Resource count exceeds the browser import limit")
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "files").mkdir(exist_ok=True)
    previous_root = args.previous or args.output
    previous_file = previous_root / "downloads.json"
    previous = json.loads(previous_file.read_text("utf8")) if previous_file.exists() else {}
    previous["root"] = previous_root
    packages = []
    for key in PACKAGES:
        selected = [row for row in files if package_id(row) == key]
        if not selected:
            continue
        package = build_package(key, selected, args.assets_root, args.output, previous)
        package["mirrors"] = [base.rstrip("/") + "/" + Path(package["url"]).name for base in args.mirror]
        packages.append(package)
    document = dict(format="stronghold-resource-downloads", version=1, resourceVersion=manifest["version"],
                    generatedAt=datetime.now(timezone.utc).isoformat(), count=len(files),
                    totalBytes=sum(row["size"] for row in files), packages=packages)
    sums = "".join(p["sha256"] + "  " + Path(p["url"]).name + "\n" for p in packages)
    sums_file = args.output / "SHA256SUMS.tmp"
    sums_file.write_text(sums, encoding="ascii")
    sums_file.replace(args.output / "SHA256SUMS")
    atomic_json(args.output / "downloads.json", document)
    print(json.dumps({"version": manifest["version"], "packages": len(packages),
                      "reused": sum(p["reused"] for p in packages),
                      "bytes": sum(p["size"] for p in packages)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

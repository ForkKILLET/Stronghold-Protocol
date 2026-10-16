"""Run with: python -m unittest discover -s test/resources -p resource_delta_test.py"""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "resource_delta", Path(__file__).resolve().parents[2] / "tools/resource_delta.py"
)
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


def package(path, files, version=2, mutate=None, compression=zipfile.ZIP_STORED):
    rows = []
    with zipfile.ZipFile(path, "w", compression=compression) as archive:
        for index, (url, data) in enumerate(files.items()):
            sha1 = hashlib.sha1(data).hexdigest()
            row = {"path": f"resources/{index}", "url": url, "size": len(data), "hash": sha1[:12]}
            row.update({"sha1": sha1} if version == 2 else {"sha256": hashlib.sha256(data).hexdigest()})
            rows.append(row)
            archive.writestr(row["path"], data)
        if mutate:
            mutate(rows)
        archive.writestr(delta.MANIFEST, json.dumps({
            "format": delta.FORMAT, "version": version, "resourceVersion": f"test-v{version}", "files": rows
        }))


class ResourceDeltaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / "base.zip"
        self.target = self.root / "target.zip"
        self.output = self.root / "delta.zip"
        self.report = self.root / "report.json"

    def build(self, **kwargs):
        return delta.build_delta(self.base, self.target, self.output, self.report, **kwargs)

    def test_v1_to_v2_delta_uses_actual_full_digests_and_canonical_brackets(self):
        package(self.base, {
            "/assets/same.png": b"same", "/assets/local/map/fx/[opt]x.png": b"bracket",
            "/assets/changed.png": b"old", "/fonts/gone.woff2": b"gone"
        }, version=1)
        package(self.target, {
            "/assets/same.png": b"same", "/assets/local/map/fx/%5Bopt%5Dx.png": b"bracket",
            "/assets/changed.png": b"new", "/assets/local/map/autochess/tiles.json": b"{}"
        }, compression=zipfile.ZIP_DEFLATED)
        report = self.build()
        self.assertEqual(
            [report["summary"][key]["count"] for key in ("added", "changed", "unchanged", "absentFromTarget")],
            [1, 1, 2, 1]
        )
        self.assertEqual(report["deltaGroups"], {
            "assets": {"count": 1, "bytes": 3},
            "assets/local/map": {"count": 1, "bytes": 2},
        })
        with delta.ResourcePackage(self.output) as archive:
            self.assertEqual(archive.version, 2)
            self.assertEqual(list(archive.verify()), [
                "/assets/changed.png", "/assets/local/map/autochess/tiles.json"
            ])
            self.assertEqual(list(archive.entries), ["resources/0", "resources/1", delta.MANIFEST])
            self.assertTrue(all("sha256" not in row for row in archive.doc["files"]))
        self.assertEqual(json.loads(self.report.read_text())["summary"], report["summary"])

    def test_legacy_target_is_upgraded_to_v2(self):
        package(self.base, {"/assets/a.png": b"old"})
        package(self.target, {"/assets/a.png": b"new"}, version=1)
        self.build()
        with delta.ResourcePackage(self.output) as archive:
            self.assertEqual(archive.version, 2)
            self.assertEqual(archive.verify()["/assets/a.png"]["sha1"], hashlib.sha1(b"new").hexdigest())

    def test_identical_content_and_missing_files_do_not_make_empty_zip(self):
        package(self.base, {"/assets/a.png": b"a", "/assets/b.png": b"b"}, version=1)
        package(self.target, {"/assets/a.png": b"a"})
        report = self.build()
        self.assertEqual(report["summary"]["delta"]["count"], 0)
        self.assertEqual(report["summary"]["absentFromTarget"]["count"], 1)
        self.assertIsNone(report["output"])
        self.assertFalse(self.output.exists())
        self.assertTrue(self.report.exists())

    def test_analysis_only_writes_report_not_zip(self):
        package(self.base, {"/assets/a.png": b"old"})
        package(self.target, {"/assets/a.png": b"new"})
        self.assertEqual(self.build(analyze_only=True)["summary"]["changed"]["count"], 1)
        self.assertFalse(self.output.exists())

    def test_scene_allowlist_and_png_to_webp_upgrade_preserve_unchanged_binaries(self):
        package(self.base, {"/assets/a.png": b"png", "/assets/a.skel": b"skeleton"}, version=1)
        package(self.target, {"/assets/a.webp": b"webp", "/assets/a.skel": b"skeleton",
                              "/assets/local/scene/act2autochess_m04/scene.json": b"{}"})
        report = self.build()
        self.assertEqual(report["summary"]["added"]["count"], 2)
        self.assertEqual(report["summary"]["unchanged"]["count"], 1)
        self.assertEqual(report["summary"]["absentFromTarget"]["count"], 1)
        with delta.ResourcePackage(self.output) as archive:
            self.assertEqual(list(archive.verify()), [
                "/assets/a.webp", "/assets/local/scene/act2autochess_m04/scene.json"])
        for path in ("/assets/local/scene/custom/scene.json",
                     "/assets/local/scene/act2autochess_m05/scene.json",
                     "/assets/local/scene/act1autochess_m01/config.json"):
            with self.assertRaises(ValueError):
                delta.canonical_resource_path(path)

    def test_checks_all_input_digests_including_unchanged_and_absent_resources(self):
        for side, version in (("base", 1), ("target", 2)):
            with self.subTest(side=side):
                package(self.base, {"/assets/a.png": b"same", "/assets/absent.png": b"absent"}, version=1)
                package(self.target, {"/assets/a.png": b"same"})
                path = self.base if side == "base" else self.target
                package(path, {"/assets/a.png": b"same"}, version=version,
                        mutate=lambda rows: rows[0].update({
                            "sha256": "0" * 64
                        } if version == 1 else {"sha1": rows[0]["hash"] + "0" * 28}))
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    self.build()
                self.assertFalse(self.output.exists())
                self.assertFalse(self.report.exists())

    def test_crc_corruption_is_rejected(self):
        package(self.base, {"/assets/a.png": b"abc"})
        package(self.target, {"/assets/a.png": b"new"})
        data = bytearray(self.target.read_bytes())
        with zipfile.ZipFile(self.target) as archive:
            info = archive.getinfo("resources/0")
            offset = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        data[offset] ^= 1
        self.target.write_bytes(data)
        with self.assertRaises(zipfile.BadZipFile):
            self.build()
        self.assertFalse(self.output.exists())

    def test_invalid_rows_and_legacy_without_sha256_are_rejected(self):
        mutations = [
            lambda rows: rows[0].update(url="/assets/../data.png"),
            lambda rows: rows[0].update(url="/assets/%2e%2e/data.png"),
            lambda rows: rows[0].update(url="/assets/%zz.png"),
            lambda rows: rows[0].update(url="/assets/game.json"),
            lambda rows: rows[0].update(url="/build/assets/app.png"),
            lambda rows: rows[0].update(size=True),
            lambda rows: rows[0].pop("sha256"),
        ]
        package(self.base, {"/assets/a.png": b"a"})
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                package(self.target, {"/assets/a.png": b"a"}, version=1, mutate=mutate)
                with self.assertRaises(ValueError):
                    self.build()
                self.assertFalse(self.output.exists())

    def test_normalized_duplicate_resource_urls_are_rejected(self):
        package(self.base, {"/assets/a.png": b"a"})
        package(self.target, {"/assets/[x].png": b"x", "/assets/%5Bx%5D.png": b"x"})
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.build()

    def test_no_overwrite_or_input_output_alias(self):
        package(self.base, {"/assets/a.png": b"old"})
        package(self.target, {"/assets/a.png": b"new"})
        original = self.base.read_bytes()
        with self.assertRaises(ValueError):
            delta.build_delta(self.base, self.target, self.base, self.report)
        with self.assertRaises(ValueError):
            delta.build_delta(self.base, self.target, self.output, self.target)
        self.output.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            self.build()
        self.assertEqual(self.output.read_bytes(), b"existing")
        self.assertEqual(self.base.read_bytes(), original)

    def test_incomplete_output_is_removed(self):
        with self.assertRaises(RuntimeError):
            with delta.exclusive_output(self.output, "xb") as stream:
                stream.write(b"partial")
                raise RuntimeError("interrupted")
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()

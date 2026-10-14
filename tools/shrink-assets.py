#!/usr/bin/env python3
"""Prepare a dual-format resource release. See docs/ASSET_SHRINK.md.

Dry-run by default. PNGs, original atlases and uncompressed binaries stay reachable.
Use --output <new-directory> --apply to work on a private candidate, not live assets.
Audio is opt-in (the audio command only), never part of "all".
Python 3.10+, Pillow; optional brotli, ffmpeg/ffprobe for the audio command.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit, urlunsplit

REPO = Path(__file__).resolve().parent.parent
ROOT = REPO
ASSETS = ROOT / 'public' / 'assets'
DATA = ROOT / 'data'
ORIG = ROOT / '.cache' / 'asset-shrink-backups'
STATE_FILE = '.cache/asset-shrink-state.json'
POLICY_VERSION = 1
LOSSY = dict(lossless=False, quality=95, method=5, alpha_quality=100, exact=False)
LOSSLESS = dict(lossless=True, quality=100, method=5, exact=True)
GUIDE_LOSSY = dict(LOSSY, quality=90, method=4)
BR_EXTENSIONS = ('.skel', '.atlas', '.bin')
DATA_NAME = re.compile(
    r'(?:^lm\d+$|_(?:n|m|e)(?:_|$)|normal|rough|mask|metallic|gloss|occlusion|'
    r'smoothwaves|waternoise|water_normal|noise|caustic)', re.I)


def log(message):
    print(message, flush=True)


def configure(root):
    global ROOT, ASSETS, DATA, ORIG
    ROOT = Path(root).resolve()
    ASSETS = ROOT / 'public' / 'assets'
    DATA = ROOT / 'data'
    ORIG = ROOT / '.cache' / 'asset-shrink-backups'


def inside(path, root):
    path = Path(path)
    if not path.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError(f'Path escapes its resource tree: {path}')
    return path


def rel(path):
    return '/' + inside(path, ROOT / 'public').relative_to(ROOT / 'public').as_posix()


def sha1(data):
    return hashlib.sha1(data).hexdigest()


def short_hash(value):
    return sha1(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))[:12]


def read_json(path, default=None):
    inside(path, ROOT)
    return json.loads(path.read_text('utf-8')) if path.is_file() else default


def backup(path, orig_root):
    """Copy before replacement, keyed by exact bytes. No original is moved or deleted."""
    source = inside(path, ROOT)
    destination = Path(orig_root) / source.relative_to(ROOT)
    destination = destination.with_name(destination.name + '.' + sha1(source.read_bytes()))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        with destination.open('xb') as out, source.open('rb') as inp:
            shutil.copyfileobj(inp, out)
    return destination


def atomic_write(path, data, orig_root=None):
    path = inside(path, ROOT)
    if path.is_file() and path.read_bytes() == data:
        return False
    if path.exists() and orig_root is not None:
        backup(path, orig_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.shrink-', delete=False) as stream:
        tmp = Path(stream.name)
        stream.write(data)
    try:
        os.replace(tmp, path)
        # NamedTemporaryFile is 0600 by default. The Node container runs as
        # the non-root `node` user, so generated public data must be readable
        # after Docker COPY/bind-mount deployment.
        try:
            os.chmod(path, 0o644)
        except OSError:
            pass
    finally:
        tmp.unlink(missing_ok=True)  # only our temporary file, never original resources
    return True


def json_bytes(doc, pretty=False):
    options = {'indent': 2} if pretty else {'separators': (',', ':')}
    return (json.dumps(doc, ensure_ascii=False, **options) + '\n').encode('utf-8')


def file_for_url(url):
    """Map site/CDN-prefix resource identity to a contained local path."""
    parsed = urlsplit(url)
    if parsed.scheme not in ('', 'http', 'https') or parsed.query or parsed.fragment:
        raise ValueError(f'Unsupported resource URL: {url}')
    value = unquote(parsed.path, errors='strict')
    match = re.search(r'/(?:assets|fonts)/', value)
    if not match or '\\' in value or any(ord(c) < 32 for c in value):
        raise ValueError(f'Unsafe resource URL: {url}')
    value = value[match.start():]
    if any(part in ('', '.', '..') for part in value[1:].split('/')):
        raise ValueError(f'Unsafe resource URL: {url}')
    return inside(ROOT / 'public' / value.lstrip('/'), ROOT / 'public')


def emoticon(path):
    return '/emoticon/' in str(path).replace('\\', '/').lower()


def local_metadata():
    doc = read_json(DATA / 'local-assets.json', {})
    out = {}
    for group in (doc.get('groups') or {}).values():
        for entry in (group or {}).values():
            if isinstance(entry, dict) and isinstance(entry.get('path'), str):
                out[rel(file_for_url(entry['path'])).rsplit('.', 1)[0]] = entry
    return out


def policy_for(path, metadata=None):
    identity = str(path).replace('\\', '/')
    entry = (metadata or {}).get(identity.rsplit('.', 1)[0], {})
    kind = str(entry.get('kind', '')).lower()
    derived = str(entry.get('derive', '')).lower()
    data_map = kind in {'lightmap', 'normal', 'mask', 'roughness', 'metallic'} or any(
        word in derived for word in ('normal', 'rough', 'mask', 'light', 'gloss'))
    lossless = ('/spine/' in identity.lower() or data_map or entry.get('webp') == 'lossless'
                or ('/local/map/' in identity.lower() or '/local/scene/' in identity.lower())
                and DATA_NAME.search(Path(identity).stem))
    if lossless:
        return 'lossless', LOSSLESS
    if '/guide/' in identity.lower():
        return 'lossy', GUIDE_LOSSY  # existing approved tutorial policy
    return 'lossy', LOSSY


def image_rgba(path_or_data):
    from PIL import Image
    source = io.BytesIO(path_or_data) if isinstance(path_or_data, bytes) else path_or_data
    with Image.open(source) as image:
        image.load()
        return image.convert('RGBA')


def validate_webp(source, encoded, mode):
    """Validate dimensions/alpha, and exact RGBA including invisible RGB for data pages."""
    from PIL import Image
    with Image.open(io.BytesIO(encoded)) as check:
        if check.format != 'WEBP':
            raise ValueError('Not a WebP image')
        decoded = check.convert('RGBA')
    if source.size != decoded.size or source.getchannel('A').tobytes() != decoded.getchannel('A').tobytes():
        raise ValueError('WebP changed image dimensions or alpha')
    if mode == 'lossless' and source.tobytes() != decoded.tobytes():
        raise ValueError('Lossless WebP changed RGBA (including transparent RGB)')


def state_doc():
    state = read_json(ROOT / STATE_FILE, {'version': POLICY_VERSION, 'files': {}})
    if state.get('version') != POLICY_VERSION or not isinstance(state.get('files'), dict):
        raise ValueError('Unsupported compression-state file')
    return state


def convert_webp(apply, orig_root, limit=None, include_emoticons=False):
    if include_emoticons:
        raise ValueError('Emoticon conversion is unsupported: fixed runtime PNG paths must remain')
    from PIL import features
    if not features.check('webp'):
        raise ValueError('Pillow has no WebP codec')
    metadata, state = local_metadata(), state_doc()
    targets = sorted(p for p in ASSETS.rglob('*.png') if not emoticon(p))
    if limit is not None:
        targets = targets[:limit]
    stats = collections.Counter()
    errors, kept = [], []
    for i, source in enumerate(targets, 1):
        url = rel(source)
        try:
            raw = source.read_bytes()
            mode, opts = policy_for(url, metadata)
            dest = source.with_suffix('.webp')
            previous = state['files'].get(url, {})
            source_hash = sha1(raw)
            if (previous.get('sourceSha1') == source_hash and previous.get('policy') == mode
                    and previous.get('options') == opts and dest.is_file()
                    and previous.get('targetSha1') == sha1(dest.read_bytes())):
                stats['fresh'] += 1
                continue
            # convert('RGBA') also retains RGB+tRNS and palette transparency.
            image = image_rgba(raw)
            stream = io.BytesIO()
            image.save(stream, 'WEBP', **opts)
            encoded = stream.getvalue()
            validate_webp(image, encoded, mode)
            if len(encoded) >= len(raw) and not dest.is_file():
                stats['kept_png'] += 1
                kept.append(url)
                continue
            if apply:
                atomic_write(dest, encoded, orig_root)
                state['files'][url] = {'sourceSha1': source_hash, 'targetSha1': sha1(encoded),
                                       'policy': mode, 'options': opts}
            stats['converted'] += 1
            stats[mode] += 1
            stats['png_bytes'] += len(raw)
            stats['webp_bytes'] += len(encoded)
        except (OSError, ValueError) as error:
            errors.append({'url': url, 'error': str(error)})
        if i % 500 == 0:
            log(f'  .. {i}/{len(targets)}')
    # Record proven progress even on an error; main will stop before manifest rewrite.
    if apply:
        atomic_write(ROOT / STATE_FILE, json_bytes(state), orig_root)
    return dict(stats) | {'errors': errors, 'kept': kept}


def usable_webp(source, metadata, state):
    dest = source.with_suffix('.webp')
    if not dest.is_file() or emoticon(source) or not source.is_file():
        return False
    row = state['files'].get(rel(source), {})
    mode, opts = policy_for(rel(source), metadata)
    raw, encoded = source.read_bytes(), dest.read_bytes()
    if (row.get('sourceSha1') != sha1(raw) or row.get('targetSha1') != sha1(encoded)
            or row.get('policy') != mode or row.get('options') != opts):
        return False
    validate_webp(image_rgba(raw), encoded, mode)
    return True


def atlas_pages(text):
    lines = text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    new_page, out = True, []
    for i, line in enumerate(lines):
        if not line.strip():
            new_page = True
        elif new_page:
            out.append((i, line.strip()))
            new_page = False
    return out


def rewrite_atlases(apply, dirs=None, orig_root=None):
    """Create *.webp.atlas siblings, retaining original atlas URLs for old clients."""
    metadata, state = local_metadata(), state_doc()
    pages = files = 0
    todo = dirs if dirs is not None else sorted({p.parent for p in ASSETS.rglob('*.atlas')})
    for directory in todo:
        for atlas in sorted(directory.glob('*.atlas')):
            if atlas.name.endswith('.webp.atlas'):
                continue
            encoded, count = atlas_variant(atlas, metadata, state)
            if count:
                pages += count
                files += 1
                if apply:
                    atomic_write(atlas.with_suffix('.webp.atlas'), encoded, orig_root or ORIG)
    return {'pages': pages, 'files': files}


def atlas_variant(atlas, metadata, state):
    text = atlas.read_text('utf-8')
    lines = text.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    count = 0
    for index, name in atlas_pages(text):
        page = inside(atlas.parent / name, atlas.parent)
        if page.suffix.lower() == '.png' and usable_webp(page, metadata, state):
            lines[index] = name[:-4] + '.webp'
            count += 1
    return '\n'.join(lines).encode('utf-8'), count


def rewrite_manifest(apply, skip_emoticon=True, orig_root=None):
    if not skip_emoticon:
        raise ValueError('Fixed emoticon PNG URLs cannot be migrated')
    metadata, state = local_metadata(), state_doc()
    stats, memo = collections.Counter(), {}
    def url(value):
        if not isinstance(value, str):
            return value
        parsed = urlsplit(value)
        if not re.search(r'/(assets|fonts)/', parsed.path):
            return value
        source = file_for_url(value)
        suffix = source.suffix.lower()
        if suffix not in ('.png', '.atlas') or source.name.endswith('.webp.atlas') or emoticon(source):
            return value
        if suffix == '.png':
            if source not in memo:
                memo[source] = usable_webp(source, metadata, state)
            allowed = memo[source]
            new_path = parsed.path[:-4] + '.webp'
        else:
            candidate = source.with_suffix('.webp.atlas')
            allowed = candidate.is_file()
            if allowed:
                expected, count = atlas_variant(source, metadata, state)
                allowed = count > 0 and candidate.read_bytes() == expected
                for _, page in atlas_pages(candidate.read_text('utf-8')):
                    if not inside(candidate.parent / page, candidate.parent).is_file():
                        raise ValueError(f'Missing atlas page: {candidate}: {page}')
            new_path = parsed.path[:-6] + '.webp.atlas'
        if allowed:
            stats['urls'] += 1
            return urlunsplit((parsed.scheme, parsed.netloc, new_path, parsed.query, parsed.fragment))
        return value

    def walk(node):
        if isinstance(node, dict):
            group, result = node.get('group'), {}
            for key, value in node.items():
                if isinstance(group, str) and key in ('atlas', 'textures'):
                    def local_name(name):
                        if not isinstance(name, str) or '/' in name:
                            return walk(name)
                        original = f'/assets/local/{group}/{name}'
                        rewritten = url(original)
                        if rewritten != original:
                            stats['spine_pages'] += 1
                        return rewritten.rsplit('/', 1)[-1]
                    result[key] = [local_name(n) for n in value] if isinstance(value, list) else local_name(value)
                else:
                    result[key] = walk(value)
            return result
        if isinstance(node, list):
            return [walk(value) for value in node]
        return url(node) if isinstance(node, str) else node

    assets_file = DATA / 'assets.json'
    doc = read_json(assets_file)
    if not isinstance(doc, dict):
        raise ValueError('Missing/invalid data/assets.json')
    body = {k: v for k, v in doc.items() if k not in ('version', 'hash', 'generator', 'stats')}
    if short_hash(body) != doc.get('hash'):
        raise ValueError('Cannot reproduce data/assets.json hash; refusing to rewrite')
    new_body, new_doc = walk(body), dict(doc)
    new_doc.update(new_body)
    new_doc['hash'] = short_hash(new_body)
    paths = set()
    def collect(node):
        if isinstance(node, str) and re.search(r'/(assets|fonts)/', node):
            paths.add(file_for_url(node))
        elif isinstance(node, (list, dict)):
            for item in node.values() if isinstance(node, dict) else node:
                collect(item)
    collect(new_body)
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        raise ValueError(f'Missing manifest files (first 5): {missing[:5]}')
    new_doc['stats'] = dict(doc.get('stats') or {}, files=len(paths),
                            bytes=sum(p.stat().st_size for p in paths))
    local_file = DATA / 'local-assets.json'
    local = read_json(local_file)
    if local is not None:
        for group in (local.get('groups') or {}).values():
            for entry in (group or {}).values():
                if not isinstance(entry, dict) or not isinstance(entry.get('path'), str):
                    continue
                old = entry['path']
                entry['path'] = url(old)
                path = file_for_url(entry['path'])
                if not path.is_file():
                    raise ValueError(f'Missing local resource: {old}')
                # A previously switched WebP cannot silently change after it was
                # verified by the conversion step.
                if path.suffix == '.webp':
                    source = path.with_suffix('.png')
                    row = state['files'].get(rel(source))
                    if row and not usable_webp(source, metadata, state):
                        raise ValueError(f'Conversion record no longer matches {path}')
                entry['hash'] = sha1(path.read_bytes())[:12]
                if old != entry['path']:
                    stats['local'] += 1
                if path.suffix == '.webp':
                    row = state['files'].get(rel(path.with_suffix('.png')))
                    if row and row.get('targetSha1') == sha1(path.read_bytes()):
                        entry['webp'] = row['policy']
        # spineLocal references bare file names; provide the new atlas identity.
        for group_name, group in (local.get('groups') or {}).items():
            if not group_name.startswith('spine/'):
                continue
            for entry in list((group or {}).values()):
                if isinstance(entry, dict) and str(entry.get('path', '')).endswith(('.webp.atlas', '.webp')):
                    group[Path(entry['path']).name] = dict(entry)
    # Validate both documents before replacing either. Backups are content-addressed.
    if apply:
        atomic_write(assets_file, json_bytes(new_doc), orig_root or ORIG)
        if local is not None:
            atomic_write(local_file, json_bytes(local), orig_root or ORIG)
    return dict(stats)


def probe_audio(path):
    proc = subprocess.run(['ffprobe', '-v', 'error', '-of', 'json', '-show_streams', str(path)],
                          capture_output=True, check=True, timeout=30)
    audio = [row for row in json.loads(proc.stdout)['streams'] if row.get('codec_type') == 'audio']
    if len(audio) != 1:
        raise ValueError('Expected one audio stream')
    return audio[0]


def reencode_audio(apply, orig_root, bitrate='48k', only_mono=True, limit=None):
    if bitrate != '48k' or not only_mono:
        raise ValueError('Only opt-in 48k mono audio is supported')
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise ValueError('Audio conversion requires ffmpeg and ffprobe')
    stats, errors = collections.Counter(), []
    targets = sorted(ASSETS.rglob('*.mp3'))
    if limit is not None:
        targets = targets[:limit]
    for path in targets:
        try:
            info = probe_audio(path)
            if (info.get('channels') != 1 or not re.search(r'/audio/(?:voice|sfx)/', rel(path))):
                stats['skipped_stereo_or_bgm'] += 1
                continue
            if int(info.get('bit_rate') or 0) <= 48000:
                stats['already_small'] += 1
                continue
            with tempfile.TemporaryDirectory(prefix='sp-audio-') as tmp:
                dest = Path(tmp) / 'encoded.mp3'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-map', '0:a:0',
                                '-c:a', 'libmp3lame', '-b:a', bitrate, '-ac', '1', str(dest)],
                               check=True, timeout=120)
                encoded_info = probe_audio(dest)
                if encoded_info.get('channels') != 1:
                    raise ValueError('Encoded audio is not mono')
                if info.get('sample_rate') != encoded_info.get('sample_rate'):
                    raise ValueError('Encoded audio changed sample rate')
                if abs(float(info.get('duration') or 0) - float(encoded_info.get('duration') or 0)) > 0.1:
                    raise ValueError('Encoded audio changed duration')
                encoded = dest.read_bytes()
            before = path.stat().st_size
            if len(encoded) >= before:
                stats['kept'] += 1
                continue
            if apply:
                atomic_write(path, encoded, orig_root)
            stats['converted'] += 1
            stats['before'] += before
            stats['after'] += len(encoded)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            errors.append({'url': rel(path), 'error': str(error)})
    return dict(stats) | {'errors': errors}


def make_br(apply, drop_raw=False, orig_root=None, quality=5):
    if drop_raw:
        raise ValueError('--drop-raw is unsafe: identity, Range, setup and fingerprints need raw files')
    try:
        import brotli
        extension = '.br'
        compress = lambda data: brotli.compress(data, quality=quality)
        decompress = brotli.decompress
    except ImportError:
        extension = '.gz'
        compress = lambda data: gzip.compress(data, compresslevel=6, mtime=0)
        decompress = gzip.decompress
    stats = collections.Counter()
    for path in sorted(p for p in ASSETS.rglob('*') if p.suffix.lower() in BR_EXTENSIONS):
        raw = path.read_bytes()
        sidecar = path.with_name(path.name + extension)
        if sidecar.is_file() and sidecar.stat().st_mtime_ns >= path.stat().st_mtime_ns:
            try:
                if decompress(sidecar.read_bytes()) == raw:
                    stats['fresh'] += 1
                    continue
            except Exception:
                pass
        encoded = compress(raw)
        if decompress(encoded) != raw:
            raise ValueError(f'Compressed bytes failed verification: {path}')
        if apply:
            atomic_write(sidecar, encoded, orig_root or ORIG)
        stats['converted'] += 1
        stats['raw'] += len(raw)
        stats['packed'] += len(encoded)
    return dict(stats) | {'encoding': extension[1:]}


def dedupe(apply=False):
    if apply:
        raise ValueError('Dedupe is report-only; no directory entries are removed')
    hashes = set()
    count = saved = 0
    for path in ASSETS.rglob('*'):
        if path.is_file():
            digest = sha1(path.read_bytes())
            if digest in hashes:
                count += 1
                saved += path.stat().st_size
            else:
                hashes.add(digest)
    return {'duplicates': count, 'saved_bytes': saved}


def verify():
    counts, sizes = collections.Counter(), collections.Counter()
    for path in ASSETS.rglob('*'):
        if path.is_file():
            inside(path, ASSETS)
            counts[path.suffix.lower()] += 1
            sizes[path.suffix.lower()] += path.stat().st_size
    return {'files': sum(counts.values()), 'bytes': sum(sizes.values()),
            'by_ext': {key: {'n': counts[key], 'bytes': sizes[key]} for key in sorted(sizes)}}


def prepare_candidate(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or output.is_relative_to(source / 'public') or source.is_relative_to(output):
        raise ValueError('Candidate must not overlap source/public or contain the source')
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite candidate: {output}')
    for directory in (source / 'public' / 'assets', source / 'public' / 'fonts'):
        for path in directory.rglob('*'):
            inside(path, directory)
    for name in ('assets.json', 'local-assets.json', 'asset-hashes.json'):
        inside(source / 'data' / name, source / 'data')
    output.mkdir(parents=True)
    for directory in ('public/assets', 'public/fonts'):
        if (source / directory).is_dir():
            shutil.copytree(source / directory, output / directory)
    (output / 'data').mkdir()
    for name in ('assets.json', 'local-assets.json', 'asset-hashes.json'):
        path = source / 'data' / name
        if path.is_file():
            shutil.copy2(path, output / 'data' / name)
    if (source / STATE_FILE).is_file():
        inside(source / STATE_FILE, source)
        (output / STATE_FILE).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / STATE_FILE, output / STATE_FILE)


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['verify', 'webp', 'atlas', 'manifest', 'audio', 'br', 'dedupe', 'all'])
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--root', type=Path, default=REPO, help='Private candidate root for subsequent phases')
    parser.add_argument('--output', type=Path, help='Copy resource trees/manifests to a new candidate first')
    parser.add_argument('--in-place', action='store_true', help='Explicit opt-in for source-root changes (not live-safe)')
    parser.add_argument('--orig', type=Path, help='Backup directory, outside public/; defaults to candidate .cache/')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--bitrate', default='48k')
    parser.add_argument('--drop-raw', action='store_true', help='Refused; retain identity/Range files')
    parser.add_argument('--include-emoticons', action='store_true', help='Refused; retain runtime PNG paths')
    parser.add_argument('--json', type=Path, help='Write report (the only optional dry-run write)')
    parser.add_argument('--node', default='node', help='Node 22+ for final fingerprint generation')
    args = parser.parse_args(argv)
    report = {'apply': args.apply, 'source': str(args.root.resolve()), 'errors': []}
    try:
        if args.drop_raw or args.include_emoticons:
            raise ValueError('Raw removal and emoticon conversion are unsupported')
        if args.limit is not None and args.limit <= 0:
            raise ValueError('--limit must be positive')
        if args.output and not args.apply:
            raise ValueError('--output requires --apply; dry-run does not copy resource trees')
        if args.json:
            report_path = args.json.resolve()
            for root in (args.root.resolve(), args.output.resolve() if args.output else args.root.resolve()):
                if (report_path.is_relative_to(root / 'public') or report_path.is_relative_to(root / 'data')
                        or report_path == root / STATE_FILE):
                    raise ValueError('Report cannot overwrite resource trees, manifests or conversion state')
        if args.apply and not args.output and args.root.resolve() == REPO and not args.in_place:
            raise ValueError('Use --output <new candidate> or explicitly opt in with --in-place')
        if args.output:
            prepare_candidate(args.root, args.output)
        configure(args.output or args.root)
        orig = (args.orig or ORIG).resolve()
        if orig.is_relative_to((ROOT / 'public').resolve()) or orig == ROOT:
            raise ValueError('Backups must be outside public/ and not the resource root')
        report['root'] = str(ROOT)
        steps = ['verify', 'webp', 'atlas', 'manifest', 'br'] if args.command == 'all' else [args.command]
        for command in steps:
            if command == 'verify':
                result = verify()
            elif command == 'webp':
                result = convert_webp(args.apply, orig, args.limit)
            elif command == 'atlas':
                result = rewrite_atlases(args.apply, orig_root=orig)
            elif command == 'manifest':
                result = rewrite_manifest(args.apply, orig_root=orig)
            elif command == 'audio':
                if ROOT == REPO and args.apply:
                    raise ValueError('Audio is candidate-only: do not overwrite live same-URL audio')
                result = reencode_audio(args.apply, orig, args.bitrate, limit=args.limit)
            elif command == 'br':
                result = make_br(args.apply, orig_root=orig)
            else:
                result = dedupe(args.apply)
            report[command] = result
            log(f'{command}: {json.dumps(result, ensure_ascii=False)}')
            if result.get('errors'):
                raise ValueError(f'{command} failed; later phases were not started')
        if args.apply and args.command in ('manifest', 'all', 'audio'):
            subprocess.run([args.node, str(REPO / 'tools' / 'asset-hashes.mjs'), '--root', str(ROOT)],
                           check=True)
        if not args.apply:
            log('Dry-run: resources and manifests unchanged.')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        report['errors'].append(str(error))
        log(f'Error: {error}')
    # A forbidden report target must not be written even when option validation failed.
    report_safe = args.json and not any(
        args.json.resolve().is_relative_to(root / directory)
        for root in (args.root.resolve(), args.output.resolve() if args.output else args.root.resolve())
        for directory in ('public', 'data')
    ) and args.json.resolve() not in {args.root.resolve() / STATE_FILE,
                                     (args.output.resolve() if args.output else args.root.resolve()) / STATE_FILE}
    if report_safe:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_bytes(json_bytes(report, pretty=True))
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

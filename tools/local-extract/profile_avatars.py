"""Export only the official dynamic-avatar bundle for offline browser rendering (UnityPy/Pillow environment)."""
import argparse
import hashlib
import json
import re
from pathlib import Path


def extract(game, out):
    import aklz4  # noqa: F401: register the official bundle decoder
    import UnityPy
    bundle = Path(game) / 'arts/dynavatars_0.ab'
    raw = bundle.read_bytes()
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Unexpectedly large avatar bundle')
    env = UnityPy.load(raw)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    clips = {}
    for obj in env.objects:
        if obj.type.name not in ('TextAsset', 'Texture2D', 'Sprite', 'AnimationClip'):
            continue
        d = obj.read()
        name = d.m_Name
        if obj.type.name == 'TextAsset' and name.startswith(('assets_avatar_dyn_', 'assets_spine_avatar_dyn_')):
            if not re.fullmatch(r'assets_(?:spine_)?avatar_dyn_0[1-8](?:\.atlas)?', name):
                raise ValueError('Unexpected avatar resource name')
            target = name if name.endswith('.atlas') else name + '.json'
            (out / target).write_bytes(d.m_Script.encode('utf-8', 'surrogateescape'))
        elif obj.type.name == 'Texture2D' and name.startswith(('assets_avatar_dyn_', 'assets_spine_avatar_dyn_')):
            d.image.save(out / (name + '.png'))
        elif obj.type.name == 'Sprite' and name.startswith(('dog_sequence_', 'cat_sequence_')):
            d.image.save(out / (name + '.png'))
        elif obj.type.name == 'AnimationClip' and name in ('avatar_dyn_05', 'avatar_dyn_06'):
            tree = obj.read_typetree()
            clips[name] = {'duration': max(tree['m_MuscleClip']['m_StopTime'], max(k['time'] for c in tree['m_FloatCurves'] for k in c['curve']['m_Curve'])), 'curves': [
                {'path': c['path'], 'keys': [{'time': k['time'], 'value': k['value']} for k in c['curve']['m_Curve']]}
                for c in tree['m_FloatCurves'] if c['attribute'] == 'm_Alpha'
            ]}
    metadata = {'bundle': 'arts/dynavatars_0.ab', 'bundleSha256': hashlib.sha256(raw).hexdigest(), 'clips': clips}
    (out / 'source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', required=True, help='Resolved Windows AB root')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    extract(args.game, args.out)

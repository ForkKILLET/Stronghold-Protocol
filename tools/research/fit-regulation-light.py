"""Bounded, display-space scene calibration from real raw-render bases and PRTS references.

Requires NumPy / OpenCV; no Unity or production resources are modified. Bases are float32 RGBA
(bottom-up, alpha=material identity), split into diffuse q=0 / q=1 and constant emission.
Fit prep + unite, reserve Boss. A shared desert mix and one RGB light gain per map are empirical,
not official runtime parameters. Preserve reference identities and report held-out error.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(1)
IDS = ('01', '02', '03', '04', '05', '06', '09', '10', '11', '12')
DESERT = {'01', '02', '03', '04', '06'}
VIEWS = ('prep', 'unite', 'boss')
GAIN_BOUNDS = (0.65, 1.45)
DELTA = 0.04
PRIOR = 0.001


def load_samples(root, refs, ident, view):
    stem = f'm{ident}-{view}'
    meta = json.loads((root / f'{stem}.json').read_text())
    frames = []
    for i in range(3):
        with gzip.open(root / f'{stem}-{i}.f32.gz', 'rb') as stream:
            frame = np.frombuffer(stream.read(), dtype='<f4').reshape(meta['height'], meta['width'], 4)
        frames.append(np.flipud(frame).copy())
    part = VIEWS.index(view) + 1
    ref_file = refs / f'm{ident}-sub{part}.png'
    ref = cv2.cvtColor(cv2.imread(str(ref_file)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    assert ref.shape[:2] == frames[0].shape[:2]
    identity = np.rint(frames[0][..., 3]).astype(np.int16)
    assert identity.max() <= len(meta['names']) and identity.max() > 0
    valid = np.isfinite(frames[0]).all(2) & np.isfinite(frames[1]).all(2)
    # Ignore bright red native FX that live in the other canvas and are absent from these static bases.
    valid &= ~((ref[..., 0] > .65) & (ref[..., 1] < .4) & (ref[..., 2] < .4))
    arrays = [cv2.GaussianBlur(f[..., :3], (0, 0), .85) for f in frames]
    target = cv2.GaussianBlur(ref, (0, 0), .85)
    indices = []
    for mat in range(1, len(meta['names']) + 1):
        mask = cv2.erode((identity == mat).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & valid
        yy, xx = np.nonzero(mask)
        # Balance materials and spatial areas, rather than letting the huge backdrop dominate.
        bins = (yy * 4 // meta['height']) * 4 + xx * 4 // meta['width']
        for cell in range(16):
            candidates = np.flatnonzero(bins == cell)
            if len(candidates) < 16:
                continue
            take = candidates[np.linspace(0, len(candidates) - 1, min(128, len(candidates)), dtype=int)]
            indices.extend((yy[take] * meta['width'] + xx[take]).tolist())
    indices = np.asarray(indices, dtype=int)
    if len(indices) > 12000:
        indices = indices[np.linspace(0, len(indices) - 1, 12000, dtype=int)]
    assert len(indices) > 500, (stem, len(indices))
    a, b, e = [im.reshape(-1, 3)[indices] for im in arrays]
    return {'a': a, 'd': b - a, 'e': e, 'r': target.reshape(-1, 3)[indices],
            'index': indices, 'size': (meta['height'], meta['width']), 'count': len(indices), 'referenceSha256': hashlib.sha256(ref_file.read_bytes()).hexdigest()}


def combine(views):
    return {k: np.concatenate([v[k] for v in views]) for k in ('a', 'd', 'e', 'r')}


def loss_channel(x, e, target, gain):
    residual = np.abs(np.clip(x * gain + e, 0, 1) - target)
    huber = np.where(residual <= DELTA, residual * residual, 2 * DELTA * residual - DELTA * DELTA)
    return float(huber.mean()) + PRIOR * (gain - 1) ** 2


def fit_gain(samples, mix):
    x = samples['a'] + mix * samples['d']
    gains, losses = [], []
    for channel in range(3):
        fn = lambda g: loss_channel(x[:, channel], samples['e'][:, channel], samples['r'][:, channel], g)
        left, right = GAIN_BOUNDS
        ratio = (5 ** .5 - 1) / 2
        c, d = right - ratio * (right - left), left + ratio * (right - left)
        fc, fd = fn(c), fn(d)
        for _ in range(20):
            if fc < fd:
                right, d, fd = d, c, fc
                c = right - ratio * (right - left); fc = fn(c)
            else:
                left, c, fc = c, d, fd
                d = left + ratio * (right - left); fd = fn(d)
        g = (left + right) / 2
        gains.append(g); losses.append(fn(g))
    return gains, float(np.mean(losses))


def error(samples, mix, gain):
    predicted = np.clip((samples['a'] + mix * samples['d']) * np.asarray(gain) + samples['e'], 0, 1)
    residual = predicted - samples['r']
    return {'rgbRms': float(np.sqrt(np.mean(residual * residual)) * 255),
            'meanRgbError': (np.mean(residual, axis=0) * 255).tolist()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--basis', type=Path, required=True)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    data = {n: {v: load_samples(args.basis, args.references, n, v) for v in VIEWS} for n in IDS}
    train = {n: combine([data[n]['prep'], data[n]['unite']]) for n in IDS}
    def trial(q):
        fits = {n: fit_gain(train[n], q) for n in DESERT}
        return sum(value[1] for value in fits.values()) / len(fits) + .00005 * q * q, fits
    coarse = [(q, *trial(q)) for q in np.linspace(0, 1, 21)]
    best = min(coarse, key=lambda t: t[1])[0]
    fine = [(float(q), *trial(float(q))) for q in np.linspace(max(0, best - .05), min(1, best + .05), 21)]
    q, objective, desert_fits = min(fine, key=lambda t: t[1])
    profiles = {}
    for n in IDS:
        gain = desert_fits[n][0] if n in DESERT else fit_gain(train[n], 0)[0]
        mix = q if n in DESERT else 0
        profiles['act3autochess_m' + n] = {'light': [round(x, 5) for x in gain], 'mix': round(mix, 5),
            'training': {'before': error(train[n], 0, [1, 1, 1]), 'after': error(train[n], mix, gain)},
            'heldOutBoss': {'before': error(data[n]['boss'], 0, [1, 1, 1]), 'after': error(data[n]['boss'], mix, gain)},
            'sources': {v: {'samples': data[n][v]['count'], 'referenceSha256': data[n][v]['referenceSha256']} for v in VIEWS}}
        print(n, profiles['act3autochess_m' + n], flush=True)
    result = {'method': 'empirical gamma/display-space diffuse gain + shared native vertex mix; constant emission; Huber; eroded static-material masks',
              'sandBlend': round(q, 5), 'gainBounds': GAIN_BOUNDS, 'trainingViews': ['prep', 'unite'],
              'heldOutView': 'boss', 'objective': objective, 'profiles': profiles,
              'limitations': ['Not recovered official runtime values', 'Preserves the game\'s independent focus dimming',
                              'Fit samples exclude water, translucent surfaces, unlit art, units and FX',
                              'Reference version, resampling and remaining camera/geometry errors are unresolved']}
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()

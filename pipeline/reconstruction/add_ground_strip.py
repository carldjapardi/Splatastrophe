"""Keep a narrow strip at the landmark's lower edge without widening its mask."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def extend(mask: np.ndarray, fraction: float) -> np.ndarray:
    rows, columns = mask.nonzero()
    if not len(rows):
        return mask.copy()
    height = int(rows.max() - rows.min() + 1)
    thickness = max(1, round(height * fraction))
    feet = np.full(mask.shape[1], -1, dtype=int)
    np.maximum.at(feet, columns, rows)
    # Ignore upper-only columns (e.g. eaves), then bridge column openings.
    anchors = np.flatnonzero(feet >= rows.min() + .65 * height)
    result = mask.copy()
    if len(anchors) < 2:
        return result
    width = int(anchors[-1] - anchors[0] + 1)
    strip = min(thickness, max(1, round(width * .05)))
    for left, right in zip(anchors[:-1], anchors[1:]):
        if right - left > .25 * width or abs(feet[right] - feet[left]) > max(2 * strip, .12 * height):
            continue
        for x in range(left, right + 1):
            foot = round(feet[left] + (feet[right] - feet[left]) * (x - left) / (right - left))
            result[foot + 1:foot + 1 + strip, x] = True
    return result


def run(source: Path, output: Path, fraction: float) -> None:
    files = sorted(source.glob('*.png'))
    if not files:
        raise ValueError(f'No PNG masks in {source}')
    output.mkdir(parents=True, exist_ok=False)
    report = []
    for file in files:
        with Image.open(file) as original:
            if original.mode != 'L' or {value for _, value in original.getcolors(256)} != {0, 255}:
                raise ValueError(f'Expected a binary grayscale mask: {file}')
            mask = np.asarray(original) == 255
        extended = extend(mask, fraction)
        Image.fromarray(extended.astype(np.uint8) * 255).save(output / file.name)
        report.append({'mask': file.name, 'pixels_added': int(extended.sum() - mask.sum())})
    (output / 'ground-strip.json').write_text(json.dumps({'height_fraction': fraction, 'masks': report}, indent=2))
    print(f'Extended {len(report)} masks')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--fraction', type=float, default=.03)
    args = parser.parse_args()
    if not 0 < args.fraction <= .08:
        parser.error('--fraction must be greater than 0 and at most 0.08')
    run(args.source, args.output, args.fraction)

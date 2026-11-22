"""Apply a JSON opacity profile to a bundled SOG v3 asset.

Requires NumPy, Pillow, and SciPy. Keeps the original splat rows and RGB values.
"""

import argparse
from hashlib import file_digest
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree


def read_atlas(archive, name):
    with Image.open(BytesIO(archive.read(name))) as image:
        return np.array(image.convert('RGBA'))


def inside_any(centers, boxes):
    result = np.zeros(len(centers), dtype=bool)
    for box in boxes:
        lower, upper = np.asarray(box, dtype=float)
        if lower.shape != (3,) or upper.shape != (3,) or not np.isfinite(box).all() or (lower >= upper).any():
            raise ValueError(f'Invalid region bounds: {box}')
        result |= ((centers >= lower) & (centers <= upper)).all(axis=1)
    return result


def adjust(archive, profile):
    meta = json.loads(archive.read('meta.json'))
    if meta['version'] != 3:
        raise ValueError('Expected a bundled SOG v3 asset')
    count = meta['count']
    low_file, high_file = meta['means']['files']
    scale_file, = meta['scales']['files']
    color_file, = meta['sh0']['files']
    colors = read_atlas(archive, color_file)
    low = read_atlas(archive, low_file)
    high = read_atlas(archive, high_file)
    encoded_scales = read_atlas(archive, scale_file)
    if count < 1 or count > colors.shape[0] * colors.shape[1] or any(
        atlas.shape != colors.shape for atlas in (low, high, encoded_scales)
    ):
        raise ValueError('Invalid splat count or mismatched SOG texture dimensions')

    low_rows = low.reshape(-1, 4)[:count, :3].astype(np.uint16)
    high_rows = high.reshape(-1, 4)[:count, :3].astype(np.uint16)
    minima = np.asarray(meta['means']['mins'])
    maxima = np.asarray(meta['means']['maxs'])
    logs = minima + (maxima - minima) * (((high_rows << 8) | low_rows) / 65535)
    centers = np.sign(logs) * np.expm1(np.abs(logs))
    if profile['rotate_x_180']:
        centers[:, 1:] *= -1

    scale_rows = encoded_scales.reshape(-1, 4)[:count, :3]
    sigmas = np.exp(np.asarray(meta['scales']['codebook']))[scale_rows].max(axis=1)
    pixels = colors.reshape(-1, 4)[:count]
    old_alpha_bytes = pixels[:, 3].copy()
    source_alpha = (old_alpha_bytes / 204.0) ** 2
    new_alpha = source_alpha.copy()

    support = profile['support']
    support_rows = (source_alpha >= support['min_alpha']) & (sigmas <= support['max_sigma'])
    neighbors = support['neighbors']
    if not isinstance(neighbors, int) or neighbors < 2 or support_rows.sum() < neighbors:
        raise ValueError('The support rule must select at least two neighboring splats')
    tree = cKDTree(centers[support_rows])
    protected = inside_any(centers, profile.get('protected_regions', []))

    suppression = profile.get('suppress', [])
    if isinstance(suppression, dict):
        suppression = [suppression]
    for rule in suppression:
        region = inside_any(centers, rule['regions']) & ~protected
        if 'min_blue_excess' in rule:
            dc = np.asarray(meta['sh0']['codebook'])[pixels[:, :3]]
            blue_excess = 0.28209479177387814 * (dc[:, 2] - dc[:, 0])
            region &= blue_excess >= rule['min_blue_excess']
        rows = np.flatnonzero(region & (sigmas > rule['min_sigma']) & (source_alpha < rule['max_alpha']))
        start, end = rule['support_distance']
        if not 0 <= start < end or rule['sigma_ramp'] <= 0 or not 0 <= rule['max_reduction'] <= 1:
            raise ValueError('Invalid suppression settings')
        distances, _ = tree.query(centers[rows], k=[neighbors], workers=4)
        isolation = np.clip((distances[:, 0] - start) / (end - start), 0, 1)
        breadth = np.clip((sigmas[rows] - rule['min_sigma']) / rule['sigma_ramp'], 0, 1)
        new_alpha[rows] *= 1 - rule['max_reduction'] * isolation * breadth

    if (rule := profile.get('solidify')):
        region = inside_any(centers, rule['regions']) & ~protected
        rows = np.flatnonzero(region & (sigmas <= rule['max_sigma']) &
                              (source_alpha >= rule['min_alpha']) & (source_alpha <= rule['max_alpha']) &
                              (new_alpha == source_alpha))
        inner, outer = rule['support_distance']
        if not 0 <= inner < outer or not 0 <= rule['min_alpha'] < rule['max_alpha'] <= 1 or rule['gain'] < 1:
            raise ValueError('Invalid solidification settings')
        distances, _ = tree.query(centers[rows], k=[neighbors], workers=4)
        confidence = np.clip((outer - distances[:, 0]) / (outer - inner), 0, 1)
        new_alpha[rows] = 1 - np.power(1 - source_alpha[rows], 1 + (rule['gain'] - 1) * confidence)

    new_bytes = np.rint(204 * np.sqrt(new_alpha)).astype(np.uint8)
    stats = {
        'splat_count': count,
        'alpha_reduced': int((new_bytes < old_alpha_bytes).sum()),
        'alpha_increased': int((new_bytes > old_alpha_bytes).sum()),
    }
    pixels[:, 3] = new_bytes
    encoded = BytesIO()
    Image.fromarray(colors).save(encoded, format='WEBP', lossless=True, exact=True)
    return color_file, encoded.getvalue(), stats


def sha256(path):
    with path.open('rb') as handle:
        return file_digest(handle, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('profile', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    profile = json.loads(args.profile.read_text())
    with ZipFile(args.source) as source:
        color_file, atlas, stats = adjust(source, profile)
        with ZipFile(args.output, 'x') as output:
            for item in source.infolist():
                output.writestr(item, atlas if item.filename == color_file else source.read(item))
    stats['source_sha256'] = sha256(args.source)
    stats['output_sha256'] = sha256(args.output)
    print(json.dumps(stats, indent=2))


if __name__ == '__main__':
    main()

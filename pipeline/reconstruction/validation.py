"""Camera/split checks and a local camera-coverage preview; no CUDA required."""
import csv
import html
import json
import math
from pathlib import Path

try:
    from .datasets import image_files, write_json
except ImportError:
    from datasets import image_files, write_json

SPLIT_KEYS = ('train_filenames', 'val_filenames', 'test_filenames')


def split_frames(path, every=10, tsv=None):
    path = Path(path)
    meta = json.loads(path.read_text())
    if any(key in meta for key in SPLIT_KEYS):
        raise ValueError('Splits already exist; use a new processed directory')
    frames = sorted(meta['frames'], key=lambda f: f['file_path'])
    names = [frame['file_path'] for frame in frames]
    if len(names) < 3 or len(set(names)) != len(names):
        raise ValueError('Need at least three uniquely named registered images')
    if every < 3:
        raise ValueError('eval_every must be at least 3 for disjoint validation and test')
    for name in names:
        if not (path.parent / name).is_file():
            raise ValueError(f'Missing registered image: {name}')
    excluded = []
    if tsv:
        by_basename = {Path(name).name: name for name in names}
        if len(by_basename) != len(names):
            raise ValueError('Ambiguous image basenames for NeRF-W split')
        with Path(tsv).open() as source:
            rows = list(csv.DictReader(source, delimiter='\t'))
        if not rows or not {'filename', 'split'} <= rows[0].keys():
            raise ValueError('NeRF-W TSV must have filename and split columns')
        filenames = [row['filename'] for row in rows]
        if len(set(filenames)) != len(filenames):
            raise ValueError('Duplicate filenames in NeRF-W split')
        missing = sorted(set(filenames) - by_basename.keys())
        if missing:
            raise ValueError(f'NeRF-W split images missing from registered cameras: {missing[:10]}')
        if any(row['split'] not in ('train', 'test') for row in rows):
            raise ValueError('Unexpected NeRF-W split label')
        pool = sorted(by_basename[row['filename']] for row in rows if row['split'] == 'train')
        test = sorted(by_basename[row['filename']] for row in rows if row['split'] == 'test')
        val = pool[every - 1::every] or pool[-1:]
        train = [name for name in pool if name not in set(val)]
        retained = set(train + val + test)
        excluded = [name for name in names if name not in retained]
        frames = [frame for frame in frames if frame['file_path'] in retained]
        policy = 'NeRF-W test membership; validation carved from official train; full-image project metrics, not NeRF-W appearance-adapted benchmark'
    else:
        test = names[every - 1::every] or names[-1:]
        pool = [name for name in names if name not in set(test)]
        val = names[every - 2::every] or pool[-1:]
        train = [name for name in pool if name not in set(val)]
        policy = 'Deterministic filename order; disjoint train/validation/test; adjacent video frames may be highly correlated'
    if not train or not val or not test:
        raise ValueError('Every split must contain an image')
    meta['frames'] = frames
    meta.update(zip(SPLIT_KEYS, (train, val, test)))
    validate_splits(meta)
    backup = path.with_suffix('.before-split.json')
    with backup.open('x') as output:
        output.write(path.read_text())
    write_json(path, meta)
    return {'train': train, 'validation': val, 'test': test, 'evaluation': test,
            'excluded_registered_images': excluded, 'policy': policy,
            'camera_policy': 'All source views may contribute to SfM; held-out views excluded from appearance optimization'}


def validate_splits(meta):
    names = [f['file_path'] for f in meta['frames']]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate frame paths')
    groups = [meta.get(key, []) for key in SPLIT_KEYS]
    if any(not group or len(group) != len(set(group)) for group in groups):
        raise ValueError('Need nonempty, duplicate-free train/validation/test lists')
    if any(set(groups[i]) & set(groups[j]) for i in range(3) for j in range(i)):
        raise ValueError('Train/validation/test overlap')
    if set().union(*map(set, groups)) != set(names):
        raise ValueError('Split membership must cover exactly the retained frames')


def inspect_cameras(processed, images, cfg):
    meta = json.loads((processed / 'transforms.json').read_text())
    validate_splits(meta)
    centers = []
    frames = meta['frames']
    for frame in frames:
        if not (processed / frame['file_path']).is_file():
            raise ValueError(f"Missing image: {frame['file_path']}")
        matrix = frame['transform_matrix']
        if len(matrix) != 4 or any(len(row) != 4 for row in matrix) or any(not math.isfinite(v) for row in matrix for v in row):
            raise ValueError('Camera transform must be a finite 4x4 matrix')
        if any(abs(matrix[3][j] - (1 if j == 3 else 0)) > 1e-4 for j in range(4)):
            raise ValueError('Invalid homogeneous camera transform')
        for i in range(3):
            for j in range(3):
                dot = sum(matrix[k][i] * matrix[k][j] for k in range(3))
                if abs(dot - (1 if i == j else 0)) > 1e-2:
                    raise ValueError('Camera rotation is not orthonormal')
        r = matrix
        determinant = (r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])
                       -r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])
                       +r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]))
        if abs(determinant - 1) > 1e-2:
            raise ValueError('Camera rotation must be right-handed')
        for key in ('fl_x', 'fl_y', 'w', 'h'):
            value = frame.get(key, meta.get(key))
            if not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f'Missing or invalid intrinsics: {key}')
        centers.append([matrix[i][3] for i in range(3)])
    if len(set(map(tuple, centers))) < 2:
        raise ValueError('Camera centers are all identical')
    source_count = len(image_files(images))
    backup = processed / 'transforms.before-split.json'
    registered = len(json.loads(backup.read_text())['frames']) if backup.exists() else len(frames)
    result = {'scene_id': cfg['scene_id'], 'source_images': source_count,
              'registered_before_split_filter': registered, 'retained_cameras': len(frames),
              'registration_fraction': registered / source_count if source_count else None,
              'splits': {key: len(meta[key]) for key in SPLIT_KEYS}, 'camera_centers': centers,
              'structural_checks_passed': True, 'visual_alignment_review': 'pending; inspect preview and sparse cloud before training',
              'camera_provenance': cfg['camera_provenance'], 'scale': cfg['scale']}
    write_json(processed / 'alignment.json', result)
    panels = []
    for a, b, label in ((0, 1, 'XY'), (0, 2, 'XZ'), (1, 2, 'YZ')):
        mins = [min(p[k] for p in centers) for k in (a,b)]
        spans = [max(p[k] for p in centers)-mins[i] or 1 for i,k in enumerate((a,b))]
        dots = []
        for frame, center in zip(frames, centers):
            x = 20 + (center[a]-mins[0])/spans[0]*320
            y = 340 - (center[b]-mins[1])/spans[1]*320
            color = '#dc2626' if frame['file_path'] in meta['test_filenames'] else '#2563eb'
            dots.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="3" fill="{color}"><title>{html.escape(frame["file_path"])}</title></circle>')
        panels.append(f'<section><h2>{label}</h2><svg viewBox="0 0 360 360" width="360">{"".join(dots)}</svg></section>')
    (processed / 'alignment.html').write_text('<!doctype html><meta charset="utf-8"><title>Camera coverage</title>'
        '<h1>Camera coverage — structural diagnostic</h1><p>Red: test; blue: train/validation. '
        'Each plot is independently scaled. This does not establish correct scene alignment.</p>' + ''.join(panels))
    return result

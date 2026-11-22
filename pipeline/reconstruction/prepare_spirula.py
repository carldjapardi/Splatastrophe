"""Stage calibrated photos and reviewed landmark masks for Spirula Studio."""
import argparse
import json
from pathlib import Path

from PIL import Image


def prepare(source: Path, output: Path, masks: Path | None, *, masked_subset: bool = False) -> dict:
    source = source.resolve()
    transforms = json.loads((source / 'transforms.json').read_text())
    train = set(transforms.pop('train_filenames'))
    test = set(transforms.pop('test_filenames'))
    validation = set(transforms.pop('val_filenames', []))
    if not train or not test or train & test or (train | test) & validation:
        raise ValueError('Expected nonempty, disjoint training and test splits')

    frames = {}
    for frame in transforms['frames']:
        name = frame['file_path']
        if name in frames:
            raise ValueError(f'Duplicate camera frame: {name}')
        frames[name] = frame
    if (train | test) - frames.keys():
        raise ValueError('Split contains filenames without camera frames')

    original_train_count = len(train)
    if masked_subset:
        if masks is None:
            raise ValueError('A pilot subset requires a mask directory')
        train = {name for name in train if (masks / Path(name).with_suffix('.png').name).is_file()}
        if not train:
            raise ValueError('No training photos have matching masks')

    entries = []
    output = output.resolve()
    for name in sorted(train | test):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError(f'Expected a relative image path: {name}')
        image = source / relative
        if not image.is_file():
            raise FileNotFoundError(image)
        role = 'train' if name in train else 'eval'
        mask = None
        if masks is not None and role == 'train':
            mask = masks / relative.with_suffix('.png').name
            with Image.open(image) as photo, Image.open(mask) as label:
                if label.mode != 'L' or label.size != photo.size:
                    raise ValueError(f'Expected full-resolution, single-channel mask: {mask}')
                if {value for _, value in label.getcolors(256)} != {0, 255}:
                    raise ValueError(f'Expected binary mask with foreground and background: {mask}')
        renamed = f'images/{role}_{len(entries):05d}{relative.suffix}'
        entries.append((name, image, renamed, mask))

    if masks is not None and len({entry[3] for entry in entries if entry[3]}) != len(train):
        raise ValueError('Training filenames must have unique mask stems')
    seed = transforms.get('ply_file_path')
    if seed and (Path(seed).is_absolute() or '..' in Path(seed).parts or not (source / seed).is_file()):
        raise ValueError(f'Invalid seed point cloud: {seed}')

    output.mkdir(parents=True, exist_ok=False)
    (output / 'images').mkdir()
    if masks is not None:
        (output / 'masks').mkdir()
    for name, image, renamed, mask in entries:
        (output / renamed).symlink_to(image)
        if mask is not None:
            (output / 'masks' / Path(renamed).with_suffix('.png').name).symlink_to(mask.resolve())
    if seed:
        (output / seed).parent.mkdir(parents=True, exist_ok=True)
        (output / seed).symlink_to(source / seed)
    transforms['frames'] = [{**frames[name], 'file_path': renamed} for name, _, renamed, _ in entries]
    (output / 'transforms.json').write_text(json.dumps(transforms))
    report = {'train': len(train), 'held_out': len(test), 'masked': masks is not None,
              'training_photos_omitted': original_train_count - len(train),
              'source_filenames': {renamed: name for name, _, renamed, _ in entries}}
    (output / 'split-manifest.json').write_text(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--masks', type=Path, help='One reviewed <image-stem>.png per training photo')
    parser.add_argument('--masked-subset', action='store_true', help='Pilot on available masks only')
    options = parser.parse_args()
    result = prepare(options.source, options.output, options.masks, masked_subset=options.masked_subset)
    print(f"{result['train']} training photos, {result['held_out']} held-out photos, masks: {result['masked']}")

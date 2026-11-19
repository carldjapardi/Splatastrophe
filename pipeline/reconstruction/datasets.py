"""Dataset acquisition with preserved originals and content provenance (no GPU imports)."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request
import zipfile

IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'}


def image_files(directory):
    return sorted(p for p in Path(directory).rglob('*') if p.is_file() and p.suffix.lower() in {'.jpg', '.jpeg', '.png'})


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def extract_archive(archive, destination):
    """Extract regular files only, without trusting archive paths or links."""
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)

    def target(name):
        result = (destination / name).resolve()
        if not result.is_relative_to(destination) or '\\' in name:
            raise ValueError(f'Unsafe archive member: {name}')
        return result

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                output = target(member.filename)
                if (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Archive links are not supported')
                if member.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(member) as reader, output.open('xb') as writer:
                        shutil.copyfileobj(reader, writer)
    else:
        with tarfile.open(archive) as source:
            for member in source:
                output = target(member.name)
                if member.isdir():
                    output.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as reader, output.open('xb') as writer:
                        shutil.copyfileobj(reader, writer)
                else:
                    raise ValueError(f'Unsupported archive member: {member.name}')


def download_dataset(cfg, root):
    raw = root / cfg['raw']
    raw.mkdir(parents=True, exist_ok=False)  # Never replace a prior download.
    download = cfg['download']
    archive = raw / download['filename']
    partial = archive.with_suffix(archive.suffix + '.part')
    if download.get('google_drive_id'):
        import gdown  # Already a Nerfstudio dependency; only needed on the compute machine.
        result = gdown.download(id=download['google_drive_id'], output=str(partial), quiet=False)
        if not result:
            raise RuntimeError('Google Drive download failed; use the official Barn image-set link')
    else:
        with urllib.request.urlopen(download['url'], timeout=60) as source, partial.open('xb') as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
    partial.rename(archive)
    digest = sha256(archive)
    extract_archive(archive, raw / 'extracted')
    if cfg['scene_id'] == 'barn':
        candidates = [p for p in [raw / 'extracted', *(raw / 'extracted').rglob('*')] if p.is_dir() and image_files(p)]
        # Official ZIP normally has one Barn/ directory with its frames directly inside.
        leaves = [p for p in candidates if any(f.parent == p for f in image_files(p))]
        if len(leaves) != 1:
            raise ValueError('Expected one Barn image directory; inspect extracted archive before proceeding')
        shutil.copytree(leaves[0], root / cfg['images'])
    else:
        candidates = [p for p in (raw / 'extracted').rglob('dense') if (p / 'images').is_dir() and (p / 'sparse').is_dir()]
        if len(candidates) != 1:
            raise ValueError('Expected one PhotoTourism dense/images + dense/sparse directory')
        shutil.move(str(candidates[0]), str(raw / 'dense'))
        split = raw / cfg['split']['filename']
        with urllib.request.urlopen(cfg['split']['url'], timeout=60) as source, split.open('xb') as output:
            shutil.copyfileobj(source, output)
    evidence = {'scene_id': cfg['scene_id'], 'dataset': cfg['dataset'], 'release': cfg['release'],
                'retrieved_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'download': download, 'archive_sha256': digest, 'archive_bytes': archive.stat().st_size,
                'image_count': len(image_files(root / cfg['images'])),
                'checksum_policy': 'Local SHA256 content identity; not an upstream authenticated checksum'}
    if cfg['split']['kind'] == 'nerfw':
        evidence['split_sha256'] = sha256(split)
    write_json(raw / 'source.json', evidence)
    return evidence

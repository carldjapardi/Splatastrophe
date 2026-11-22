"""Barn and PhotoTourism reconstruction. Preview by default; --execute runs a stage."""
import argparse
import datetime
import json
import math
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time

try:
    from .datasets import download_dataset, image_files, sha256, write_json
    from .validation import inspect_cameras, split_frames, validate_splits
except ImportError:
    from datasets import download_dataset, image_files, sha256, write_json
    from validation import inspect_cameras, split_frames, validate_splits

ROOT = Path(__file__).resolve().parents[2]


def command_for(stage, cfg, root, config=None, iterations=None, stamp=None):
    images, processed, outputs = [root / cfg[k] for k in ('images', 'processed', 'outputs')]
    if stage == 'process':
        cmd = ['ns-process-data', 'images', '--data', str(images), '--output-dir', str(processed),
               '--num-downscales', str(cfg['num_downscales']), '--sfm-tool', 'colmap']
        if cfg['camera_source'] == 'supplied_colmap':
            cmd += ['--skip-colmap', '--skip-image-processing', '--colmap-model-path', str(root / cfg['colmap_model']),
                    '--no-same-dimensions', '--no-use-single-camera-mode']
        else:
            cmd += ['--matching-method', cfg['matching_method']]
        return cmd
    if stage == 'train':
        return ['ns-train', 'splatfacto', '--data', str(processed), '--output-dir', str(outputs),
                '--experiment-name', cfg['scene_id'], '--timestamp', stamp or 'RUN_TIMESTAMP',
                '--max-num-iterations', str(iterations or cfg['iterations']), '--vis', 'tensorboard',
                *(['--pipeline.model.num-downscales', '0'] if cfg.get('full_resolution') else []),
                'nerfstudio-data', '--downscale-factor', str(cfg['train_downscale_factor'])]
    if config is None:
        raise ValueError('--load-config is required; choose the exact successful training run')
    if stage == 'eval':
        return ['ns-eval', '--load-config', str(config), '--output-path', str(config.parent / 'metrics.json')]
    if stage == 'export':
        return ['ns-export', 'gaussian-splat', '--load-config', str(config),
                '--output-dir', str(config.parent / 'exports'), '--output-filename', 'building.ply']
    if stage == 'preview':
        return ['ns-render', 'dataset', '--load-config', str(config), '--split', 'val',
                '--rendered-output-names', 'rgb', '--output-path', str(config.parent / 'preview')]
    raise ValueError(f'No external command for {stage}')


def capture_command(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None


def package_export(cfg, root, config):
    processed = root / cfg['processed']
    exported = config.parent / 'exports'
    ply = exported / 'building.ply'
    if not ply.is_file():
        raise ValueError(f'Missing export: {ply}')
    header = []
    with ply.open('rb') as source:
        for _ in range(200):
            line = source.readline().decode('ascii').strip()
            header.append(line)
            if line == 'end_header':
                break
        else:
            raise ValueError('Invalid PLY header')
    count = next((int(line.split()[-1]) for line in header if line.startswith('element vertex ')), 0)
    if not count:
        raise ValueError('Empty PLY export')
    for source, name in [(processed / 'transforms.json', 'input-cameras.json'),
                         (processed / 'split.json', 'split.json'),
                         (processed / 'alignment.json', 'alignment.json'),
                         (root / cfg['raw'] / 'source.json', 'source.json'),
                         (config.parent / 'dataparser_transforms.json', 'dataparser_transforms.json'),
                         (config.parent / 'metrics.json', 'metrics.json')]:
        if source.is_file():
            shutil.copy2(source, exported / name)
    write_json(exported / 'scene.json', cfg)
    metadata = {'scene_id': cfg['scene_id'], 'asset': 'building.ply', 'splat_count': count,
                'sha256': sha256(ply), 'bytes': ply.stat().st_size, 'training_config': str(config),
                'coordinates': 'Nerfstudio training coordinates; see dataparser_transforms.json. Input camera poses are pre-dataparser, not export-space poses.',
                'scale': cfg['scale'], 'camera_provenance': cfg['camera_provenance'],
                'representation': 'Inria-style Gaussian PLY: log scales, opacity logits, SH coefficients, quaternion [w,x,y,z]; verify installed exporter conventions before conversion',
                'attribution': cfg['attribution'], 'mask_policy': cfg['mask_policy'],
                'browser_validation': 'pending; not integrated into the synthetic playground',
                'stable_id_policy': 'PLY row indices for this exact SHA256 only; exporter may prune/reorder source Gaussians'}
    write_json(exported / 'artifact.json', metadata)
    return metadata


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['download', 'process', 'split', 'inspect', 'train', 'eval', 'export', 'preview'])
    p.add_argument('--scene', type=Path, default=ROOT / 'configs/scenes/barn.json')
    p.add_argument('--data-root', type=Path, default=ROOT, help='Root for scene-relative data/outputs; use persistent disk on GPU')
    p.add_argument('--load-config', type=Path)
    p.add_argument('--full-resolution', action='store_true', help='Disable the model resolution ramp from the first step')
    p.add_argument('--iterations', type=int, help='Explicit longer run only after reviewing the smoke baseline')
    p.add_argument('--hourly-rate', '--hourly-rate-usd', dest='hourly_rate', type=float, help='USD/hour from the provider; elapsed-time estimate only, not an invoice')
    p.add_argument('--execute', action='store_true')
    a = p.parse_args()
    cfg = json.loads(a.scene.read_text())
    if a.full_resolution:
        cfg.update(full_resolution=True, train_downscale_factor=1)
    root = a.data_root.resolve()
    images, processed, outputs = [root / cfg[k] for k in ('images', 'processed', 'outputs')]
    transforms = processed / 'transforms.json'
    config = a.load_config.resolve() if a.load_config else None
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if a.iterations is not None and a.iterations <= 0:
        p.error('--iterations must be positive')
    if a.hourly_rate is not None and (not math.isfinite(a.hourly_rate) or a.hourly_rate < 0):
        p.error('--hourly-rate must be nonnegative')
    internal = a.stage in ('download', 'split', 'inspect')
    try:
        cmd = None if internal else command_for(a.stage, cfg, root, config, a.iterations, stamp if a.execute else None)
    except ValueError as error:
        p.error(str(error))
    print(f'{a.stage}: {cfg["dataset"]}')
    if cmd:
        print(shlex.join(cmd))
    elif a.stage == 'download':
        print(json.dumps(cfg['download'], indent=2))
        print('Destination:', root / cfg['raw'])
    else:
        print('Transforms:', transforms)
    if not a.execute:
        return
    if cmd and not shutil.which(cmd[0]):
        p.error(f'Missing {cmd[0]}; activate the reconstruction environment')
    if a.stage == 'process':
        if processed.exists():
            p.error('Processed directory exists; preserve it and use a new directory/config for another attempt')
        if len(image_files(images)) < 3:
            p.error(f'Need at least three images in {images}; run download first')
        if cfg['camera_source'] == 'supplied_colmap':
            model = root / cfg['colmap_model']
            if not all((model / name).is_file() for name in ('cameras.bin', 'images.bin', 'points3D.bin')):
                p.error(f'Incomplete supplied COLMAP model at {model}')
    if a.stage == 'train':
        validate_splits(json.loads(transforms.read_text()))
        # Repeat the structural check now; geometric coherence still needs visual review.
        inspect_cameras(processed, images, cfg)
        print(f'Inspect {processed / "alignment.html"} and sparse geometry for coherent alignment.')
    if config and (not config.is_file() or not config.is_relative_to(outputs.resolve())):
        p.error('--load-config must be an existing run under this scene outputs directory')
    if config and a.stage in ('eval', 'export', 'preview'):
        if not (config.parent / 'experiment.json').is_file():
            p.error('Run provenance missing: use a training run created by this CLI')
        experiment = json.loads((config.parent / 'experiment.json').read_text())
        if experiment['transforms_sha256'] != sha256(transforms):
            p.error('Processed cameras/splits changed since training; restore the recorded dataset')
    if a.stage == 'export' and (config.parent / 'exports').exists():
        p.error('Exports already exist; preserve the original artifact')
    logdir = outputs / 'command-logs' / stamp
    logdir.mkdir(parents=True, exist_ok=False)
    record = {'stage': a.stage, 'command': cmd, 'scene': cfg, 'data_root': str(root), 'cwd': str(ROOT),
              'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'git_commit': capture_command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']),
              'git_dirty': capture_command(['git', '-C', str(ROOT), 'status', '--porcelain']),
              'hourly_rate_usd': a.hourly_rate, 'cost_policy': 'Wall-time estimate for this stage only; excludes setup/idle time; provider bill is authoritative'}
    write_json(logdir / 'run.json', record)
    start = time.monotonic()
    code = 0
    try:
        if a.stage == 'download':
            record['result'] = download_dataset(cfg, root)
        elif a.stage == 'split':
            tsv = root / cfg['raw'] / cfg['split']['filename'] if cfg['split']['kind'] == 'nerfw' else None
            result = split_frames(transforms, cfg['eval_every'], tsv)
            write_json(processed / 'split.json', result)
            record['result'] = {key: len(result[key]) for key in ('train', 'validation', 'test')}
        elif a.stage == 'inspect':
            record['result'] = inspect_cameras(processed, images, cfg)
        else:
            if a.stage == 'process' and cfg['camera_source'] == 'supplied_colmap':
                # Keep source filenames, intrinsics and NeRF-W membership intact.
                shutil.copytree(images, processed / 'images')
            if a.stage == 'train':
                run_dir = outputs / cfg['scene_id'] / 'splatfacto' / stamp
                run_dir.mkdir(parents=True, exist_ok=False)
                provenance = {'scene': cfg, 'data_root': str(root), 'transforms_sha256': sha256(transforms),
                              'iterations': a.iterations or cfg['iterations'], 'command_log': str(logdir),
                              'evaluation': 'project full-image held-out metrics; no NeRF-W appearance adaptation'}
                write_json(run_dir / 'experiment.json', provenance)
                (logdir / 'pip-freeze.txt').write_text(capture_command([sys.executable, '-m', 'pip', 'freeze']) or '')
                (logdir / 'nvidia-smi.txt').write_text(capture_command(['nvidia-smi']) or 'unavailable')
            with (logdir / 'console.log').open('w') as log:
                process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                try:
                    for line in process.stdout:
                        print(line, end='', flush=True)
                        log.write(line)
                        log.flush()
                    code = process.wait()
                except KeyboardInterrupt:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise
            if code:
                raise subprocess.CalledProcessError(code, cmd)
            if a.stage == 'process' and not transforms.is_file():
                raise ValueError('Processing exited without transforms.json; inspect camera registration logs')
            if a.stage == 'export':
                record['result'] = package_export(cfg, root, config)
            if a.stage == 'train':
                print('Training config:', run_dir / 'config.yml')
    except BaseException as error:
        code = getattr(error, 'returncode', 1)
        record['error'] = str(error)
        raise
    finally:
        elapsed = time.monotonic() - start
        record.update(returncode=code, elapsed_seconds=elapsed,
                      estimated_cost_usd=elapsed / 3600 * a.hourly_rate if a.hourly_rate is not None else None,
                      finished_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
        write_json(logdir / 'run.json', record)
        print('Stage record:', logdir / 'run.json')


if __name__ == '__main__':
    main()

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

from pipeline.reconstruction import run as module
from pipeline.reconstruction.datasets import extract_archive, sha256
from pipeline.reconstruction.validation import inspect_cameras, validate_splits

ROOT = Path(__file__).resolve().parents[1]


class Reconstruction(unittest.TestCase):
    def fixture(self, directory, count=20):
        p = Path(directory)
        (p / 'images').mkdir()
        frames = []
        for i in range(count):
            name = f'images/{i:03}.jpg'
            (p / name).touch()
            frames.append({'file_path': name, 'transform_matrix': [[1,0,0,i],[0,1,0,1],[0,0,1,2],[0,0,0,1]]})
        target = p / 'transforms.json'
        target.write_text(json.dumps({'frames': frames,'fl_x':100,'fl_y':100,'w':200,'h':100}))
        return target

    def test_disjoint_persistent_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory)
            original = path.read_text()
            result = module.split_frames(path, 10)
            self.assertEqual([len(result[k]) for k in ('train','validation','test')], [16,2,2])
            validate_splits(json.loads(path.read_text()))
            self.assertEqual(path.with_suffix('.before-split.json').read_text(), original)
            with self.assertRaises(ValueError):
                module.split_frames(path, 10)

    def test_missing_image_does_not_modify_split(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory)
            original = path.read_text()
            (Path(directory)/'images/001.jpg').unlink()
            with self.assertRaises(ValueError):
                module.split_frames(path)
            self.assertEqual(original, path.read_text())

    def test_nerfw_membership_is_preserved_and_unlisted_frames_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory)
            tsv = Path(directory)/'split.tsv'
            tsv.write_text('filename\tsplit\n' + ''.join(f'{i:03}.jpg\ttrain\n' for i in range(15)) + '018.jpg\ttest\n019.jpg\ttest\n')
            result = module.split_frames(path, 10, tsv)
            self.assertEqual(result['test'], ['images/018.jpg','images/019.jpg'])
            self.assertEqual(len(result['excluded_registered_images']), 3)
            self.assertEqual(len(json.loads(path.read_text())['frames']), 17)
            validate_splits(json.loads(path.read_text()))

    def test_nerfw_missing_registered_test_view_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory)
            tsv = Path(directory)/'split.tsv'
            tsv.write_text('filename\tsplit\n999.jpg\ttest\n')
            with self.assertRaisesRegex(ValueError, 'missing'):
                module.split_frames(path, 10, tsv)
            self.assertFalse(path.with_suffix('.before-split.json').exists())

    def test_inspection_rejects_bad_rotations_and_reports_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.fixture(directory)
            module.split_frames(path)
            cfg = json.loads((ROOT/'configs/scenes/barn.json').read_text())
            report = inspect_cameras(path.parent, path.parent/'images', cfg)
            self.assertEqual(report['registration_fraction'], 1)
            self.assertTrue((path.parent/'alignment.html').is_file())
            meta = json.loads(path.read_text())
            meta['frames'][0]['transform_matrix'][0][0] = -1
            path.write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError, 'right-handed'):
                inspect_cameras(path.parent, path.parent/'images', cfg)

    def test_command_paths_and_supplied_cameras(self):
        barn = json.loads((ROOT/'configs/scenes/barn.json').read_text())
        photo = json.loads((ROOT/'configs/scenes/brandenburg-gate.json').read_text())
        cmd = module.command_for('process', photo, Path('/persistent'))
        self.assertIn('--skip-colmap', cmd)
        self.assertIn('--skip-image-processing', cmd)
        self.assertIn('False', cmd)
        self.assertIn('/persistent/data/raw/phototourism/brandenburg-gate/dense/sparse', cmd)
        self.assertNotIn('--skip-colmap', module.command_for('process', barn, Path('/persistent')))
        self.assertEqual(module.command_for('train', barn, Path('/persistent'))[-2:], ['--downscale-factor','4'])
        self.assertIn('building.ply', module.command_for('export', barn, ROOT, ROOT/'outputs/barn/run/config.yml'))

    def test_archive_traversal_and_links_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            with zipfile.ZipFile(p/'evil.zip','w') as archive:
                archive.writestr('../escape.txt','bad')
            with self.assertRaises(ValueError):
                extract_archive(p/'evil.zip', p/'out')
            with tarfile.open(p/'evil.tar','w') as archive:
                member=tarfile.TarInfo('link'); member.type=tarfile.SYMTYPE; member.linkname='../escape.txt'; archive.addfile(member)
            with self.assertRaises(ValueError):
                extract_archive(p/'evil.tar', p/'out2')
            self.assertFalse((p/'escape.txt').exists())

    def test_valid_archives_extract_nested_images(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)
            with zipfile.ZipFile(p/'good.zip','w') as archive:
                archive.writestr('Barn/001.jpg',b'image')
            extract_archive(p/'good.zip', p/'out')
            self.assertEqual((p/'out/Barn/001.jpg').read_bytes(),b'image')
            with tarfile.open(p/'good.tar','w') as archive:
                member=tarfile.TarInfo('dense/images/001.jpg'); member.size=5; archive.addfile(member,io.BytesIO(b'image'))
            extract_archive(p/'good.tar',p/'out2')
            self.assertEqual((p/'out2/dense/images/001.jpg').read_bytes(),b'image')

    def test_artifact_records_splat_count_hash_and_camera_space(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); cfg=json.loads((ROOT/'configs/scenes/barn.json').read_text())
            processed=root/cfg['processed']; processed.mkdir(parents=True)
            (processed/'transforms.json').write_text('{"frames":[]}')
            config=root/'outputs/barn/run/config.yml'; config.parent.mkdir(parents=True)
            config.write_text('test fixture')
            exports=config.parent/'exports'; exports.mkdir()
            (exports/'building.ply').write_bytes(b'ply\nformat ascii 1.0\nelement vertex 3\nend_header\n')
            result=module.package_export(cfg,root,config)
            self.assertEqual(result['splat_count'],3)
            self.assertEqual(result['sha256'],sha256(exports/'building.ply'))
            self.assertIn('pre-dataparser',result['coordinates'])
            self.assertTrue((exports/'input-cameras.json').is_file())

    def test_failed_process_is_logged_with_exit_code_and_cost(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / 'data/raw/barn/images'
            images.mkdir(parents=True)
            for i in range(3):
                (images/f'{i}.jpg').touch()
            bindir = root/'bin'; bindir.mkdir()
            tool = bindir/'ns-process-data'
            tool.write_text('#!/bin/sh\necho injected-failure\nexit 7\n')
            tool.chmod(0o700)
            result = subprocess.run([sys.executable,str(ROOT/'pipeline/reconstruction/run.py'),'process',
                '--data-root',str(root),'--hourly-rate-usd','0.5','--execute'],
                env={**os.environ,'PATH':str(bindir)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            logs = list((root/'outputs/barn/command-logs').glob('*/run.json'))
            self.assertEqual(len(logs),1)
            record = json.loads(logs[0].read_text())
            self.assertEqual(record['returncode'],7)
            self.assertGreaterEqual(record['estimated_cost_usd'],0)
            self.assertIn('injected-failure',(logs[0].parent/'console.log').read_text())

    def test_cli_dry_runs_do_not_write_data(self):
        with tempfile.TemporaryDirectory() as directory:
            for scene in ('barn','brandenburg-gate'):
                for stage in ('download','process','split','inspect','train','eval','export','preview'):
                    command=[sys.executable,str(ROOT/'pipeline/reconstruction/run.py'),stage,'--scene',str(ROOT/f'configs/scenes/{scene}.json'),'--data-root',directory]
                    if stage in ('eval','export','preview'):
                        command+=['--load-config',str(Path(directory)/'config.yml')]
                    result=subprocess.run(command,capture_output=True,text=True)
                    self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(list(Path(directory).iterdir()),[])


if __name__ == '__main__':
    unittest.main()

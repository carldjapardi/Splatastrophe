import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("reconstruction", Path(__file__).resolve().parents[1] / "pipeline/reconstruction/run.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Splits(unittest.TestCase):
    def test_disjoint_persistent_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            frames = []
            for i in range(20):
                name = f"{i:03}.jpg"
                (p / name).touch()
                frames.append({"file_path": name})
            target = p / "transforms.json"
            original = json.dumps({"frames": frames})
            target.write_text(original)
            result = module.split_frames(target, 10)
            self.assertEqual(len(result["evaluation"]), 2)
            self.assertFalse(set(result["train"]) & set(result["evaluation"]))
            self.assertEqual(len(result["train"]), 18)
            self.assertEqual(target.with_suffix(".before-split.json").read_text(), original)
            saved = target.read_text()
            with self.assertRaises(ValueError):
                module.split_frames(target, 10)
            self.assertEqual(target.read_text(), saved)

    def test_missing_images_rejected_without_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "transforms.json"
            original = json.dumps({"frames": [{"file_path": f"{i}.jpg"} for i in range(3)]})
            p.write_text(original)
            with self.assertRaises(ValueError):
                module.split_frames(p, 10)
            self.assertEqual(p.read_text(), original)


if __name__ == "__main__":
    unittest.main()

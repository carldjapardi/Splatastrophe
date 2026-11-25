"""Run with python -m unittest discover -s experiments/dbw -p test_part_eval.py."""

import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import part_eval as pe


def primitive():
    return {"id": 91, "center": [0, 0, 0], "half_size": [1, 1, 1],
            "rotation": np.eye(3).tolist(), "eps": [1, 1], "opacity": None}


class PartEvalTests(unittest.TestCase):
    def test_sphere_and_box(self):
        p = primitive()
        np.testing.assert_allclose(pe.implicit_values([[0, 0, 0], [1, 0, 0], [1, 2, 3]], p), [0, 1, 14])
        p["eps"] = [0.1, 0.1]
        self.assertLess(pe.implicit_values([[0.8, 0.8, 0.8]], p)[0], 1)
        self.assertGreater(pe.implicit_values([[1, 1, 1]], p)[0], 1)

    def test_rotated_anisotropic_exponent_axes(self):
        p = primitive()
        p.update(center=[3, 4, 5], half_size=[2, 3, 4], eps=[0.5, 1.5],
                 rotation=[[0, 0, 1], [1, 0, 0], [0, 1, 0]])
        local = np.array([[0.7, 1.1, 2.3], [1, 2, 3]])
        world = local @ np.array(p["rotation"]).T + p["center"]
        expected = ((np.abs(local[:, 0] / 2) ** (2 / 1.5) + np.abs(local[:, 1] / 3) ** (2 / 1.5)) ** 3 + np.abs(local[:, 2] / 4) ** 4)
        np.testing.assert_allclose(pe.implicit_values(world, p), expected)

    def test_huge_values_assignment_is_not_overflow_tie(self):
        p, q = primitive(), primitive()
        p.update(eps=[0.1, 0.1], half_size=[1e-100] * 3)
        q.update(id=500, eps=[0.1, 0.1], half_size=[1e-90] * 3)
        points = [[1e100, 2e100, 3e100]]
        self.assertTrue(np.isfinite(pe.log_implicit_values(points, p)).all())
        self.assertEqual(pe.assign_points(points, [p, q]).tolist(), [1])

    def test_empty_and_malformed(self):
        self.assertEqual(pe.assign_points([[0, 0, 0]], []).tolist(), [-1])
        result = pe.evaluate([], resolution=16)
        self.assertEqual(result["volume_iou"], 0)
        self.assertEqual(result["mean_part_iou"], 0)
        self.assertEqual(result["point_assignment_accuracy"], 0)
        for field, value in (("half_size", [0, 1, 1]), ("eps", [-1, 1]),
                             ("rotation", np.zeros((3, 3)).tolist()), ("center", [float("nan"), 0, 0])):
            p = primitive()
            p[field] = value
            with self.assertRaises(ValueError):
                pe.assign_points([[0, 0, 0]], [p])
        with self.assertRaises(ValueError):
            pe.assign_points([[0, 0, 0]], [primitive(), primitive()])

    def test_file_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "primitives.json"
            path.write_text(json.dumps({"frame": "dbw", "source": "test", "primitives": [primitive()]}))
            self.assertEqual(pe.load_primitives(path)[0]["id"], 91)
            path.write_text(json.dumps({"frame": "viewer", "source": "test", "primitives": []}))
            with self.assertRaises(ValueError):
                pe.load_primitives(path)

    def test_shell_occlusion_and_incident_faces(self):
        block = {"centre": [0, 0, 0], "size": [2, 2, 2]}
        samples = [[0, 0, 1], [0, 0, -1], [0, 0, 0], [3, 0, 0]]
        self.assertEqual(pe.visible_from_cameras(samples, [[0, 0, 4]], [block]).tolist(), [True, False, False, True])
        rear = {"centre": [0, 0, -3], "size": [2, 2, 2]}
        self.assertFalse(pe.visible_from_cameras([[0, 0, -2]], [[0, 0, 4]], [block, rear])[0])

    def test_sampling_reproducibility_and_shell_subset(self):
        full, labels = pe.synthetic_points(n=400)
        again, labels_again = pe.synthetic_points(n=400)
        np.testing.assert_array_equal(full, again)
        np.testing.assert_array_equal(labels, labels_again)
        shell, shell_labels = pe.synthetic_points("shell", n=400)
        keep = pe.visible_from_cameras(full, pe.front_cameras())
        np.testing.assert_array_equal(shell, full[keep])
        np.testing.assert_array_equal(shell_labels, labels[keep])
        self.assertGreater(len(shell), 0)
        self.assertLess(len(shell), len(full))

    def test_voxel_overlap_first_block_and_fault(self):
        a = {"centre": [0, 0, 0], "size": [2, 2, 2], "part": "left wall", "fault": "A"}
        b = dict(a, part="right wall", fault="C")
        result = pe.voxelize([[0, 0, 0], [4, 0, 0]], [a, b])
        self.assertEqual(result["block_index"].tolist(), [0, -1])
        self.assertEqual(result["part_index"].tolist(), [1, -1])
        self.assertEqual(result["fault"].tolist(), ["A", None])

    def test_exact_disjoint_boxes_and_mapping(self):
        blocks = [{"centre": [2 * i, 0, 0], "size": [1, 1, 1], "part": part, "fault": None}
                  for i, part in enumerate(pe.PART_NAMES)]
        primitives = [dict(primitive(), id=100 + i, center=b["centre"], half_size=[0.5] * 3, eps=[0.1, 0.1])
                      for i, b in enumerate(blocks)]
        points = np.array([b["centre"] for b in blocks])
        with patch.object(pe, "_blocks", return_value=blocks):
            result = pe.evaluate(primitives, points, np.arange(8), resolution=2)
        self.assertEqual(result["mapping"], list(pe.PART_NAMES))
        self.assertEqual(result["volume_iou"], 1)
        self.assertEqual(result["mean_part_iou"], 1)
        self.assertEqual(result["point_assignment_accuracy"], 1)

    def test_disjoint_volume_is_penalized(self):
        original = pe.true_primitives()
        baseline = pe.evaluate(original, resolution=24)
        shifted = copy.deepcopy(original)
        for p in shifted:
            p["id"] += 52
            p["center"][0] += 3
        result = pe.evaluate(original + shifted, resolution=24)
        self.assertLess(result["volume_iou"], baseline["volume_iou"] * 0.55)
        self.assertTrue(all(label is None for label in result["mapping"][52:]))
        self.assertEqual(result["voxel_origin"], baseline["voxel_origin"])

    def test_overlapping_prediction_metrics_are_permutation_invariant(self):
        blocks = [{"centre": [2 * i, 0, 0], "size": [1, 1, 1], "part": part, "fault": None}
                  for i, part in enumerate(pe.PART_NAMES)]
        primitives = [dict(primitive(), id=i, center=b["centre"], half_size=[0.5] * 3, eps=[0.1, 0.1])
                      for i, b in enumerate(blocks)]
        primitives[0]["half_size"][0] = 1.5
        primitives[1]["half_size"][0] = 1.7
        points = np.array([b["centre"] for b in blocks])
        with patch.object(pe, "_blocks", return_value=blocks):
            forward = pe.evaluate(primitives, points, np.arange(8), resolution=4)
            backward = pe.evaluate(primitives[::-1], points, np.arange(8), resolution=4)
        self.assertEqual(forward["mapping"][:2], ["base", "left wall"])
        for key in ("part_iou", "mean_part_iou", "volume_iou", "parts_over_0_5", "primitive_count"):
            self.assertEqual(forward[key], backward[key])
        self.assertLess(forward["part_iou"]["base"], 1)
        self.assertLess(forward["part_iou"]["left wall"], 1)

    def test_explicit_grid_limit(self):
        p = primitive()
        p["center"] = [1e20, 0, 0]
        with self.assertRaisesRegex(ValueError, "limit"):
            pe.evaluate([p], resolution=16)

    def test_true_primitive_self_test(self):
        result = pe.self_test(resolution=128)
        self.assertEqual(result["primitive_count"], 52)
        self.assertEqual(result["parts_over_0_5"], 8)
        self.assertEqual(set(result["part_iou"]), set(pe.PART_NAMES))
        self.assertLess(result["exact_box_part_iou"]["lintel"], 0.9)
        self.assertLess(result["part_iou"]["lintel"], 0.9)
        self.assertGreater(result["cross_part_overlap_voxels"]["lintel"], 0)
        for part in pe.PART_NAMES:
            self.assertLessEqual(abs(result["part_iou"][part] - result["exact_box_part_iou"][part]), 0.035)
        for key in ("mean_part_iou", "volume_iou", "point_assignment_accuracy"):
            self.assertGreaterEqual(result[key], 0.95)
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()

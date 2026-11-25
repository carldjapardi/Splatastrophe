import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from fit_primitives_3d import fit_primitives
from prepare_ems import DEFAULT_CHECKOUT


def test_matrix_backend_does_not_raise_spurious_floating_point_errors():
    with np.errstate(all="raise"):
        identity = np.eye(15)
        assert np.array_equal(identity @ identity, identity)


def test_pca_is_deterministic_and_preserves_frame():
    rng = np.random.default_rng(38)
    rotation = Rotation.from_euler("xyz", [.2, -.4, .7]).as_matrix()
    points = rng.uniform(-1, 1, (4000, 3)) * [1, .4, .1]
    points = points @ rotation.T + [4, -3, 2]
    first, report = fit_primitives(points, k=1)
    second, _ = fit_primitives(points, k=1)
    assert first == second
    assert np.allclose(first[0]["center"], [4, -3, 2], atol=.02)
    assert np.allclose(sorted(first[0]["half_size"]), [.1, .4, 1], atol=.02)
    assert np.isclose(np.linalg.det(first[0]["rotation"]), 1)
    assert report["input_points"] == 4000


def test_partial_shell_thickness_is_explicit_for_boxes():
    rng = np.random.default_rng(38)
    points = np.column_stack([rng.uniform(-1, 1, (200, 2)), np.zeros(200)])
    fitted, _ = fit_primitives(points, k=1, minimum_half_size=.01)
    assert min(fitted[0]["half_size"]) == pytest.approx(.01 * np.ptp(points, axis=0).max())


@pytest.mark.parametrize("points", [np.zeros((4, 3)), np.zeros((2, 3)), np.zeros((10, 2)), [[1, 2, np.nan]] * 4])
def test_invalid_point_clouds_are_rejected(points):
    with pytest.raises(ValueError):
        fit_primitives(points, k=1)


@pytest.mark.skipif(not (DEFAULT_CHECKOUT / "Python/src/EMS/EMS_recovery.py").exists(), reason="run prepare_ems.py for official EMS")
def test_official_ems_recovers_known_ellipsoid():
    rng = np.random.default_rng(38)
    points = rng.normal(size=(800, 3))
    points /= np.linalg.norm(points, axis=1)[:, None]
    points = points * [.8, .3, .2] + [2, 3, 4]
    fitted, report = fit_primitives(points, "ems", k=4)
    assert fitted
    assert np.allclose(fitted[0]["center"], [2, 3, 4], atol=.025)
    assert np.allclose(sorted(fitted[0]["half_size"]), [.2, .3, .8], atol=.04)
    assert np.allclose(fitted[0]["eps"], [1, 1], atol=.1)
    assert report["ems"]["commit"] == "5a213d46e8b013b5a153f5aa914b0925ee517af7"


def test_subsampling_has_stable_provenance():
    points = np.random.default_rng(9).normal(size=(500, 3))
    a, ra = fit_primitives(points, k=4, max_points=100, seed=4)
    b, rb = fit_primitives(points, k=4, max_points=100, seed=4)
    assert a == b and ra["fit_points_sha256"] == rb["fit_points_sha256"]
    assert ra["fit_points"] == 100

# Task 2 spec: break a building into physical parts

Issue [#38](https://github.com/carldjapardi/Splatastrophe/issues/38) · owner Yushan · Slack thread: https://splatastrophecs180.slack.com/archives/C0CJJHL4XJP/p1795570191367039 · base branch `yushan/dbw-gate`

This spec is written for a coding agent (Codex) picking up the work. Read it fully before starting.

## 1. Problem statement

Splatastrophe reconstructs real buildings as Gaussian splats and lets people push, shake and break them in the browser. After a review with the professor, the group split into three tasks:
1. Better reconstruction, using VGGT or a Blender-based pipeline.
2. **Fine-grained rigid-body estimation. This spec.**
3. An earthquake simulated on the tower.

**The question for task 2:** given a reconstructed building, how do we split it into pieces so that, when physics runs, each piece behaves like the real thing (a pillar topples like a pillar, a lintel drops when its supports go), and how do we check that it does?

**What physics needs:** a rigid-body engine has no idea what a "pillar" is. A tall, slender, solid body topples about its base edge because of its shape, mass and inertia. So each part needs:
1. **Membership:** which splats (or mesh triangles) move together.
2. **A closed solid:** a collision shape with volume, giving mass and inertia. Our splats are mostly front-facade shells, so splats alone give no usable volume.
3. **Connections:** which parts touch, and a breakable joint between them.
4. **Optionally, fracture:** pre-fractured pieces, so a part can crumble once it separates.

Semantic names (column, lintel) only matter for choosing joint and material strengths.

**Leading approach:** fit primitives, mainly superquadrics (shapes ranging from box to ellipsoid), to the building. Each primitive is a part and a closed solid at once. Splats are assigned to parts by an inside test. The survey and its reasoning are in `experiments/dbw/part-decomposition-research.md`. Read it.

**Three routes to compare:**
- **A.** Render the splat or mesh from virtual cameras and run Differentiable Blocks World (DBW) unchanged on the renders.
- **B.** Like A, plus a chamfer loss pulling block surfaces onto the 3D points.
- **C.** Skip images and fit superquadrics directly to 3D points, using EMS, Marching-Primitives or a simpler baseline.

## 2. What already exists (all under `experiments/dbw/` on `yushan/dbw-gate`)

| File | What it is |
| --- | --- |
| `part-decomposition-research.md` | Literature survey and the three routes |
| `faults_geometry.py` | **NumPy only.** The test building: 52 boxes copied from `web/public/faults/collapse.js` (an arch with base, left and right walls, centre pier, lintel, attic, cornice and top), moved into the DBW frame. `authored_blocks()`, `to_dbw()` and `surface_points(parts, n, rng, return_index=True)` |
| `synthetic_faults.py` | Renders that building into a 200-view DBW dataset: images, masks, exact cameras, `points.npy` and `parts.json`. Needs torch and pytorch3d |
| `synthetic_faults.yml` | DBW config for that dataset |
| `dbw_masks.patch`, `dbw_per_view_K.patch`, `register_loader.patch`, `phototourism.py` | DBW changes: a silhouette loss, a per-view camera fix, and a dataset loader. Upstream DBW is pinned at commit `fb08bd1` |
| `run_dbw.sh` | Sets up DBW on a fresh GPU instance and trains runs in sequence |
| `check_cameras.py`, `check_per_view_K.py`, `check_mask_fit.py` | CPU checks |
| `2026-11-23-gate-v1.md`, `2026-11-24-gate-v2.md`, `README.md` | Records of the gate runs. Both failed because of the camera bug, which is now fixed |

**DBW frame:** x right, y up, ground at y = −0.9. The test building is 1.4 units tall and about 2.15 wide, and its front faces +z.

**Results so far:**
- In a CPU mask-only DBW fit, block-to-mask IoU went from 0.43 to 0.87 on the test building and from 0.33 to 0.70 on the real gate.
- No full DBW run with the camera fix has been done yet. It needs a GPU, and the GCP T4 quota is pending.

**Gate splat:** `web/public/models/brandenburg-spirula.sog` (22 MB, PlayCanvas SOG format) and its catalog entry in `web/public/catalog.json` (the viewer applies `rotationX: 180`). The full 468 MiB PLY is on Sriya's machine and isn't in Git.

## 3. Phases

Phases 1, 2, 4 and 5 run on CPU. Phase 3 needs a GPU: prepare its code, then ask Yushan to run it.

### Phase 1: evaluation harness (CPU)

Write `experiments/dbw/part_eval.py`, which imports `faults_geometry`.

- **Primitive format:** JSON
  `{"frame": "dbw", "source": str, "primitives": [{"id": int, "center": [3], "half_size": [3], "rotation": [[3x3]] (world from local), "eps": [e1, e2], "opacity": float|null}]}`.
  Inside test, in local coordinates: `F = ((|x/a1|^(2/e2) + |y/a2|^(2/e2))^(e2/e1) + |z/a3|^(2/e1)) < 1`. A box is approximately eps ≈ 0.1. When exporting from DBW, follow DBW's own superquadric parametrization (`implicit_sq` and the block-building code in `src/model/dbw.py`), and say in the code which axis carries which exponent.
- **Ground truth:** voxelize the 52 boxes at about 1/128 of the building height. Each voxel gets one of the 8 part labels, plus its block id and fault label.
- **Metrics:**
  - **Part IoU:** map each primitive to the true part holding the majority of its voxels, then compute IoU per part. Report the mean over the 8 parts and how many parts reach IoU > 0.5.
  - **Volume IoU:** union of all primitives against union of all boxes.
  - **Point assignment accuracy:** assign each surface point to the primitive with the smallest F, then through the mapping to a part, and compare with the point's true part.
  - **Primitive count.**
  - **Optional block-level recovery:** how many of the 52 boxes have a best-matching primitive with IoU > 0.5.
- **Point-set variants:**
  - `full`: `surface_points`.
  - `shell`: only points visible from cameras in front (azimuth within ±60° of +z, elevation 0–30°), using a simple ray-box occlusion test. This mimics facade-only splats.
- **Self-test:** feeding the 52 true boxes as primitives must give part IoU ≈ 1 and assignment accuracy ≈ 1.

### Phase 2: route C, direct 3D fitting (CPU)

Write `experiments/dbw/fit_primitives_3d.py` to produce primitive JSON from a point set. Implement and compare:
1. **Baseline:** cluster the points (for example region growing on normals and position, DBSCAN, or k-means with a chosen k), then fit an oriented box to each cluster with PCA.
2. **EMS** (hierarchical multi-superquadric), from the official code: https://github.com/bmlklwx/EMS-superquadric_fitting. Check whether it has a Python implementation. If it's MATLAB only, port the parts you need or record that it was skipped.
3. **Marching-Primitives** (https://github.com/ChirikjianLab/Marching-Primitives) on an SDF. For `full`, build the SDF from the true boxes, an upper bound that shows what MP can do with perfect geometry. For `shell`, build it from the points if you can, otherwise record why not.
4. **Optional: CoACD** (`pip install coacd`, box output mode) on a mesh of the building, as a collision-oriented reference.

**Outputs:**
- A results table: method × {full, shell} × metrics.
- Figures of primitives coloured by their mapped part next to the ground truth, from a front view and a three-quarter view.
- A record at `experiments/dbw/YYYY-MM-DD-route-c-synthetic.md`.
- Each method must finish in under 15 min on a laptop CPU.

### Phase 3: routes A and B, DBW (GPU; prepare code, Yushan runs it)

- Write `experiments/dbw/dbw_export_blocks.py`. It loads a DBW `model.pkl` (CPU is fine), keeps blocks with opacity > 0.5, and writes primitive JSON in the DBW frame. Test it on `outputs/dbw/v2/runs/gate_v2/model.pkl` if you can get it; otherwise test with a freshly initialized model.
- Route A is ready: `run_dbw.sh synth_v1:synthetic_faults.yml:synthetic_faults.tar.gz`. Score the result with `part_eval.py` when it comes back.
- Route B: write a DBW patch, `dbw_chamfer.patch`, that adds a weighted chamfer loss between points sampled on block surfaces and `pc_gt`. DBW already loads `pc_gt` for evaluation; see the loader. Add a config flag for its weight, off by default. Check that it trains for a few steps on CPU.
- Don't start cloud instances. Yushan runs GPU jobs, deletes instances right after, and shares the results.

### Phase 4: apply the best route to the gate splat (CPU)

- Decode the SOG to Gaussian centers, opacities and scales, for example with PlayCanvas `splat-transform` (check it reads `.sog`; if not, write a decoder). Keep the original splat order and indices.
- Run the best phase-2 method on the centers, filtered to opacity above a threshold. Choose the frame and units, and record them, along with the transform to the viewer frame (`rotationX: 180`).
- **Reference grouping:** use the manual grouping if one exists (plan section 6; ask in the thread). Otherwise hand-label a coarse reference: base, each column, attic, quadriga.
- **Export:** `part_id` per splat index (`.npy` plus JSON metadata) and the primitive JSON. This must keep stable splat IDs, as plan section 2 requires.

### Phase 5: physics checks (CPU)

- **Topple test:** use PyBullet, or another engine with a deterministic step. Take a single fitted pillar (or a box with the same width b and height h) on a ground plane, start it tilted 2° past its tipping angle, and record:
  1. the rotation axis, which should be the base edge;
  2. the time to reach 60° from vertical.

  Compare with numerical integration of `I·φ'' = m·g·R·sin(φ − α)`, where `I = m(b² + h²)/3`, `R = ½√(b² + h²)` and `α = atan(b/h)`, starting from `φ0 = α + 2°`. Report the relative error. Target: within 10%.
- **Contacts:** from the primitives, export the pairs of parts that touch, with an approximate contact area. This is the input for breakable joints. Don't edit `web/src/impact` or any other web code. That's Isaac's area, and the joint layer will be agreed with him.
- **Optional:** run the test building as primitives with fixed joints in PyBullet, remove the left wall (fault A), and check that the parts above it fall instead of floating. The `/faults/` page currently leaves them floating.

## 4. Constraints

- **Coordination:** follow `AGENTS.md`. Read `docs/IMPLEMENTATION_PLAN.md` first. Post progress, blockers and handoffs only as replies in the #38 Slack thread above, prefixed `[codex-yushan-task2]`, and keep issue #38 updated.
- **Branching:** work on a branch `codex/task2-part-decomposition` cut from `yushan/dbw-gate`. Open a PR into `yushan/dbw-gate`, not `main`.
- **Files:** stay inside `experiments/dbw/`. Don't modify `web/`, `pipeline/` or other agents' files.
- **Data:** keep large data out of Git. Generated datasets, fits and figures go under `outputs/` (git-ignored). Commit only small figures used in records.
- **Reproducibility:** record exact settings, seeds, library versions, runtime and machine in every record. Report failures as failures; a documented negative result is acceptable.
- **No spending:** no GPU or cloud spend.

## 5. Acceptance

- [ ] `part_eval.py` passes its self-test, true boxes in → IoU ≈ 1.
- [ ] Route C results on the test building for at least the baseline and one of EMS or Marching-Primitives, on both `full` and `shell`, with a table and figures.
- [ ] `dbw_export_blocks.py` and `dbw_chamfer.patch` written and smoke-tested on CPU.
- [ ] Gate splat decoded, best route applied, and `part_id` per splat exported, with a comparison against a reference grouping.
- [ ] Topple test within 10% of the analytic fall time, and the rotation axis at the base edge.
- [ ] Records in `experiments/dbw/`, a summary in issue #38, and progress posted in the #38 thread.

## 6. Open questions to raise in the thread, not to decide alone

- Who owns the browser joint and fracture layer, Isaac's impact code or a new module?
- Does a manual grouping of the gate exist yet?
- Should task 1's meshes (VGGT or Blender) replace the splat as the input for route C once they exist?

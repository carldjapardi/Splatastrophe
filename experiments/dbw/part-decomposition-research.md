# Breaking a building into physical parts: research notes

November 24, 2026 · task 2 of the post-review plan (fine-grained rigid body estimation) · owner Yushan (`claude-yushan-physics`) · [issue #30](https://github.com/carldjapardi/Splatastrophe/issues/30)

The question: given a reconstructed building, how do we split it into pieces so that, when physics runs, a pillar falls like a pillar? And how do we check that it did?

## What the physics actually needs

A rigid-body engine doesn't know what a pillar is. A tall, slender, solid body resting on a base topples about its bottom edge because of its shape, mass and inertia. So the job is mostly geometric. For each piece we need:

1. **Membership:** which splats move together.
2. **A closed solid:** a collision shape with volume, from which mass and inertia follow. Our splats are mostly front-facade shells (Isaac's survey on Nov 23–24), so a part made only of splats has no volume and gets the wrong inertia.
3. **Connections:** which pieces touch, how strongly they're held, and when that bond breaks.
4. **Finer breaking (optional):** how one piece crumbles further after it separates.

Semantic labels ("column", "lintel") only matter when choosing materials and joint strengths, for example weak mortar between drums and strong stone within them. They aren't needed for a pillar to fall like one.

Primitive fitting covers items 1 and 2 at once: each primitive is a closed solid, and every splat inside it belongs to it. That's why DBW is worth pursuing even though segmentation-only methods are better known.

## Method families

| Family | Examples | Input → output | Fit for us |
| --- | --- | --- | --- |
| Primitive fitting from images | [DBW](https://arxiv.org/abs/2307.05473) (NeurIPS 2023); [PartGS](https://arxiv.org/abs/2408.10789) (ICCV 2025), hybrid 2D Gaussians + superquadrics; GaussianBlock, SAM-guided splitting and merging (several hours per scene, as reported by the PartGS authors) | Posed images → textured superquadrics | Gives solids and parts together. Sensitive to cameras, lighting and occluders. About 4 h on one GPU per scene ([DBW repo](https://github.com/monniert/differentiable-blocksworld)) |
| Primitive fitting from 3D | [EMS](https://arxiv.org/abs/2111.14517) (CVPR 2022): robust superquadric fit to a point cloud, with a hierarchical multi-superquadric extension. [Marching-Primitives](https://arxiv.org/abs/2303.13190) (CVPR 2023): superquadrics grown from an SDF ([code](https://github.com/ChirikjianLab/Marching-Primitives)) | Points or SDF → superquadrics | Fast and runs without a GPU. Needs decent 3D geometry, and our splats are shells |
| Convex decomposition for collision | [CoACD](https://arxiv.org/abs/2205.02961) (SIGGRAPH 2022), `pip install coacd`, can output boxes; V-HACD | Closed mesh → convex pieces | The standard way to turn a part into engine colliders. Pieces follow concavity, not architecture |
| Learned part segmentation | [PartField](https://arxiv.org/abs/2504.11451) (NVIDIA 2025, hierarchical clusters; the authors say it handles meshes, point clouds and splats), [SAMPart3D](https://arxiv.org/abs/2411.07184), [P3-SAM](https://arxiv.org/abs/2509.06784) | Mesh, points or splats → part labels at several scales | Good membership, no solids. Trained on objects, so architectural parts are untested |
| Splat segmentation | [SAGA](https://arxiv.org/abs/2312.00860) (SAM features per Gaussian, scale gate), Gaussian Grouping, GARField (scale-conditioned) | Trained splat + SAM → clusters | Promptable ("click the pillar"). Gives membership only |
| Architecture point-cloud segmentation | [ArCH](https://archdataset.polito.it) benchmark: classes arch, column, moldings, wall, vault, roof, etc.; DGCNN baselines | Survey point clouds → semantic classes | Labels columns explicitly. Needs dense scans; our splat centers are much sparser |
| Fracture: precomputed | Voronoi cell fracture (Blender); [Breaking Good / fracture modes](https://www.dgp.toronto.edu/projects/breaking-good/) (SIGGRAPH Asia 2022): impact-dependent patterns from precomputed modes, real time ([code](https://github.com/alecjacobson/fracture-modes)) | Closed mesh → fragments | For crumbling a part after it separates. Runs in the browser at playback |
| Fracture: continuum on Gaussians | PhysGaussian (MPM); [Fracture-GS](https://iclr.cc/virtual/2026/poster/10006441) (ICLR 2026); [GaussianFluent](https://arxiv.org/abs/2601.09265) (2026), brittle fracture with continuum-damage MPM; [PIGS](https://neurips.cc/virtual/2026/165849) (NeurIPS 2026), peridynamics | Splats + material → simulated cracks | Most realistic, but offline GPU simulation. Precomputed tracks only |
| Structural engineering | Rigid-block DEM (3DEC) for masonry earthquake collapse ([shake-table validation](https://link.springer.com/10.1007/s10518-023-01640-y)); [Amatrice Civic Tower](https://iris.univpm.it/retrieve/92a5b173-8205-41a9-b807-e659a51be5ec/Di%20Giosafatte_Alternative-approaches-computational-mechanics_2025.pdf), about 11,500 blocks, with Blender as a faster first pass; [game physics engines for collapse](https://espace2.etsmtl.ca/31237/1/Andrews-S-2025-31237.pdf) | Block geometry + material → collapse | Reference for task 3 (earthquake) and for what "falls correctly" means. Engineers model masonry as many rigid blocks with contact, close to what we'd build |

## How DBW works

- **Scene model:** up to N blocks, each a superquadric mesh (a deformed icosphere) with its own texture. Its parameters are scale, rotation, translation, two shape exponents (box to ellipsoid) and an opacity. A ground plane and a textured background dome sit behind the blocks.
- **Optimization:** a differentiable renderer (PyTorch3D, with layered transparency) compares renders to photos using rgb and perceptual losses. A parsimony loss on opacity pushes unneeded blocks to zero, an overlap loss discourages blocks from interpenetrating, and a TV loss smooths textures. Our patch adds a silhouette loss against gate masks.
- **Two phases:** in the coarse phase, opacities are soft and noisy so blocks can appear, move and disappear. In the fine phase, blocks become opaque (opacity above 0.5) and textures are sharpened.
- **Output:** a handful of solid, posed superquadrics. Each one is directly a rigid-body collider with a volume.

**Limits that matter for buildings:**
- **Block count:** set in advance, and parsimony prunes it. A six-column gate needs at least about 9 blocks (base, 6 columns, attic, statue) before any finer split.
- **Convex shapes only:** each block is a convex superquadric. Arches and openings have to come out as several blocks, which matches how masonry is built anyway.
- **Images only:** the photos have to agree with each other. Crowds, lighting changes and camera errors all hurt. Our gate runs failed because DBW used one camera's intrinsics for every photo; see the [v2 record](2026-11-24-gate-v2.md#camera-check-november-24-both-runs-used-the-wrong-intrinsics). The fix raised block-to-mask IoU from 0.35 to 0.70 in a CPU test.
- **Local minima:** a rendering loss alone gets stuck in local minima for superquadric shape. The PartGS authors report the same problem.

## Applying DBW to splats and models

DBW needs posed images. A trained splat or a mesh can produce as many as we want.

**A. Render, then fit (DBW unchanged).** Render the splat (or mesh) from a few hundred virtual cameras, with alpha masks taken from opacity, then run DBW on those renders.
- What the renders fix: the lighting is baked in and identical across views, the masked splat has no crowds, and the cameras are exact.
- The blocks come out in the splat's own frame, so assigning splats to parts is an inside/outside test against each superquadric. DBW already has `implicit_sq` for this.
- `synthetic_faults.py` already does this for a mesh, the `/faults/` block building.
- For a splat we need a splat renderer, such as gsplat on the GPU instance. Only render views the splat actually covers, because its back is empty.
- Even so, DBW's blocks are solids, so the parts get closed volumes.

**B. DBW with 3D supervision.** Add a chamfer loss between block surfaces and splat centers. DBW already samples points for its evaluation chamfer (`pc_gt`). This should cut down the local-minimum failures and speed things up. It's a small code change on top of A.

**C. Skip images.** Fit superquadrics straight to the splat centers or a mesh:
- EMS for each candidate cluster, or Marching-Primitives on an occupancy or SDF grid built from the splat.
- It takes minutes on a CPU. It's weakest where the splat has no back, but the faults building and any mesh from task 1 are complete.

The three routes can share one evaluation: on the synthetic building we know every true block and part (`parts.json`).

## Proposed pipeline for task 2

1. **Decompose.**
   - Run A and C on the synthetic building first, where true parts are known, and score them by block-to-part IoU and by how many true parts each method recovers.
   - Then run the better one on the gate splat and compare with manual grouping, per plan section 7.
2. **Parts to bodies.** Each primitive becomes a collider: a box or convex hull, or CoACD pieces if the part is concave. Mass is volume × density. Each splat follows its part's rigid transform, the same mechanism as Bounce and Sway but per part.
3. **Connections.**
   - Put a joint between every pair of touching parts, with a break force (for example fixed joints in Rapier, which the impact prototype already uses).
   - The `/faults/` page's "fault points" become weakened joints.
   - This fixes the floating-attic bug on that page: once a support breaks, the parts above it fall because nothing holds them.
4. **Finer breaking.** Pre-fracture each part (Voronoi, or fracture modes for impact-dependent patterns) so a pillar can stay whole when it topples and crumble when it hits the ground.
5. **Check that it falls right.**
   - Geometric check: each part matches its true or manual part.
   - Physical check: a topple test. Tip a pillar and confirm it rotates about its base edge, with fall time close to the analytic toppling of a rigid block of the same height and width.
   - For task 3, compare a shaken model qualitatively with rigid-block DEM results from the masonry literature.

## Where our experiments stand

- **Gate, DBW from photos:**
  - v1 and v2 failed because of the shared-intrinsics bug.
  - The per-view K patch passes CPU checks (IoU 0.35 → 0.70).
  - A full GPU rerun is waiting on GCP GPU quota.
- **Synthetic building, DBW from rendered views (route A on a mesh):**
  - The dataset is built and checked: 200 views, 52 known boxes, 99% of points inside the masks.
  - A CPU mask fit is running.
  - The full GPU run is queued with the gate rerun in `run_dbw.sh`.
- **Not started:** route B (3D loss), route C (EMS or Marching-Primitives), rendering the gate splat for route A, and splat-to-block assignment.

For task 1, [VGGT](https://arxiv.org/abs/2503.11651) (CVPR 2025 best paper) predicts cameras, depth and point maps in one forward pass. Better cameras and denser geometry help every route above, especially C.

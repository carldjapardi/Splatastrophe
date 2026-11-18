# Splatastrophe implementation plan

Review draft — November 17, 2026. Assumes the December 4 deadline and $100 GPU budget in the proposal still apply. Dates are proposed checkpoints, not estimates of guaranteed research completion. This is a reviewable roadmap; implementation tasks remain open.

## 1. Define the first release

Deliver an interactive website with a playground viewer and a reusable library of buildings. Visitors choose a building, orbit/zoom, select components, apply supported actions, and see it bend, sway, or respond to impact while retaining camera control. Include reset, appearance controls, and a methods/results page. One building is the first technical milestone, not the final product scope. Proposed initial catalog target: three buildings, with at least two to demonstrate that the pipeline and viewer generalize; the exact catalog size remains a scope decision. Start with one active building at a time; a simultaneous multi-building scene is a later extension.

The research objective is to test whether structural grouping makes splat animation more controllable and visually coherent. Manual grouping establishes a baseline; automatic grouping using Differentiable Blocks World is an explicit experiment. If it fails, report that result and keep the manual baseline functional.

Required product capabilities: multiple selectable buildings, a common action interface, and visible bending/deformation for supported actions. Proposed actions are push/bend, lateral shake, and impact; implement at least two, including one that bends the building. Stretch scope: larger destruction, automatic material suggestions, physical relighting, and user-uploaded reconstruction. The original proposal favors precomputed physics to fit the GPU budget. Use discrete action locations/directions/strengths backed by clips for the initial implementation; if continuous dragging or freely adjustable forces are required, prototype a lightweight live deformation model and validate its cost before promising that behavior. Playback speed does not change physical stiffness or impact force.

## 2. Establish the architecture and interfaces

- Web: React, TypeScript, Vite, Three.js, and Spark as the initial splat renderer candidate. Use Vercel for the site; no backend is needed for the first release.
- Offline pipeline: Python scripts for data preparation, reconstruction export, component assignment, simulation conversion, and evaluation.
- Reconstruction: COLMAP poses and Nerfstudio Splatfacto training/export.
- Physics: test PhysGaussian in its own pinned GPU environment for high-quality offline responses. Keep reconstruction and physics environments separate. Prototype a lightweight browser deformation model only if continuous force interaction is needed; label approximate visual responses accurately.
- Assets: small development examples can live with the site. Keep datasets, checkpoints, and large animation files outside Git; use object storage for deployment when needed.

Proposed repository layout:

```text
web/                  project site and playground
pipeline/             prepare, export, group, simulate, evaluate
configs/              scene and experiment settings
experiments/          run logs and result tables
docs/                 setup, data format, methods
assets/sample/        small redistributable smoke-test asset
```

Define a building catalog with stable IDs, names, thumbnails, attribution, manifest URLs, loading sizes, and supported actions. Adding a building should require new assets/configuration rather than new viewer code. Load the selected building on demand and release the previous model and clip memory.

Define a versioned scene manifest: coordinate convention, world scale, default camera, bounds, component IDs, pivots, fixed flags, asset URLs, and available actions/clips. Each action declares supported target regions, direction/strength choices, playback or live-response mode, and reset rules. Use an action dispatcher to translate viewer input into the selected building's response; disable unsupported controls with clear explanations. Record the exact transforms between reconstruction, simulation, and viewer coordinates. Assign physical scale explicitly; reconstructed coordinates alone do not establish meters.

Use component translation/quaternion tracks for rigid motion and a separate deforming-splat stream for bending; a live deformation field is a proposed additional path to prototype. Whole-component rotation alone does not satisfy visible bending. Keep stable splat IDs through grouping and simulation export. Any pruning/reordering must update the mapping.

Checkpoint: one sample asset loads through the manifest, uses the correct orientation, and resets deterministically.

## 3. Prove component motion before major GPU spending

Load a small existing, appropriately licensed splat or a tiny reconstruction. Split it into 2–3 spatial groups. Keep one fixed and translate/rotate another about a recorded pivot. Render all components in a shared scene and check sorting when they overlap.

Test from several camera angles, especially at component seams. Confirm that orientation and covariance follow motion; updating centers alone is insufficient. Check view-dependent appearance under rotation. Start with small displacements because motion can expose surfaces absent from the photographs.

Spark exposes object transforms, recoloring, and frame callbacks, making it a suitable candidate for this prototype; benchmark its actual behavior before committing to the full viewer. [Spark SplatMesh documentation](https://sparkjs.dev/docs/splat-mesh/)

Checkpoint: independent motion, fixed background/foundation, working reset, and at least 20 FPS on a named test laptop at a recorded viewport resolution. This scripted diagnostic is not counted as a physics result.

Fallback: reduce splat count, improve grouping, or narrow the allowed motion. If severe artifacts remain, choose a simpler structure before scaling up.

## 4. Select and prepare one reconstruction dataset

Choose one compact structure with overlapping views, visible boundaries, and manageable background clutter. Use a consistent capture first; evaluate PhotoTourism as a later test if uncontrolled lighting and coverage complicate the baseline. Treat PhotoTourism and Tanks and Temples as separate scene sources, not one merged photo collection.

Inventory image counts, available camera poses, dataset terms, and redistribution restrictions. Reserve approximately 10–20% of views before training and record the split. Reuse valid supplied poses; otherwise run COLMAP and inspect registered cameras and sparse points. Document whether test images contributed to pose estimation even though they are excluded from appearance training.

Keep original images intact. Estimate poses before destructive background removal; inspect masks separately and validate how the training loader actually uses them. Crop splats after reconstruction if inconsistent masks hurt results.

Checkpoint: coherent camera coverage, a saved split, and a reproducible dataset configuration. Switch to an easier scene if alignment remains poor after a bounded debugging session.

## 5. Train, evaluate, and export a static reconstruction

Run a short, reduced-resolution Splatfacto training job first, then a longer run only if the baseline is useful. Log configuration, GPU time, cost, splat count, and checkpoint location. Export PLY and compare the browser rendering against Nerfstudio views; export support does not guarantee identical rendering conventions. [Nerfstudio Splatfacto documentation](https://docs.nerf.studio/nerfology/methods/splat.html)

Evaluate held-out images at matching cameras and resolution. Target the proposal's PSNR ≥ 15 dB and SSIM ≥ 0.60. Report the exact mask/background policy, per-view results, and aggregate values. Keep these metrics separate from animation quality. Save a full-quality export before pruning or compression; reevaluate after optimization.

After validating the first building, repeat the preparation/export workflow for the remaining catalog entries, preserving per-building metrics, scale, attribution, component configuration, and supported actions.

Checkpoint: a real reconstructed scene in the browser, held-out metrics, and acceptable file size/FPS; then at least two buildings load through the same viewer code. These thresholds are goals, not promised outcomes.

## 6. Create the manual structural baseline

Assign splats to 3–6 components using boxes or spatial selection, then manually correct boundaries. Label foundation/supports as fixed. Store labels, pivots, attachment regions, and physical parameters in configuration rather than embedding scene-specific values in the viewer.

Repeat the motion test and record seam artifacts and unintended motion. This baseline becomes the reference for the automatic grouping experiment and the fallback for the final demo.

Checkpoint: components can be highlighted individually; the foundation stays fixed during repeatable motion.

## 7. Run the Differentiable Blocks World experiment

First reproduce a small provided example, then fit primitives to the chosen scene using its calibrated images. DBW optimizes textured superquadric primitives from images; it is not a ready-made semantic labeler for Gaussian splats. [Differentiable Blocks World paper](https://arxiv.org/abs/2307.05473)

Build the adapter: align coordinate systems, assign splat centers to primitives using containment/distance, resolve overlaps, and flag unassigned splats. Inspect whether primitives correspond to useful structural components. Primitive geometry does not automatically determine anchors, joints, or material properties.

Compare assignments with the manual baseline using matched component labels, assignment coverage, manual correction time, and the same animation scenes. Keep a fixed timebox of roughly two working days for initial integration. If the method requires substantial research, preserve partial results and classify the final grouping as manual or semi-automatic accurately.

Checkpoint: an automatic/semi-automatic grouping result with a comparison, or a documented failure analysis with representative examples.

## 8. Validate physics and browser playback together

Run a provided PhysGaussian example early, while the reconstruction track proceeds. Its documented setup includes a separate Gaussian Splatting dependency and GPU environment. For a custom scene it requires preprocessing, alignment, simulation bounds, and possibly interior particle filling. [PhysGaussian repository](https://github.com/XPandora/PhysGaussian)

Test the Nerfstudio-to-PhysGaussian adapter explicitly: parameter encodings, SH layout, scale, rotation, opacity, model directory expectations, and stable particle correspondence. Use one deformable component, a fixed support region, manually chosen material values, and a small impulse first. Group labels must become actual boundary/material conditions; they do not automatically create mechanical connections.

Implement at least two user-triggered actions per release building, including a bending response such as lateral impulse with recovery, plus impact/displacement. Map clicks to supported target regions and expose only the strength/direction choices actually simulated. Define behavior for repeated inputs: initial clip mode can reset/restart or queue a response; it must not imply that arbitrary forces accumulate. Continuous force composition requires the live-response experiment. Treat a meteor as a visual effect tied to an implemented collision or prescribed impulse, and document which one it uses.

For deforming playback, export changing positions and covariance (or rotation/scale derived from it), plus any required appearance updates. Preserve static attributes once and store chunked/compressed keyframes. Test a short clip in the browser before generating longer simulations. A fixed-camera MP4 is useful evidence, but does not meet the orbitable-playground requirement.

If deformation storage or playback is impractical, test a reduced deformation model or articulated proxy with smooth splat deformation. Compact rigid component tracks remain useful for impact/displacement, but rigid motion alone is only an interim demo and does not fulfill the bending requirement. These alternatives are separate methods, not equivalent implementations of PhysGaussian; document their limitations and validate seams and covariance behavior.

Checkpoint: user actions produce visible responses on each release building, including bending, with camera control, stable supports, bounded downloads/memory, and documented simulation settings.

## 9. Complete the playground and publish

Build the UI around the building catalog and playground: building picker with previews, orbit/zoom/reset, component/target selection, recolor, action tools, supported direction/strength controls, play/pause/scrub for clips, and clear loading/error states. Design the main interaction as choose building → choose action → select target/settings → apply → observe/reset. Offer quality presets if needed. Display playback speed separately from scenario strength.

Start appearance controls with tint, exposure, and background. Standard splats encode captured appearance; adding a Three.js light does not automatically give correct landmark relighting. Treat dynamic shadows/relighting as a separate experiment after the required demo works.

Add the project explanation, pipeline illustration, dataset credits, experiment comparisons, metrics, limitations, and repository link. Deploy an early preview, then test the final Vercel site with its actual asset URLs, CORS settings, caching, and deep links. Measure loading from a cold cache as well as steady playback.

Checkpoint: a visitor can open the published link, switch between buildings, apply both supported actions to each, see bending, move the camera during the response, and reset successfully. Switching buildings repeatedly must not retain stale actions or leak model memory. Retain a recorded demo as backup evidence.

## Proposed schedule

| Dates | Checkpoint |
|---|---|
| Nov 18–19 | Catalog/action interfaces; sample viewer; component motion and bending feasibility; PhysGaussian smoke test |
| Nov 20–22 | Dataset preparation, first reconstruction, held-out metrics, browser export |
| Nov 23–25 | Manual grouping, first action-driven bending response, short dynamic playback proof; prepare additional buildings |
| Nov 26–28 | Timeboxed DBW comparison; second action; repeat pipeline for remaining release buildings |
| Nov 29–Dec 1 | Catalog switching, full action controls, asset optimization, appearance controls, deployment |
| Dec 2–3 | Evaluation, browser testing, figures, write-up, final fixes |
| Dec 4 | Submission buffer and final link verification |

Prioritize a functioning manual-grouping demo if research work slips. If action-driven bending fails by Nov 25, prioritize a reduced deformation model or smaller scenes and reassess the schedule. A rigid-motion-only viewer is a partial milestone, not completion of the intended product. Automatic materials and physical relighting are the first features to defer.

## GPU budget and completion criteria

Proposed $100 allocation: $10 environment/smoke tests; $35 reconstruction; $20 physics; $15 DBW; $20 contingency. These are spending caps, not provider quotes. Set a cost limit before each job, save checkpoints, and shut down idle instances. Verify actual rental and asset-storage charges before committing funds.

Done means: a reusable catalog with multiple buildings (proposed target three; minimum two); building switching without viewer code changes; reproducible configurations and held-out PSNR/SSIM reports for our reconstructions; at least two supported actions per release building including visible bending; free camera movement during responses; reliable reset; ≥20 FPS on the stated test machine/resolution; a published playground and results page; and an honest account of automatic grouping, precomputed versus live responses, and fallback methods. Evaluate action-to-response latency and repeated building-switch memory behavior as well as rendering FPS. Existing licensed sample buildings may help test the catalog, but identify them separately from our own reconstructions.

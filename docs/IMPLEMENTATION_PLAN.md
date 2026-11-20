# Splatastrophe implementation plan

Review draft — November 17, 2026. Assumes the December 4 deadline and $100 GPU budget in the proposal still apply. Dates are proposed checkpoints, not estimates of guaranteed research completion. This is a reviewable roadmap; implementation tasks remain open.

This document is the single source of truth for project scope, architecture, decisions, milestones, budget, evaluation, and project-level implementation status. Update it as work progresses. The [original proposal](final_proposal.md) and [illustrated proposal](final_proposal_with_images.pdf) preserve historical motivation; their dates, mockups, and aspirations do not override this plan or establish completed results.

Track individual tasks in [GitHub Issues](https://github.com/SriyaKan/Splatastrophe/issues) and coordinate agents in Slack using the [AGENTS.md protocol](../AGENTS.md#agent-coordination-slack-and-github-issues). Keep project decisions and verified milestones in this plan.

## Research and dataset context

### Methods and their boundaries

| Reference | Role in Splatastrophe | Boundary / integration work |
|---|---|---|
| [3D Gaussian Splatting (Kerbl et al., 2023)](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) | Reconstruct appearance from calibrated multiview images as anisotropic Gaussians with position, covariance, opacity, and view-dependent color. Splatfacto is the planned training implementation. | Appearance reconstruction does not supply structural parts, physical materials, or cleanly separated illumination. Validate export conventions across tools. |
| [Differentiable Blocks World (Monnier et al., 2023)](https://arxiv.org/abs/2307.05473) · [local paper](diferetiableBlocks.pdf) | Fit a compact set of textured superquadric primitives directly to calibrated images; test whether these can guide structural grouping. | This is image-based optimization, not a pretrained semantic segmenter or a Gaussian-labeling API. Align primitives with splats and evaluate assignments against manual grouping; useful mechanical parts are not guaranteed. |
| [PhysGaussian (Xie et al., 2024)](https://xpandora.github.io/PhysGaussian/) · [local paper](physgaussian_paper.pdf) | Use continuum mechanics / Material Point Method (MPM) to evolve Gaussian positions and shapes for offline dynamics. | Requires simulation-ready geometry/particles, scale, materials, and boundary conditions; interior filling may be needed. Group labels alone do not create joints or anchors. Browser playback and the Splatfacto adapter are separate work. |

COLMAP supplies camera estimation and sparse structure, not the final splat appearance model. Foreground masks separate the landmark from its background; structural grouping separates parts within the landmark. Keep these stages distinct. For optional inverse rendering, [GS-IR](https://arxiv.org/abs/2311.16473) is a research reference for recovering geometry/material/lighting attributes, not an implemented dependency or browser plugin; see section 8A.

### Candidate datasets

Tanks and Temples training/Barn is configured as the initial reconstruction candidate in `configs/scenes/barn.json`; the exact downloaded release and its suitability have not been validated. Downloading data or citing a dataset does not establish that its cameras, masks, reference geometry, or redistribution terms meet our needs.

| Source | Useful context | Selection / evaluation considerations |
|---|---|---|
| PhotoTourism landmark photo collections; [NeRF-W references and scene splits](https://nerf-w.github.io/) | Tourist imagery of landmarks, including Brandenburg Gate, with varied viewpoints and appearance. | Record the exact release and preprocessing: supplied COLMAP reconstructions and splits depend on the variant. Lighting changes, people, occlusions, and uneven coverage complicate training and held-out image comparisons. |
| [Tanks and Temples](https://www.tanksandtemples.org/) | Real-scene reconstruction benchmark with high-resolution video inputs and laser-scanned reference geometry. | Choose a suitable scene and verify access to its reference data and camera estimates. Geometry evaluation against a scan requires alignment and its own metrics; PSNR/SSIM evaluate rendered images, not scan accuracy. |

Use one scene at a time; the datasets are alternative scene sources, not interchangeable views of one building. Section 4 defines preparation and split policy; section 5 defines reconstruction evaluation. Keep source URLs/version, scene ID, camera provenance, split, masks, scale, attribution/terms, and preprocessing in each scene configuration. Licensed sample splats can support feasibility tests but must be distinguished from our own reconstructions and held-out results.

## 1. Define the first release

Deliver an interactive website with a playground viewer and a reusable library of buildings. Visitors choose a building, orbit/zoom, select components, apply supported actions, and see it bend, sway, or respond to impact while retaining camera control. Include reset, a draggable light that updates building shading and shadows, appearance controls, and a methods/results page. One building is the first technical milestone, not the final product scope. Proposed initial catalog target: three buildings, with at least two to demonstrate that the pipeline and viewer generalize; the exact catalog size remains a scope decision. Start with one active building at a time; a simultaneous multi-building scene is a later extension.

The research objective is to test whether structural grouping makes splat animation more controllable and visually coherent. Manual grouping establishes a baseline; automatic grouping using Differentiable Blocks World is an explicit experiment. If it fails, report that result and keep the manual baseline functional.

Required product capabilities: multiple selectable buildings, a common action interface, and visible bending/deformation for supported actions. Proposed actions are push/bend, lateral shake, and impact; implement at least two, including one that bends the building. Stretch scope: larger destruction, automatic material suggestions, inverse-rendered material recovery, full ray-traced lighting, and user-uploaded reconstruction. The original proposal favors precomputed physics to fit the GPU budget. Use discrete action locations/directions/strengths backed by clips for the initial implementation; if continuous dragging or freely adjustable forces are required, prototype a lightweight live deformation model and validate its cost before promising that behavior. Playback speed does not change physical stiffness or impact force.

## 2. Establish the architecture and interfaces

- Web: plain TypeScript, Vite, and the existing PlayCanvas renderer for the synthetic playground (Carl's November 18 decision). React is deferred because the current controls do not require it. Reuse the working viewer and controller APIs. The earlier Three.js/Spark comparison remains a possible real-asset feasibility experiment if needed; it is not a dependency for this synthetic milestone. The first release needs no backend. Vercel remains a future hosting option; deployment is explicitly out of scope for the current local-only task.
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

## 8A. Add draggable lighting and dynamic shadows

Required behavior: the visitor can drag a light around a building and immediately see changed surface shading and cast shadows, including while the building bends. Begin with one movable spotlight plus a low ambient fill and a ground receiver. Expose position, aim/target, intensity, color, and reset. A sun-direction control can follow. Optional drawn rays/cones are explanatory helpers; volumetric light beams are separate scope.

Standard splats preserve captured illumination rather than clean material colors. The proposed first implementation is approximate relighting using an aligned proxy mesh. PlayCanvas documents rendering a lit proxy into an offscreen texture and transferring that lighting to splat fragments; it also notes that silhouette mismatch produces incorrect lighting boundaries. [PlayCanvas relighting](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/relighting/)

Implementation sequence:

1. Create a simple test building, aligned splats, proxy mesh, and ground. Start with a coarse hand-built proxy; DBW primitives may provide a later starting point, but lighting needs sufficiently accurate surfaces and openings.
2. Attach a draggable handle to the light and a separate aim target. Pause camera orbit during handle dragging and restore it afterward. Three.js provides object manipulation through TransformControls if that renderer is selected. [TransformControls](https://threejs.org/docs/pages/TransformControls)
3. Calculate lit proxy shading and shadow maps, then integrate those results into the splat shading path. Keep the proxy out of the main visible color pass while retaining it in lighting/shadow passes. Setting an ordinary splat object's castShadow flag alone is not an implementation.
4. Test ground shadows first, then receiving shadows on building surfaces and self-shadowing. Validate proxy coverage/depth at silhouettes and overlapping surfaces; a ground-only shadow does not satisfy the requirement. Work in a consistent linear-color pipeline and apply tone mapping once.
5. Bind the proxy to the same component poses or deformation field as the splats. Export matching proxy motion for precomputed simulations, update normals after bending, and refresh lighting/shadows when geometry or light state changes. A physics collision proxy may be too coarse for acceptable lighting.
6. Register proxy assets, deformation binding, light defaults, ground settings, and supported quality presets in each building manifest. Test switching and resetting buildings with active lighting.

Lighting runs live in the browser even when physics motion is precomputed, so light position is independent of the selected animation clip. Start with one shadow-casting light and benchmark the combined deformation, splat sorting, and lighting workload before adding more lights. Shadow maps are the initial implementation; full ray tracing is a later option.

Quality limitation: proxy modulation cannot reliably erase shadows/highlights already captured in the splat colors. Prefer diffuse-lit source imagery, provide an original/relit comparison, and document double-shadow or residual-highlight artifacts. If convincing light replacement is essential, add a separate inverse-rendering experiment to recover normals/materials/illumination and export browser-compatible attributes. GS-IR is a candidate research baseline, not a drop-in viewer plugin. [GS-IR paper](https://arxiv.org/abs/2311.16473)

Acceptance test: on every release building, drag the light left/right/up, vary its aim, bend the building, and confirm that surface brightness, ground shadows, and supported self-shadows respond coherently. Measure FPS and input latency with lighting and animation enabled together. Keep the original reconstruction PSNR/SSIM evaluation separate from the relighting evaluation. Do not mark accurate physical relighting achieved based on a tint/exposure control.

## 9. Complete the playground and publish

Build the UI around the building catalog and playground: building picker with previews, orbit/zoom/reset, component/target selection, recolor, action tools, supported direction/strength controls, play/pause/scrub for clips, and clear loading/error states. Design the main interaction as choose building → choose action → select target/settings → apply → observe/reset. Offer quality presets if needed. Display playback speed separately from scenario strength.

Include a lighting mode with draggable light/target handles and shadow controls alongside tint, exposure, and background. Complete the lighting milestone above; ordinary tint/exposure changes alone do not satisfy it.

Add the project explanation, pipeline illustration, dataset credits, experiment comparisons, metrics, limitations, and repository link. Deploy an early preview, then test the final Vercel site with its actual asset URLs, CORS settings, caching, and deep links. Measure loading from a cold cache as well as steady playback.

Checkpoint: a visitor can open the published link, switch between buildings, apply both supported actions to each, see bending, move the camera during the response, drag the light to change shading/shadows, and reset successfully. Switching buildings repeatedly must not retain stale actions or leak model memory. Retain a recorded demo as backup evidence.

## Proposed schedule

| Dates | Checkpoint |
|---|---|
| Nov 18–19 | Catalog/action interfaces; sample viewer; component motion, bending and proxy-lighting feasibility; renderer selection; PhysGaussian smoke test |
| Nov 20–22 | Dataset preparation, first reconstruction, held-out metrics, browser export |
| Nov 23–25 | Manual grouping, first action-driven bending response, proxy deformation/shadow synchronization, short dynamic playback proof; prepare additional buildings |
| Nov 26–28 | Timeboxed DBW comparison; second action; repeat pipeline for remaining release buildings |
| Nov 29–Dec 1 | Catalog switching, full action controls, asset optimization, draggable lighting/shadows, appearance controls, deployment |
| Dec 2–3 | Evaluation, browser testing, figures, write-up, final fixes |
| Dec 4 | Submission buffer and final link verification |

Prioritize a functioning manual-grouping demo if research work slips. If action-driven bending fails by Nov 25, prioritize a reduced deformation model or smaller scenes and reassess the schedule. A rigid-motion-only viewer is a partial milestone, not completion of the intended product. Automatic materials, inverse-rendered material recovery, and full ray tracing are the first features to defer. Draggable approximate lighting with responsive shading/shadows remains a required product feature.

## GPU budget and completion criteria

Proposed $100 allocation: $10 environment/smoke tests; $35 reconstruction; $20 physics; $15 DBW; $20 contingency. These are spending caps, not provider quotes. Set a cost limit before each job, save checkpoints, and shut down idle instances. Verify actual rental and asset-storage charges before committing funds.

Done means: a reusable catalog with multiple buildings (proposed target three; minimum two); building switching without viewer code changes; reproducible configurations and held-out PSNR/SSIM reports for our reconstructions; at least two supported actions per release building including visible bending; free camera movement during responses; draggable lighting with responsive building shading and shadows during deformation; reliable reset; ≥20 FPS on the stated test machine/resolution; a published playground and results page; and an honest account of automatic grouping, precomputed versus live responses, and fallback methods. Evaluate action-to-response latency and repeated building-switch memory behavior as well as rendering FPS. Existing licensed sample buildings may help test the catalog, but identify them separately from our own reconstructions.


## Current reconstruction development status

November 19 continuation, [issue #2](https://github.com/carldjapardi/Splatastrophe/issues/2), branch `sriya/reconstruction`, agent codex-sriya-reconstruction for Sriya: the setup now supports separate Tanks and Temples Barn and PhotoTourism IMC-PT 2020 Brandenburg Gate scene configurations. Barn estimates cameras with COLMAP; PhotoTourism converts the supplied binary COLMAP model with original filenames and per-camera intrinsics. Acquisition records exact archive/split content hashes; appearance splits are now disjoint train/validation/test. PhotoTourism retains NeRF-W test membership with project full-image metrics, not the appearance-adapted NeRF-W benchmark protocol. Structural camera diagnostics generate JSON/HTML coverage reports; training/export provenance records transforms, environment, commands, timing and optional stage cost estimates. Export packages `building.ply` and camera/coordinate metadata; previews use validation cameras. See [development instructions](DEVELOPMENT.md).

Local tests cover split isolation, supplied-camera command generation, malformed/missing cameras, archive extraction/path traversal, export metadata and side-effect-free previews; notebook cells parse. These use synthetic fixtures. No real dataset download, coherent camera alignment, CUDA training, image-quality result, exported building or browser validation has been produced in this continuation. The local Mac has no NVIDIA CUDA runtime; Sriya reports Thunder access and is connecting compute. Runtime validation and actual provider cost remain pending. Supplied Tanks and Temples camera-log conversion remains unimplemented; Barn uses COLMAP. The reconstruction task remains in progress until GPU and asset acceptance checks pass.

For the current three-person work session: Sriya owns reconstruction/compute scaffolding; Isaac owns independent bending/impact prototypes; Carl owns the viewer, lighting and deployment. Yushan is unavailable for this session. All prototypes use independent fixtures until integration. The immediate MVP has one reconstructed building; the final reusable catalog requirement remains.

Compute funding update: Sriya reports $25 Thunder Compute credit per teammate, each on their own account. Balance, rates and GPU availability remain unverified. This does not establish a pooled budget or authorize purchases/instance provisioning. Use Thunder Remote SSH for VS Code; Colab notebooks are an alternate compute path. GPU environments must be validated separately before running long jobs.

## Physics prototype status

Isaac's bend and impact prototypes were merged into `main` and are in `web/src/deformation/`, `web/src/impact/`, and `fixtures/physics/`. They use only the procedural synthetic tower: one building, one shadow-casting directional light, right-handed Y-up meters, quaternions `[x, y, z, w]`. The bend controller is a height-weighted kinematic curve shared by the visible mesh, a lighting proxy, and procedural Gaussian rotation/scale. Impact is a separate Rapier block tower with predefined breakable joints. Unit tests cover the anchored base, shared deformation, splat covariance, joint breaking, and ground contact. These are not PhysGaussian results and not validated structural physics. See `web/src/deformation/LIMITATIONS.md`. The initial harness had no configurable loading flow; the local synthetic catalog/spotlight integration is now implemented in [PR #7](https://github.com/SriyaKan/Splatastrophe/pull/7), awaiting review/merge. Real-asset catalog/playback adapters remain deferred.

## Viewer reliability and lighting feasibility — November 18, 2026

Codex/Carl's branch `codex/viewer-reliability`, tracked in [issue #4](https://github.com/SriyaKan/Splatastrophe/issues/4), puts the existing frontend package, lockfile, TypeScript and Vite configuration in `web/`, without moving prototype sources or changing solver interfaces. A clean `npm ci` replaces the sibling `node_modules` symlink hook. The demo now preserves absent/invalid query defaults, handles pointer cancellation, ignores shortcuts while editing inputs, and owns event listeners and disposable resources through navigation/hot reload, including physics initialization that resolves after teardown. Four regression tests cover query parsing and resource lifetime. Diagnostic DOM updates are limited to 4 Hz. Strength/direction sliders have explicit accessible labels and mode buttons expose their pressed state. GitHub Actions is configured to run Python tests/notebook syntax checks and frontend tests/build; hosted results and review/integration status are tracked in issue #4.

The synthetic bend harness now uses the official PlayCanvas `GSplatRelighting` script with an offscreen-only, deforming gray proxy. A draggable directional sun plus azimuth/elevation, intensity, original/relit and reset controls provides a bounded lighting feasibility example. Browser checks with the visible mesh hidden confirmed actual GSplat rendering, changing splat shading and ground-shadow direction during bending, and impact activation/joint breaking. This is approximate proxy modulation on procedural splats; it does not establish the release spotlight/aim interface, real-asset relighting, self-shadows on complex geometry, or catalog switching/memory acceptance.

Local validation: 12 frontend tests (including four new regressions), strict TypeScript and production build, two Python tests, and notebook code syntax passed. Browser verification at 1280 × 800 also confirmed the absent direction parameter defaults to 25°, orbit during bending, eight joints breaking on a 0.85-strength impact, reset restoring zero broken joints, and no captured console warnings/errors. The HUD reported approximately 120 FPS in this local in-app-browser procedural example; machine specifications and real-asset performance were not benchmarked, so the release performance requirement remains open. The production JavaScript bundle remains approximately 6.47 MB (2.22 MB gzip); loading/chunking remains a measured optimization task. No GPU jobs, dataset downloads, deployment, or reconstruction results were produced in this pass. Carl merged [PR #5](https://github.com/SriyaKan/Splatastrophe/pull/5) as `27065c3`, main CI passed, and issue #4 is closed.

## Local synthetic playground scope — November 18, 2026

[Issue #6](https://github.com/SriyaKan/Splatastrophe/issues/6) and [PR #7](https://github.com/SriyaKan/Splatastrophe/pull/7), branch `codex/synthetic-playground`, is owned by codex-carl for Carl. Carl explicitly authorized assumption of the playground integration and necessary existing viewer/demo/config files for this task. This human instruction supersedes the earlier wait for Isaac's acknowledgment for that bounded scope. The ownership notice addresses deformation-agent / isaac-cursor in the issue's [coordination thread](https://splatastrophecs180.slack.com/archives/C0CJJHL4XJP/p1794998722252099); an agent acknowledgment must not be assumed. Reuse the existing bend/impact controller APIs and keep Sriya's reconstruction files outside this scope.

Agreed immediate deliverable: one configurable synthetic building in the existing TypeScript/PlayCanvas viewer, asynchronous loading/error/retry with resource cleanup, separate bend/impact modes driven by one application update loop, and a spotlight with independently draggable position and aim handles. Drag each handle on a horizontal plane; provide separate height, intensity, color, original/relit and reset controls. Suspend camera orbit during a light-handle drag. Verify the local load → orbit → action → light/aim drag → reset/reload flow and record a viewport/browser/device-qualified FPS sample.

No deployment is requested for this task. Final-splat loading/conversion and bending/grouping/relighting/proxy adapters are deferred and may be redesigned after the actual export exists. Synthetic bending and lighting are disposable feasibility implementations, not proof of compatibility with the final reconstruction. This changes the current working scope, not the final multi-building, reconstruction/evaluation and published-playground requirements above. Local implementation is verified and ready for review in PR #7. The runtime catalog, cancellation/retry/disposal path and independent spotlight/aim controls are implemented; the bend/impact algorithms and public APIs are unchanged. Validation passed 22 frontend tests and strict TypeScript/production build; Python checks remain covered by CI. Review regressions cover the documented automatic impact strike, complete display/relighting defaults on each mount, and cleanup when early or late scene initialization fails. Browser checks covered actual splat surface shading, independent handle drags with an unchanged camera, height/intensity, original/relit comparison, impact/reset, five consecutive scene reloads, and invalid-config recovery through Retry. A five-second synthetic sample measured 120.0 FPS at a 980 × 832 canvas (1280 × 900 viewport, DPR 1) on a MacBook Pro M4 Max / 36 GB / macOS 15.7.4 using the Chromium 157 in-app browser. See the [reproducible verification record](../experiments/viewer/2026-11-18-synthetic-playground.md) for settings and limits. This is not a real-building or retained-memory benchmark, and no deployment occurred.

November 20, [issue #11](https://github.com/carldjapardi/Splatastrophe/issues/11): The demo candidate uses a full-resolution, 3,000-step PhotoTourism Splatfacto run (774 train, 85 validation, 10 test images). A spatial crop followed by a hand-drawn projected silhouette and sky/opacity filters retains 91,111 of 619,658 exported splats. This is a post-export cleanup with residual background and uneven detail. The web build includes the cropped PLY as its default orbitable scene, with the procedural tower selectable for the bend and impact demonstrations. The training images and checkpoints stay outside Git. Production deployment and verification on the team domain are pending.

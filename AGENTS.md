# Agent context

Splatastrophe reconstructs real buildings from photographs as Gaussian splats and presents them in an interactive animation playground.

## Single source of truth

Read [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) before planning or implementing work. It is the sole maintained source for scope, architecture, decisions, milestones, budget, evaluation, and implementation status. Update it when those change; keep this file as a short entry point rather than duplicating the plan or creating parallel roadmaps. Record completed work only when supported by code or experimental evidence.

The original proposals are historical references, not current requirements. Paper figures and product mockups are not implementation results.

## Research and data

Read the plan's [research and dataset context](docs/IMPLEMENTATION_PLAN.md#research-and-dataset-context), then the relevant paper/method section before changing that stage. Local paper PDFs are linked there.

- Distinguish appearance reconstruction (3DGS), geometric decomposition (DBW), and material simulation (PhysGaussian). Their adapters are project work, not assumed compatibility.
- Keep manual baselines, automatic experiments, simulated physics, and approximate visual effects clearly identified.
- Use the plan's dataset guidance; record the exact scene/version, camera provenance, split, scale, and attribution in its configuration. Keep large datasets/checkpoints outside Git.
- Validate a small complete path through export and browser playback before scaling GPU jobs or adding buildings. Log reproducible settings, results, limitations, and compute cost.

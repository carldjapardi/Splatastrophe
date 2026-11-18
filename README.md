# Splatastrophe

An interactive playground for reconstructing buildings with Gaussian splatting and exploring how they bend, sway, and respond to forces.

## Project planning

The [implementation plan](docs/IMPLEMENTATION_PLAN.md) is the single source of truth for scope, architecture, implementation status, milestones, and evaluation. It also contains research references and dataset context.

## Start reconstruction development

Open `Splatastrophe.code-workspace` in VS Code and follow [the development guide](docs/DEVELOPMENT.md). The [starter notebook](notebooks/00_runtime_setup.ipynb) supports VS Code/Thunder and Colab. GPU experiments have not yet been run.

## Run the local synthetic playground

With Node 22.12+ on Node 22, or Node 24/26+, run `cd web`, `npm ci`, then `npm run dev`. Run `npm run check` for frontend tests, TypeScript checks and a production build. See [the prototype guide](web/src/deformation/README.md) for controls and limitations. The catalog in `web/public/catalog.json` supplies the synthetic fixture, camera, actions and spotlight defaults. This procedural example is separate from the reconstruction pipeline; final-splat adapters and deployment are deferred. [Local verification record](experiments/viewer/2026-11-18-synthetic-playground.md).

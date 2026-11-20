# Sacre Coeur reconstruction (Yushan's experiment)

A second PhotoTourism building for the catalog, trained in the cloud with the team pipeline.
Owner: Yushan (agent `claude-yushan-masks`). Parent: issue #1 milestone 8 (multiple buildings); related to #2.

- `scene.json`: scene config for `pipeline/reconstruction/run.py` (no changes to the pipeline or `configs/scenes/`).
- `colab_train.ipynb`: Colab notebook. Open it at
  <https://colab.research.google.com/github/SriyaKan/Splatastrophe/blob/yushan/splat-experiment/experiments/reconstruction/sacre-coeur/colab_train.ipynb>
  with a GPU runtime and run the cells in order.

Data: IMC-PT 2020 `sacre_coeur.tar.gz` (4.1 GB) with supplied COLMAP cameras, NeRF-W split
(`sacre.tsv`: 950 train, 21 test). The dataset lives only on the Colab disk; results are copied to
Google Drive (`MyDrive/splatastrophe/sacre-coeur/`). Nothing large is committed to Git.

Settings: Splatfacto (Nerfstudio 1.1.5), full-resolution images, 1k-iteration smoke test, then 30k iterations.

## Results

Not run yet. Record here after the run: GPU type, training time, splat count, test PSNR/SSIM/LPIPS,
`building.ply` size, and observations (haze, floaters, holes).

# Local synthetic playground verification — November 18, 2026

Scope: issue #6, branch `codex/synthetic-playground`. This is a synthetic interaction/lighting check. It does not measure a reconstructed building, validate structural physics, establish real-asset compatibility or satisfy the final multi-building benchmark.

## Reproduce

```bash
cd web
npm ci
npm run check
npm run preview -- --host 127.0.0.1
```

Open `http://127.0.0.1:4173/?bend=0.75`. Use a 1280 × 900 browser viewport. Expand **Inspect the prototype** and choose **Record 5s FPS sample**. Keep the browser active. The sidebar makes the canvas 980 × 832 CSS pixels at this viewport.

Configuration: `web/public/catalog.json`; fixture: `fixtures/physics/synthetic-tower.json`, authored right-handed Y-up meters, quaternions xyzw. 144 procedural Gaussians (3 × 16 × 3), no SH; scripted bend strength 0.75, direction 25 degrees, continuous mesh/proxy/splat uploads. Visible mesh hidden, proxy and splats enabled. One shadow-casting spot light, position [4, 6, 4], aim [0, 2.5, 0], intensity 4, range 24, inner/outer cone 30/55 degrees, color #fff3dc; official PlayCanvas proxy modulation enabled. The curve eases into a held pose; this is not an oscillating physics clip.

## FPS sample

- Device: MacBook Pro, model Mac16,6; Apple M4 Max; 36 GB RAM.
- OS: macOS 15.7.4 (reported by `sw_vers`).
- Browser: Codex in-app browser, Chromium/Chrome 157.0.0.0 as reported by its user agent. The reduced user agent identifies Intel/macOS 10.15.7; actual device/OS above came from system hardware reporting.
- App viewport: 1280 × 900; canvas: 980 × 832 CSS pixels; device pixel ratio: 1.
- Five-second requestAnimationFrame/update sample: **120.0 FPS**.
- Sampling starts while the bend eases toward its held target. Proxy/splat updates and spotlight rendering continue every frame. This single short sample is consistent with a display refresh ceiling; it is not a GPU throughput limit, a slow-frame distribution, an action-latency measurement, or a memory benchmark.

## Browser evidence

- Production build loads the runtime catalog and its bundled fixture; the UI reaches Ready with actual `playcanvas-gsplat` rendering, not the ellipsoid fallback.
- Gold light-position drag changed [4, 6, 4] to approximately [4.72, 6, 3.97]; aim stayed [0, 2.5, 0]. Camera diagnostics stayed [0.700, 0.420, 13.00].
- Teal aim drag changed only the target, to approximately [1.79, 2.5, 0.49]. Camera and light position stayed fixed. Surface shading and ground-shadow direction changed.
- Light height 7, aim height 3.2, intensity 2 and light color #cce8ff are accepted by the UI. A directly vertical spotlight aim was also checked without captured warnings/errors. Separate light reset restores catalog defaults. Original/relit comparison visibly changes splat shading with the visible mesh hidden.
- Orbit changes the camera; Reset all restores camera/light defaults and building state. Impact at strength 0.85 breaks 8 joints; Reset building restores zero broken joints and clears Struck.
- Five consecutive Reload operations return Ready without captured console warnings/errors. This verifies functional teardown/recreation, not absence of retained browser/GPU memory.
- Failure/retry: temporarily change the **generated** `web/dist/catalog.json` fixture name to an unsupported value, then open the production preview. UI shows an error and disables action controls. Restore that generated JSON and choose Retry loading: Ready returns without reloading the page. Source catalog was not modified by this experiment.
- No captured console warnings/errors during successful production checks. No deployment, GPU training or cloud spend was performed.

## Remaining limitations

The light/aim markers are viewport overlays for selection; dragging is on horizontal planes, with independent height sliders. This desktop-pointer-first interface is not a touch interaction benchmark. Proxy modulation can show hard boundaries across soft Gaussian silhouettes and cannot remove captured illumination. The convex tower does not validate self-shadows inside real architectural openings. Impact uses a different block representation from bending. Final splat loading/grouping/bending/relighting/proxy adapters are intentionally deferred until the final export exists.

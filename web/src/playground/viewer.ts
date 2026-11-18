import { createBendController, type BendController } from '../deformation/src/bendController';
import { buildTowerMesh, deformTowerMesh } from '../deformation/src/towerMesh';
import { buildTowerSplats, deformSplats, type SplatCloud } from '../deformation/src/splats';
import type { BuildingEntry, LoadedFixture, Point } from './catalog';
import { createImpactController, type ImpactController } from '../impact/src/index';
import { createTowerScene, type TowerEntities } from '../deformation/src/demo/scene';
import { createLifetime } from '../deformation/src/demo/runtime';
import { initialViewerState } from './initialState';

type Mode = 'bend' | 'impact';

export async function mountViewer(entry: BuildingEntry, fixture: LoadedFixture, signal: AbortSignal) {
  const lifetime = createLifetime();
  const cancel = () => lifetime.dispose();
  signal.addEventListener('abort', cancel, { once: true });
  lifetime.own({ dispose: () => signal.removeEventListener('abort', cancel) });
  if (signal.aborted) lifetime.dispose();
  try {
    const canvas = required(document.querySelector<HTMLCanvasElement>('#view'), 'view');
    const panel = {
      bend: required(document.querySelector<HTMLButtonElement>('#mode-bend'), 'mode-bend'),
      impact: required(document.querySelector<HTMLButtonElement>('#mode-impact'), 'mode-impact'),
      strength: required(document.querySelector<HTMLInputElement>('#strength'), 'strength'),
      strengthValue: required(document.querySelector<HTMLOutputElement>('#strength-value'), 'strength-value'),
      direction: required(document.querySelector<HTMLInputElement>('#direction'), 'direction'),
      directionValue: required(document.querySelector<HTMLOutputElement>('#direction-value'), 'direction-value'),
      directionLabel: required(document.querySelector<HTMLElement>('#direction-label'), 'direction-label'),
      bendOptions: required(document.querySelector<HTMLElement>('#bend-options'), 'bend-options'),
      impactOptions: required(document.querySelector<HTMLElement>('#impact-options'), 'impact-options'),
      mesh: required(document.querySelector<HTMLInputElement>('#show-mesh'), 'show-mesh'),
      proxy: required(document.querySelector<HTMLInputElement>('#show-proxy'), 'show-proxy'),
      splats: required(document.querySelector<HTMLInputElement>('#show-splats'), 'show-splats'),
      strike: required(document.querySelector<HTMLButtonElement>('#strike'), 'strike'),
      reset: required(document.querySelector<HTMLButtonElement>('#reset'), 'reset'),
      readout: required(document.querySelector<HTMLElement>('#readout'), 'readout'),
      lightHeight: required(document.querySelector<HTMLInputElement>('#light-height'), 'light-height'),
      aimHeight: required(document.querySelector<HTMLInputElement>('#aim-height'), 'aim-height'),
      lightColor: required(document.querySelector<HTMLInputElement>('#light-color'), 'light-color'),
      cameraPose: required(document.querySelector<HTMLElement>('#camera-pose'), 'camera-pose'),
      lightPose: required(document.querySelector<HTMLElement>('#light-pose'), 'light-pose'),
      resetCamera: required(document.querySelector<HTMLButtonElement>('#reset-camera'), 'reset-camera'),
      resetAll: required(document.querySelector<HTMLButtonElement>('#reset-all'), 'reset-all'),
      measure: required(document.querySelector<HTMLButtonElement>('#measure'), 'measure'),
      measurement: required(document.querySelector<HTMLElement>('#measurement'), 'measurement'),
      intensity: required(document.querySelector<HTMLInputElement>('#light-intensity'), 'light-intensity'),
      relighting: required(document.querySelector<HTMLInputElement>('#relighting'), 'relighting'),
      resetLight: required(document.querySelector<HTMLButtonElement>('#reset-light'), 'reset-light'),
    };

    const initial = initialViewerState(new URLSearchParams(location.search), entry.actions);
    panel.measure.disabled = false;
    panel.measurement.textContent = '';
    const eventOptions = { signal: lifetime.signal };
    const bendFixture = fixture.bend;
    const impactFixture = fixture.impact;
    const impact = entry.actions.includes('impact') ? await createImpactController(impactFixture) : null;
    if (impact && !lifetime.own(impact)) throw new DOMException('Load cancelled', 'AbortError');
    signal.throwIfAborted();
    const bend = createBendController({
      tower: bendFixture.tower,
      maxTipAngleRadians: bendFixture.bend.maxTipAngleRadians,
      responseSeconds: bendFixture.bend.responseSeconds,
    });
    lifetime.own(bend);
    const visibleMesh = buildTowerMesh(bendFixture.tower);
    const proxyMesh = buildTowerMesh(bendFixture.tower, { outset: bendFixture.bend.proxyOutset });
    const cloud = buildTowerSplats(bendFixture.tower, {
      grid: bendFixture.bend.splatGrid,
      scale: bendFixture.bend.splatScale,
      inset: bendFixture.bend.splatInset,
    });

    panel.strength.value = String(initial.strength);
    panel.direction.value = String(initial.direction);
    panel.splats.checked = initial.splats;
    panel.mesh.checked = initial.mesh;
    panel.proxy.checked = initial.proxy;
    panel.relighting.checked = initial.relighting;

    let mode: Mode = initial.mode;
    let struck = false;
    let { yaw, pitch, distance } = entry.camera;
    const focus = entry.camera.target;
    let light = structuredClone(entry.light);
    let pointer: { id: number; x: number; y: number; moved: number; handle: 'position' | 'target' | null; offset: Point | null } | null = null;

    const scene = createTowerScene(
      canvas,
      visibleMesh,
      proxyMesh,
      cloud,
      impactFixture.bodies.map((body) => ({
        halfExtents: body.halfExtents,
        position: body.position,
        rotation: body.rotation,
      })),
      light, bendFixture.light.ambient,
    );
    lifetime.own(scene);
    syncLightInputs();
    applyLight();
    for (const [action, button] of [['bend', panel.bend], ['impact', panel.impact]] as const) button.disabled = !entry.actions.includes(action);

    let measurement: { started: number; frames: number; mode: Mode } | null = null;
    applyBend();
    setMode(mode, false);
    let statsStarted = performance.now();
    let frames = 0;
    let fps = 0;
    let nextReadout = 0;
    scene.app.on('update', (dt: number) => {
      if (mode === 'bend') {
        bend.update(dt);
        applyBend();
      } else if (impact) {
        impact.update(dt);
        syncBlocks(impact);
      }
      placeCamera(scene);
      const now = performance.now();
      frames += 1;
      if (measurement) {
        measurement.frames += 1;
        if (now - measurement.started >= 5000) {
          const measured = measurement.frames * 1000 / (now - measurement.started);
          const rect = canvas.getBoundingClientRect();
          panel.measurement.textContent = `${measured.toFixed(1)} FPS · ${measurement.mode} · ${Math.round(rect.width)} × ${Math.round(rect.height)} CSS px · DPR ${devicePixelRatio} · 5 seconds`;
          panel.measurement.title = navigator.userAgent;
          measurement = null;
          panel.measure.disabled = false;
        }
      }
      if (now - statsStarted >= 2000) {
        fps = frames * 1000 / (now - statsStarted);
        frames = 0;
        statsStarted = now;
      }
      // Diagnostic DOM work does not need to run at the rendering frame rate.
      if (now >= nextReadout) {
        writeReadout(bend, cloud, scene, impact, fps);
        panel.cameraPose.textContent = `${yaw.toFixed(3)}, ${pitch.toFixed(3)}, ${distance.toFixed(2)}`;
        panel.lightPose.textContent = `Light ${light.position.map(v => v.toFixed(2)).join(', ')} → Aim ${light.target.map(v => v.toFixed(2)).join(', ')}`;
        nextReadout = now + 250;
      }
      document.body.dataset.ready = '1';
    });

    panel.bend.addEventListener('click', () => setMode('bend', true), eventOptions);
    panel.impact.addEventListener('click', () => setMode('impact', true), eventOptions);
    panel.strength.addEventListener('input', () => {
      publishStrength();
      if (mode === 'bend') bend.setBend(strength(), direction());
    }, eventOptions);
    panel.direction.addEventListener('input', () => {
      publishStrength();
      if (mode === 'bend') bend.setBend(strength(), direction());
    }, eventOptions);
    for (const box of [panel.mesh, panel.proxy, panel.splats]) {
      box.addEventListener('change', () => {
        if (mode === 'bend') applyVisibility();
      }, eventOptions);
    }
    panel.reset.addEventListener('click', () => resetActive(), eventOptions);
    panel.strike.disabled = false;
    panel.strike.addEventListener('click', () => {
      if (impact) strikeUpper(impact);
    }, eventOptions);
    for (const input of [panel.lightHeight, panel.aimHeight, panel.intensity, panel.lightColor, panel.relighting]) {
      input.addEventListener('input', () => {
        light.position[1] = Number(panel.lightHeight.value);
        light.target[1] = Number(panel.aimHeight.value);
        light.intensity = Number(panel.intensity.value);
        light.color = panel.lightColor.value;
        applyLight();
      }, eventOptions);
    }
    panel.resetLight.addEventListener('click', resetLight, eventOptions);
    panel.resetCamera.addEventListener('click', resetCamera, eventOptions);
    panel.resetAll.addEventListener('click', () => {
      resetActive(); resetCamera(); resetLight();
    }, eventOptions);
    panel.measure.addEventListener('click', () => {
      measurement = { started: performance.now(), frames: 0, mode };
      panel.measurement.textContent = 'Sampling for 5 seconds. Keep this window active and avoid changing controls.';
      panel.measure.disabled = true;
    }, eventOptions);

    canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || pointer) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const handle = scene.hitLight(x, y);
      const point = handle ? scene.pointOnPlane(x, y, light[handle][1]) : null;
      pointer = {
        id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, handle,
        offset: handle && point ? [light[handle][0] - point[0], 0, light[handle][2] - point[2]] : null,
      };
      canvas.setPointerCapture(event.pointerId);
    }, eventOptions);
    canvas.addEventListener('pointermove', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.moved += Math.abs(dx) + Math.abs(dy);
      if (pointer.handle) {
        const rect = canvas.getBoundingClientRect();
        const next = scene.pointOnPlane(event.clientX - rect.left, event.clientY - rect.top, light[pointer.handle][1]);
        if (next && pointer.offset) {
          light[pointer.handle] = [
            Math.min(10, Math.max(-10, next[0] + pointer.offset[0])), next[1],
            Math.min(10, Math.max(-10, next[2] + pointer.offset[2])),
          ];
          applyLight();
        }
        return;
      }
      yaw -= dx * 0.006;
      pitch = Math.min(1.15, Math.max(-0.2, pitch - dy * 0.005));
    }, eventOptions);
    canvas.addEventListener('pointerup', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const click = pointer.moved < 6 && !pointer.handle;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!click || mode !== 'impact' || !impact) return;
      const hit = pickBlock(event);
      if (!hit) return;
      impact.impact(hit.point, hit.direction, strength());
      struck = true;
    }, eventOptions);
    for (const eventName of ['pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(eventName, (event) => {
        if (pointer?.id === (event as PointerEvent).pointerId) pointer = null;
      }, eventOptions);
    }
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      distance = Math.min(28, Math.max(4, distance * (event.deltaY > 0 ? 1.08 : 0.93)));
    }, { ...eventOptions, passive: false });
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey
          || (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable]'))) return;
      if (event.key === 'b') setMode('bend', true);
      if (event.key === 'i') setMode('impact', true);
      if (event.key === 'r') resetActive();
    }, eventOptions);
    const resize = () => scene.resize();
    window.addEventListener('resize', resize, eventOptions);
    resize();
    if (mode === 'bend') bend.setBend(strength(), direction());
    publishStrength();
    if (initial.strike && impact) strikeUpper(impact);

    return lifetime;

    function setMode(next: Mode, reset: boolean) {
      if (!entry.actions.includes(next)) return;
      if (measurement) { measurement = null; panel.measure.disabled = false; panel.measurement.textContent = 'Sample cancelled because the action changed.'; }
      if (reset) {
        bend.reset();
        impact?.reset();
        struck = false;
        applyBend();
        if (impact) syncBlocks(impact);
      }
      mode = next;
      panel.bend.classList.toggle('active', next === 'bend');
      panel.impact.classList.toggle('active', next === 'impact');
      panel.bend.setAttribute('aria-pressed', String(next === 'bend'));
      panel.impact.setAttribute('aria-pressed', String(next === 'impact'));
      panel.bendOptions.hidden = next !== 'bend';
      panel.impactOptions.hidden = next !== 'impact';
      panel.directionLabel.hidden = next !== 'bend';
      scene.setMode(next);
      if (next === 'bend') {
        applyVisibility();
        bend.setBend(strength(), direction());
      }
    }

    function resetActive() {
      if (mode === 'bend') {
        bend.reset();
        panel.strength.value = '0';
        publishStrength();
        applyBend();
      } else if (impact) {
        impact.reset();
        struck = false;
        syncBlocks(impact);
      }
    }

    function applyBend() {
      const field = bend.getField();
      deformTowerMesh(visibleMesh, field);
      deformTowerMesh(proxyMesh, field);
      deformSplats(cloud, field);
      scene.uploadTower(visibleMesh, proxyMesh);
      scene.splats.update(cloud);
    }

    function applyVisibility() {
      scene.setBendVisibility({
        mesh: panel.mesh.checked,
        proxy: panel.proxy.checked,
        splats: panel.splats.checked,
      });
    }

    function applyLight() {
      scene.setLight(light);
      scene.setRelighting(panel.relighting.checked);
    }

    function syncLightInputs() {
      panel.lightHeight.value = String(light.position[1]);
      panel.aimHeight.value = String(light.target[1]);
      panel.intensity.value = String(light.intensity);
      panel.lightColor.value = light.color;
    }
    function resetLight() {
      light = structuredClone(entry.light);
      panel.relighting.checked = true;
      syncLightInputs(); applyLight();
    }
    function resetCamera() {
      ({ yaw, pitch, distance } = entry.camera);
      placeCamera(scene);
    }

    function syncBlocks(controller: ImpactController) {
      controller.getBodies().forEach((body, index) => {
        scene.syncBlock(index, body.position, body.rotation);
      });
    }

    function strikeUpper(controller: ImpactController) {
      const bodies = controller.getBodies();
      const target = bodies.reduce((best, body) => {
        if (body.position[1] > best.position[1] + 0.05) return body;
        if (Math.abs(body.position[1] - best.position[1]) <= 0.05 && body.position[0] > best.position[0]) return body;
        return best;
      });
      const spec = impactFixture.bodies.find((body) => body.id === target.id);
      const hx = spec?.halfExtents[0] ?? 0.5;
      controller.impact(
        [target.position[0] + hx, target.position[1], target.position[2]],
        [1, 0.2, 0],
        strength(),
      );
      struck = true;
    }

    function pickBlock(event: PointerEvent): { point: [number, number, number]; direction: [number, number, number] } | null {
      const camera = scene.camera.camera;
      if (!camera) return null;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const start = camera.screenToWorld(x, y, camera.nearClip);
      const end = camera.screenToWorld(x, y, camera.farClip);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-8) return null;
      const direction: [number, number, number] = [dx / len, dy / len, dz / len];
      const hit = scene.raycastBlocks([start.x, start.y, start.z], direction);
      if (!hit) return null;
      return { point: [hit.point[0], hit.point[1], hit.point[2]], direction };
    }

    function placeCamera(tower: TowerEntities) {
      const horizontal = Math.cos(pitch);
      tower.camera.setLocalPosition(
        focus[0] + distance * horizontal * Math.sin(yaw),
        focus[1] + distance * Math.sin(pitch),
        focus[2] + distance * horizontal * Math.cos(yaw),
      );
      tower.camera.lookAt(focus[0], focus[1], focus[2]);
    }

    function writeReadout(controller: BendController, splats: SplatCloud, tower: TowerEntities, impactController: ImpactController | null, fps: number) {
      const field = controller.getField();
      const tip = field.sample([0, bendFixture.tower.height, 0]);
      let tipIndex = 0;
      for (let i = 1; i < splats.count; i += 1) {
        if (splats.restPositions[i * 3 + 1] > splats.restPositions[tipIndex * 3 + 1]) tipIndex = i;
      }
      const rotation = [
        splats.rotations[tipIndex * 4],
        splats.rotations[tipIndex * 4 + 1],
        splats.rotations[tipIndex * 4 + 2],
        splats.rotations[tipIndex * 4 + 3],
      ];
      const scaleY = splats.scales[tipIndex * 3 + 1];
      const broken = impactController ? impactController.getConnections().filter((joint) => !joint.intact).length : 0;
      const rows = [
        ['Mode', mode],
        ['FPS (2s avg)', fps ? fps.toFixed(1) : 'sampling'],
        ['Bend', controller.currentStrength.toFixed(2)],
        ['Tip move', `${tip.position[0].toFixed(2)}, ${tip.position[1].toFixed(2)}, ${tip.position[2].toFixed(2)} m`],
        ['Tip quat', rotation.map((value) => value.toFixed(3)).join(' ')],
        ['Tip scale Y', scaleY.toFixed(3)],
        ['Splats', tower.splats.kind],
        ['Joints broken', `${broken}`],
        ['Struck', struck ? 'yes' : 'no'],
      ];
      panel.readout.replaceChildren();
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        row.append(dt, dd);
        panel.readout.append(row);
      }
      const note = document.createElement('dd');
      note.textContent = tower.splats.note;
      panel.readout.append(note);
    }

    function strength(): number {
      return Number(panel.strength.value);
    }

    function direction(): [number, number, number] {
      const radians = (Number(panel.direction.value) * Math.PI) / 180;
      return [Math.cos(radians), 0, Math.sin(radians)];
    }

    function publishStrength() {
      panel.strengthValue.textContent = strength().toFixed(2);
      panel.directionValue.textContent = `${panel.direction.value}°`;
    }

    function required<T>(value: T | null | undefined, label: string): T {
      if (value == null) throw new Error(`demo markup is missing ${label}`);
      return value;
    }
  } catch (error) {
    lifetime.dispose();
    throw error;
  }
}

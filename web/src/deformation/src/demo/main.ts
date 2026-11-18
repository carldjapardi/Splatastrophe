import { createBendController, type BendController } from '../bendController';
import { buildTowerMesh, deformTowerMesh } from '../towerMesh';
import { buildTowerSplats, deformSplats, type SplatCloud } from '../splats';
import { bendFixture, impactFixture } from '../loadFixture';
import { createImpactController, type ImpactController } from '../../../impact/src/index';
import { createTowerScene, type TowerEntities } from './scene';
import { createLifetime, numberParam } from './runtime';

type Mode = 'bend' | 'impact';

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
  azimuth: required(document.querySelector<HTMLInputElement>('#light-azimuth'), 'light-azimuth'),
  elevation: required(document.querySelector<HTMLInputElement>('#light-elevation'), 'light-elevation'),
  intensity: required(document.querySelector<HTMLInputElement>('#light-intensity'), 'light-intensity'),
  relighting: required(document.querySelector<HTMLInputElement>('#relighting'), 'relighting'),
  resetLight: required(document.querySelector<HTMLButtonElement>('#reset-light'), 'reset-light'),
};

const params = new URLSearchParams(location.search);
const lifetime = createLifetime();
const eventOptions = { signal: lifetime.signal };
const bend = createBendController({
  tower: bendFixture.tower,
  maxTipAngleRadians: bendFixture.bend.maxTipAngleRadians,
  responseSeconds: bendFixture.bend.responseSeconds,
});
const visibleMesh = buildTowerMesh(bendFixture.tower);
const proxyMesh = buildTowerMesh(bendFixture.tower, { outset: bendFixture.bend.proxyOutset });
const cloud = buildTowerSplats(bendFixture.tower, {
  grid: bendFixture.bend.splatGrid,
  scale: bendFixture.bend.splatScale,
  inset: bendFixture.bend.splatInset,
});

const initialStrength = numberParam(params, 'bend', 0);
const initialDirection = numberParam(params, 'dir', 25);
panel.strength.value = String(initialStrength);
panel.direction.value = String(initialDirection);
if (params.get('splats') === '0') panel.splats.checked = false;
if (params.get('mesh') === '0') panel.mesh.checked = false;
if (params.get('proxy') === '0') panel.proxy.checked = false;

let mode: Mode = params.get('mode') === 'impact' ? 'impact' : 'bend';
let impact: ImpactController | null = null;
let impactError: string | null = null;
let struck = false;
let yaw = 0.7;
let pitch = 0.42;
let distance = 13;
const focus: [number, number, number] = [0, bendFixture.tower.height * 0.42, 0];
let pointer: { id: number; x: number; y: number; moved: number; light: boolean } | null = null;

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
  bendFixture.light,
);
lifetime.own(scene);
lifetime.own(bend);
panel.intensity.value = String(bendFixture.light.intensity);
applyLight();

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
  if (now - statsStarted >= 2000) {
    fps = frames * 1000 / (now - statsStarted);
    frames = 0;
    statsStarted = now;
  }
  // Diagnostic DOM work does not need to run at the rendering frame rate.
  if (now >= nextReadout) {
    writeReadout(bend, cloud, scene, impact, fps);
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
panel.strike.disabled = true;
panel.strike.addEventListener('click', () => {
  if (impact) strikeUpper(impact);
}, eventOptions);
for (const input of [panel.azimuth, panel.elevation, panel.intensity, panel.relighting]) {
  input.addEventListener('input', applyLight, eventOptions);
}
panel.resetLight.addEventListener('click', () => {
  panel.azimuth.value = panel.azimuth.defaultValue;
  panel.elevation.value = panel.elevation.defaultValue;
  panel.intensity.value = String(bendFixture.light.intensity);
  panel.relighting.checked = true;
  applyLight();
}, eventOptions);

canvas.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || pointer) return;
  const rect = canvas.getBoundingClientRect();
  pointer = {
    id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0,
    light: scene.hitLight(event.clientX - rect.left, event.clientY - rect.top),
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
  if (pointer.light) {
    panel.azimuth.value = String((Number(panel.azimuth.value) + dx * 0.6 + 360) % 360);
    panel.elevation.value = String(Math.min(85, Math.max(10, Number(panel.elevation.value) - dy * 0.4)));
    applyLight();
    return;
  }
  yaw -= dx * 0.006;
  pitch = Math.min(1.15, Math.max(-0.2, pitch - dy * 0.005));
}, eventOptions);
canvas.addEventListener('pointerup', (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const click = pointer.moved < 6 && !pointer.light;
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
window.addEventListener('resize', () => scene.app.resizeCanvas(), eventOptions);
window.addEventListener('pagehide', (event) => {
  // A cached page keeps its resources so back/forward navigation can restore it.
  if (!event.persisted) lifetime.dispose();
}, eventOptions);
if (import.meta.hot) import.meta.hot.dispose(() => lifetime.dispose());

void createImpactController(impactFixture).then((controller) => {
  if (!lifetime.own(controller)) return;
  impact = controller;
  impactError = null;
  panel.strike.disabled = false;
  syncBlocks(controller);
  if (params.get('strike') === '1') {
    if (strength() < 0.5) panel.strength.value = '0.85';
    publishStrength();
    strikeUpper(controller);
  }
}).catch((error: unknown) => {
  if (lifetime.disposed) return;
  impact = null;
  impactError = error instanceof Error ? error.message : String(error);
  panel.strike.disabled = true;
});

if (mode === 'bend') bend.setBend(strength(), direction());
publishStrength();

function setMode(next: Mode, reset: boolean) {
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
  scene.setLight(Number(panel.azimuth.value), Number(panel.elevation.value), Number(panel.intensity.value));
  scene.setRelighting(panel.relighting.checked);
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
    ['Joints broken', impactError ? `solver failed: ${impactError}` : impactController ? `${broken}` : 'loading'],
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

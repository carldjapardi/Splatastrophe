import { createBendController, type BendController } from '../bendController';
import { buildTowerMesh, deformTowerMesh } from '../towerMesh';
import { buildTowerSplats, deformSplats, type SplatCloud } from '../splats';
import { bendFixture, impactFixture } from '../loadFixture';
import { createImpactController, type ImpactController } from '../../../impact/src/index';
import { createTowerScene, type TowerEntities } from './scene';

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
};

const params = new URLSearchParams(location.search);
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

const initialStrength = numberParam('bend', 0);
const initialDirection = numberParam('dir', 25);
panel.strength.value = String(initialStrength);
panel.direction.value = String(initialDirection);
if (params.get('splats') === '0') panel.splats.checked = false;
if (params.get('mesh') === '0') panel.mesh.checked = false;
if (params.get('proxy') === '0') panel.proxy.checked = false;

let mode: Mode = params.get('mode') === 'impact' ? 'impact' : 'bend';
let impact: ImpactController | null = null;
let struck = false;
let yaw = 0.7;
let pitch = 0.42;
let distance = 13;
const focus: [number, number, number] = [0, bendFixture.tower.height * 0.42, 0];
let pointer: { x: number; y: number; moved: number } | null = null;

const scene = createTowerScene(
  canvas,
  visibleMesh,
  proxyMesh,
  cloud,
  impactFixture.bodies.map((body) => ({ halfExtents: body.halfExtents })),
  bendFixture.light,
);

applyBend();
setMode(mode, false);
scene.app.on('update', (dt: number) => {
  if (mode === 'bend') {
    bend.update(dt);
    applyBend();
  } else if (impact) {
    impact.update(dt);
    syncBlocks(impact);
  }
  placeCamera(scene);
  writeReadout(bend, cloud, scene, impact);
  document.body.dataset.ready = '1';
});

panel.bend.addEventListener('click', () => setMode('bend', true));
panel.impact.addEventListener('click', () => setMode('impact', true));
panel.strength.addEventListener('input', () => {
  publishStrength();
  if (mode === 'bend') bend.setBend(strength(), direction());
});
panel.direction.addEventListener('input', () => {
  publishStrength();
  if (mode === 'bend') bend.setBend(strength(), direction());
});
for (const box of [panel.mesh, panel.proxy, panel.splats]) {
  box.addEventListener('change', () => {
    if (mode === 'bend') applyVisibility();
  });
}
panel.reset.addEventListener('click', () => resetActive());
panel.strike.addEventListener('click', () => {
  if (impact) strikeUpper(impact);
});

canvas.addEventListener('pointerdown', (event) => {
  pointer = { x: event.clientX, y: event.clientY, moved: 0 };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.moved += Math.abs(dx) + Math.abs(dy);
  yaw -= dx * 0.006;
  pitch = Math.min(1.15, Math.max(-0.2, pitch - dy * 0.005));
});
canvas.addEventListener('pointerup', (event) => {
  const click = pointer && pointer.moved < 6;
  pointer = null;
  if (!click || mode !== 'impact' || !impact) return;
  const hit = pickBlock(event);
  if (!hit) return;
  impact.impact(hit.point, hit.direction, strength());
  struck = true;
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  distance = Math.min(28, Math.max(4, distance * (event.deltaY > 0 ? 1.08 : 0.93)));
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (event.key === 'b') setMode('bend', true);
  if (event.key === 'i') setMode('impact', true);
  if (event.key === 'r') resetActive();
});
window.addEventListener('resize', () => scene.app.resizeCanvas());

void createImpactController(impactFixture).then((controller) => {
  impact = controller;
  syncBlocks(controller);
  if (params.get('strike') === '1') {
    if (strength() < 0.5) panel.strength.value = '0.85';
    publishStrength();
    strikeUpper(controller);
  }
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (panel.readout) panel.readout.textContent = `Impact solver failed: ${message}`;
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

function writeReadout(controller: BendController, splats: SplatCloud, tower: TowerEntities, impactController: ImpactController | null) {
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
    ['Bend', controller.currentStrength.toFixed(2)],
    ['Tip move', `${tip.position[0].toFixed(2)}, ${tip.position[1].toFixed(2)}, ${tip.position[2].toFixed(2)} m`],
    ['Tip quat', rotation.map((value) => value.toFixed(3)).join(' ')],
    ['Tip scale Y', scaleY.toFixed(3)],
    ['Splats', tower.splats.kind],
    ['Joints broken', impactController ? `${broken}` : 'loading'],
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

function numberParam(name: string, fallback: number): number {
  const value = Number(params.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`demo markup is missing ${label}`);
  return value;
}

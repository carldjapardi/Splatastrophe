import { Application, BLEND_NORMAL, BoundingBox, Color, Entity, Quat, StandardMaterial, Vec3 } from 'playcanvas';
import { createBreakingPhysics } from './breakingPhysics';
import { gateModifier, gatePartIndex, gateParts, gateSpec } from './gateParts';

export function attachGateBreaking(app: Application, landmark: Entity, frameDebris: () => void) {
  const panel = document.querySelector<HTMLElement>('#gate-breaking')!;
  const enable = panel.querySelector<HTMLButtonElement>('[data-enable]')!;
  const actions = panel.querySelector<HTMLFieldSetElement>('fieldset')!;
  const part = panel.querySelector<HTMLSelectElement>('select')!;
  const strength = panel.querySelector<HTMLInputElement>('[data-strength]')!;
  const output = panel.querySelector<HTMLOutputElement>('output')!;
  const pause = panel.querySelector<HTMLButtonElement>('[data-pause]')!;
  const status = panel.querySelector<HTMLElement>('[role=status]')!;
  const show = panel.querySelector<HTMLInputElement>('[data-proxies]')!;
  const events = new AbortController();
  const options = { signal: events.signal };
  let physics: Awaited<ReturnType<typeof createBreakingPhysics>> | undefined;
  let disposed = false;
  let running = false;
  let elapsed = 0;
  let stopAt = 15;
  let awaitingSort = false;
  let sortedSinceSync = false;
  let dirty = false;
  let rest: Float32Array | undefined;
  let membership: Int8Array | undefined;
  const rotations = new Float32Array(13 * 4);
  const offsets = new Float32Array(13 * 3);
  const matrices = new Float32Array(13 * 12);
  const proxies: Entity[] = [];
  const material = new StandardMaterial();
  material.diffuse = new Color(.3, .75, .55);
  material.emissive = new Color(.12, .35, .22);
  material.opacity = .25;
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.update();
  const component = landmark.gsplat!;
  const originalBounds = component.customAabb;
  panel.hidden = false;
  enable.hidden = false;
  enable.disabled = false;
  actions.hidden = true;
  actions.disabled = true;
  show.checked = false;
  strength.value = '0.5';
  output.value = '50%';
  part.replaceChildren(...gateParts.map((p, i) => new Option(p.name, String(i))));
  status.textContent = '13 coarse parts · physics not started';

  function report() {
    pause.textContent = running ? 'Pause' : 'Resume';
    status.textContent = `${running ? 'Simulating' : 'Paused'} · ${physics?.getBrokenCount() ?? 0} parts released · ${elapsed.toFixed(1)} s`;
  }

  function sync() {
    if (!physics || !rest || !membership) return;
    physics.getPoses().forEach((pose, i) => {
      const q = new Quat(...pose.rotation);
      const center = new Vec3(...gateParts[i].center);
      const rotated = q.transformVector(center);
      rotations.set(pose.rotation, i * 4);
      offsets.set(pose.position.map((v, j) => v - [rotated.x, rotated.y, rotated.z][j]), i * 3);
      const x = q.transformVector(Vec3.RIGHT), y = q.transformVector(Vec3.UP), z = q.transformVector(Vec3.BACK);
      matrices.set([x.x, y.x, z.x, offsets[i * 3], x.y, y.y, z.y, offsets[i * 3 + 1], x.z, y.z, z.z, offsets[i * 3 + 2]], i * 12);
      proxies[i].setPosition(...pose.position);
      proxies[i].setRotation(q);
    });
    const resource = component.resource!;
    updateGateSortCenters(rest, membership, matrices, resource.centers!);
    resource.centersVersion++;
    component.setParameter('partRotations[0]', rotations);
    component.setParameter('partOffsets[0]', offsets);
    awaitingSort = true;
    sortedSinceSync = false;
    dirty = false;
  }

  enable.addEventListener('click', async () => {
    enable.disabled = true;
    status.textContent = 'Preparing rigid bodies and stable splat membership…';
    try {
      const next = await createBreakingPhysics(gateParts, gateSpec);
      if (disposed) { next.dispose(); return; }
      physics = next;
      const centers = component.resource?.centers;
      if (!centers) throw new Error('This renderer did not provide Gaussian centers. Reload to retry.');
      rest = centers.slice();
      membership = new Int8Array(rest.length / 3);
      for (let i = 0; i < membership.length; i++) membership[i] = gatePartIndex([rest[i * 3], -rest[i * 3 + 1], -rest[i * 3 + 2]]);
      for (const p of gateParts) {
        const box = new Entity(p.name);
        box.addComponent('render', { type: 'box', material });
        box.setLocalScale(p.halfSize[0] * 2, p.halfSize[1] * 2, p.halfSize[2] * 2);
        box.enabled = false;
        app.root.addChild(box);
        proxies.push(box);
      }
      component.customAabb = new BoundingBox(new Vec3(.04, -.35, 0), new Vec3(1, 1, 1));
      component.setWorkBufferModifier({ glsl: gateModifier });
      sync();
      enable.hidden = true;
      actions.hidden = false;
      actions.disabled = false;
      running = false;
      report();
    } catch (error) {
      if (disposed) return;
      physics?.dispose();
      physics = undefined;
      proxies.splice(0).forEach(p => p.destroy());
      component.setWorkBufferModifier(null);
      component.customAabb = originalBounds;
      if (rest && component.resource?.centers) {
        component.resource.centers.set(rest);
        component.resource.centersVersion++;
      }
      rest = undefined;
      membership = undefined;
      status.textContent = `Physics unavailable: ${error instanceof Error ? error.message : String(error)}`;
      enable.disabled = false;
    }
  }, options);
  strength.addEventListener('input', () => { output.value = `${Math.round(Number(strength.value) * 100)}%`; }, options);
  panel.querySelector('[data-break]')!.addEventListener('click', () => {
    physics?.breakPart(Number(part.value), Number(strength.value));
    running = true;
    stopAt = elapsed + 15;
    report();
  }, options);
  panel.querySelector('[data-collapse]')!.addEventListener('click', () => {
    physics?.collapse();
    gateParts.forEach((_, i) => physics?.breakPart(i, Number(strength.value)));
    frameDebris();
    running = true;
    stopAt = elapsed + 15;
    report();
  }, options);
  pause.addEventListener('click', () => { running = !running; stopAt = elapsed + 15; report(); }, options);
  panel.querySelector('[data-reset-building]')!.addEventListener('click', () => {
    physics?.reset();
    running = false;
    elapsed = 0;
    stopAt = 15;
    sync();
    report();
  }, options);
  show.addEventListener('change', () => proxies.forEach(p => { p.enabled = show.checked; }), options);
  const update = (dt: number) => {
    if (!physics || document.hidden) return;
    if (running) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), .05) : 0;
      physics.update(step);
      elapsed += step;
      dirty = true;
      if (elapsed >= stopAt) running = false;
      report();
    }
    if (dirty && !awaitingSort) sync();
  };
  const sorted = () => { sortedSinceSync = true; };
  const frameEnd = () => { if (sortedSinceSync) awaitingSort = false; };
  app.scene.on('gsplat:sorted', sorted);
  app.on('frameend', frameEnd);
  app.on('update', update);
  return () => {
    disposed = true;
    events.abort();
    app.off('update', update);
    app.scene.off('gsplat:sorted', sorted);
    app.off('frameend', frameEnd);
    physics?.dispose();
    proxies.forEach(p => p.destroy());
    material.destroy();
    component.setWorkBufferModifier(null);
    component.customAabb = originalBounds;
    if (rest && component.resource?.centers) {
      component.resource.centers.set(rest);
      component.resource.centersVersion++;
    }
    panel.hidden = true;
  };
}

export function updateGateSortCenters(rest: Float32Array, membership: Int8Array, matrices: Float32Array, out: Float32Array) {
  for (let i = 0; i < membership.length; i++) {
    const j = i * 3, id = membership[i];
    if (id < 0) { out[j] = rest[j]; out[j + 1] = rest[j + 1]; out[j + 2] = rest[j + 2]; continue; }
    const m = id * 12, x = rest[j], y = -rest[j + 1], z = -rest[j + 2];
    out[j] = matrices[m] * x + matrices[m + 1] * y + matrices[m + 2] * z + matrices[m + 3];
    out[j + 1] = -(matrices[m + 4] * x + matrices[m + 5] * y + matrices[m + 6] * z + matrices[m + 7]);
    out[j + 2] = -(matrices[m + 8] * x + matrices[m + 9] * y + matrices[m + 10] * z + matrices[m + 11]);
  }
}

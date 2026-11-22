import { Application, Asset, Color, Entity, FILLMODE_NONE, RESOLUTION_AUTO, Vec3 } from 'playcanvas';
import type { LandmarkEntry } from './catalog';

export async function mountLandmark(entry: LandmarkEntry, signal: AbortSignal) {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const stage = canvas.parentElement!;
  const controls = new AbortController();
  const app = new Application(canvas);
  let objectUrl: string | undefined;
  let observer: ResizeObserver | undefined;
  const dispose = () => {
    controls.abort();
    observer?.disconnect();
    app.destroy();
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${entry.asset}`, { signal });
    if (!response.ok) throw new Error(`${entry.name} download failed (HTTP ${response.status})`);
    objectUrl = URL.createObjectURL(await response.blob());
    signal.throwIfAborted();

    const preset = entry.camera;
    const camera = new Entity('Orbit camera');
    camera.addComponent('camera', { clearColor: new Color(.08, .095, .125), nearClip: preset.distance / 75, farClip: preset.distance * 34 });
    app.root.addChild(camera);
    const focus = new Vec3(...preset.target);
    const up = new Vec3(0, 0, 1);
    let yaw = 0, pitch = 0, distance = 0, baseDistance = 0;
    const place = () => {
      const horizontal = distance * Math.cos(pitch);
      camera.setPosition(focus.x + horizontal * Math.cos(yaw),
        focus.y + horizontal * Math.sin(yaw), focus.z + distance * Math.sin(pitch));
      camera.lookAt(focus, up);
    };
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    app.setCanvasFillMode(FILLMODE_NONE);
    app.setCanvasResolution(RESOLUTION_AUTO);
    const resize = () => app.resizeCanvas(stage.clientWidth, stage.clientHeight);
    const reset = () => {
      yaw = preset.yaw;
      pitch = preset.pitch;
      baseDistance = preset.distance * Math.max(1, stage.clientHeight / Math.max(stage.clientWidth, 1));
      distance = baseDistance;
      place();
    };

    const filename = entry.asset.slice(entry.asset.lastIndexOf('/') + 1);
    const asset = new Asset(entry.name, 'gsplat', { url: objectUrl, filename });
    app.assets.add(asset);
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true, signal: controls.signal });
      asset.once('load', () => { signal.removeEventListener('abort', abort); resolve(); });
      asset.once('error', reject);
      app.assets.load(asset);
    });
    signal.throwIfAborted();
    const landmark = new Entity(entry.name);
    landmark.setLocalEulerAngles(preset.rotationX, 0, 0);
    landmark.addComponent('gsplat', { asset });
    app.root.addChild(landmark);

    const options = { signal: controls.signal };
    let pointer: { id: number; x: number; y: number } | undefined;
    canvas.addEventListener('pointerdown', (event) => {
      if (pointer || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      if (pointer?.id !== event.pointerId) return;
      yaw -= (event.clientX - pointer.x) * .007;
      pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.clientY - pointer.y) * .007));
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      place();
    }, options);
    canvas.addEventListener('lostpointercapture', (event) => {
      if (pointer?.id === event.pointerId) pointer = undefined;
    }, options);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      distance = Math.max(baseDistance * .2, Math.min(baseDistance * 5, distance * Math.exp(event.deltaY * .001)));
      place();
    }, { ...options, passive: false });
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    document.querySelector('#landmark-reset')!.addEventListener('click', reset, options);
    resize();
    reset();
    app.start();
    document.body.dataset.ready = '1';
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

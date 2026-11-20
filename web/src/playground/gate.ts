import { Application, Asset, Color, Entity, Vec3 } from 'playcanvas';

export async function mountGate(url: string, signal: AbortSignal) {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const controls = new AbortController();
  const app = new Application(canvas);
  let objectUrl: string | undefined;
  const dispose = () => {
    controls.abort();
    app.destroy();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Brandenburg Gate download failed (HTTP ${response.status})`);
    objectUrl = URL.createObjectURL(await response.blob());
    signal.throwIfAborted();

    const camera = new Entity('Orbit camera');
    camera.addComponent('camera', { clearColor: new Color(.08, .095, .125), nearClip: .004, farClip: 10 });
    app.root.addChild(camera);
    const focus = new Vec3(.04, .34, -.005);
    const up = new Vec3(0, 0, 1);
    let yaw = 0, pitch = 0, distance = 0, baseDistance = 0;
    const place = () => {
      const horizontal = distance * Math.cos(pitch);
      camera.setPosition(focus.x + horizontal * Math.cos(yaw),
        focus.y + horizontal * Math.sin(yaw), focus.z + distance * Math.sin(pitch));
      camera.lookAt(focus, up);
    };
    const resize = () => app.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
    const reset = () => {
      yaw = -Math.PI / 2;
      pitch = .10;
      baseDistance = .31 * Math.max(1, canvas.clientHeight / Math.max(canvas.clientWidth, 1));
      distance = baseDistance;
      place();
    };

    const asset = new Asset('Brandenburg Gate', 'gsplat', { url: objectUrl, filename: 'gate.ply' });
    app.assets.add(asset);
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true, signal: controls.signal });
      asset.once('load', () => { signal.removeEventListener('abort', abort); resolve(); });
      asset.once('error', reject);
      app.assets.load(asset);
    });
    signal.throwIfAborted();
    const gate = new Entity('Brandenburg Gate');
    gate.addComponent('gsplat', { asset });
    app.root.addChild(gate);

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
    window.addEventListener('resize', resize, options);
    document.querySelector('#gate-reset')!.addEventListener('click', reset, options);
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

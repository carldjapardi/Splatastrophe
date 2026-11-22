const root = document.getElementById('fault-point-demo');
const stage = root.querySelector('.fault-stage');
const canvas = stage.querySelector('canvas');
const context = canvas.getContext('2d');
const slider = root.querySelector('#fault-tension');
const value = root.querySelector('[data-tension-value]');
const play = root.querySelector('[data-play]');
const status = root.querySelector('[data-status]');
const markers = [...root.querySelectorAll('[data-point]')];
const reset = root.querySelector('[data-reset]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const listFormat = new Intl.ListFormat('en');
const faults = {
  A: { origin: [-2.20, .90, 1.55], release: .38, direction: -1 },
  B: { origin: [0, .92, 3.56], release: .57, direction: 0 },
  C: { origin: [2.14, 1.03, 2.15], release: .47, direction: 1 }
};
const blocks = [];
const selected = new Set(['A', 'C']);
let tension = 0;
let animation = 0;
let width = 0;
let height = 0;
let unit = 1;
let angle = 0;
let drag = null;
const theme = getComputedStyle(stage);
const colors = Object.fromEntries(['stone', 'light', 'shade', 'seam', 'ground', 'grid', 'active']
  .map(color => [color, theme.getPropertyValue('--' + color).trim()]));

function add(point, x, y, z, dx, dy, dz) {
  const index = blocks.length + 1;
  // Stable, authored variations make replay and scrubbing show the same motion.
  const variation = (Math.sin(index * 25.26) + 1) / 2;
  const spin = (Math.cos(index * 13.39) + 1) / 2;
  blocks.push({ point, x, y, z, dx, dy, dz, variation, spin });
}

add(null, 0, 0, .18, 7.28, 2.80, .36);
add(null, 0, 0, .43, 6.95, 2.53, .14);
for (let row = 0; row < 5; row += 1) {
  const z = .78 + row * .54;
  const stagger = row % 2 ? .045 : -.045;
  add('A', -2.68 + stagger, -.03, z, .80, 1.74, .51);
  add('A', -1.83 + stagger, -.03, z, .87, 1.74, .51);
  add('C', 1.82 + stagger, .09, z, .87, 1.72, .51);
  add('C', 2.68 + stagger, .09, z, .80, 1.72, .51);
  if (row < 4) {
    add('B', -.49, -.71, z, .90, .30, .51);
    add('B', .49, -.71, z, .90, .30, .51);
  }
}
for (let index = -3; index <= 3; index += 1) {
  const point = index < -1 ? 'A' : index > 1 ? 'C' : 'B';
  add(point, index * .88, 0, 3.31, .85, 1.85, .51);
  add(point, index * .88, 0, 3.75, .87, 2.04, .34);
}
for (let index = -2; index <= 2; index += 1) {
  add('B', index * .80, 0, 4.05, .77, 1.65, .25);
}
add('B', -.71, 0, 4.33, .80, 1.34, .28);
add('B', .15, 0, 4.33, .86, 1.34, .28);
add('B', .67, 0, 4.61, .57, .87, .25);

const fixedBlocks = blocks.filter(block => !block.point);
const movingBlocks = blocks.filter(block => block.point);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mix = (a, b, t) => a + (b - a) * t;
function viewPosition(x, y) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

function project(x, y, z) {
  const [viewX, viewY] = viewPosition(x, y);
  return [width * .5 + unit * (viewX - .47 * viewY), height * .67 + unit * (.12 * viewX + .30 * viewY - z)];
}

function depth(x, y, z) {
  const [viewX, viewY] = viewPosition(x, y);
  return viewY + .47 * viewX + .3 * z;
}

function path(points) {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
}

function polygon(points, fill, stroke) {
  path(points);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = .85;
    context.stroke();
  }
}

function drawGround() {
  const plane = [[-6.0, -3.1], [6, -3.1], [6, 2.9], [-6, 2.9]];
  polygon(plane.map(([x, y]) => project(x, y, 0)), colors.ground);
  context.lineWidth = 1;
  context.strokeStyle = colors.grid;
  for (let x = -6; x <= 6; x += 1) {
    path([project(x, -3.1, 0), project(x, 2.9, 0)]);
    context.stroke();
  }
  for (let y = -3; y <= 2; y += 1) {
    path([project(-6, y, 0), project(6, y, 0)]);
    context.stroke();
  }
}

function pose(block) {
  const point = faults[block.point];
  if (!point || !selected.has(block.point)) return { ...block, yaw: 0, roll: 0 };
  const amount = tension / 100;
  const release = point.release + block.variation * .14;
  const progress = clamp((amount - release) / .34, 0, 1);
  const flex = clamp(amount / release, 0, 1) * (1 - progress);
  const travel = 1 - Math.pow(1 - progress, 2);
  const direction = point.direction || (block.variation < .5 ? -1 : 1);
  const spin = block.spin - .5;
  return {
    ...block,
    x: block.x + flex * .09 * direction + travel * direction * (.42 + block.variation * 1.90),
    y: block.y + flex * spin * .10 + travel * ((block.variation - .38) * 3.7),
    z: mix(block.z, .32 + block.spin * .50, progress * progress),
    yaw: travel * spin * 2.65,
    roll: .12 * flex * direction + Math.sin(progress * 2.3) * direction * (.38 + block.spin * .72)
  };
}

function drawBlock(block) {
  const xy = [[-1,-1], [1,-1], [1,1], [-1,1]];
  const yawCos = Math.cos(block.yaw);
  const yawSin = Math.sin(block.yaw);
  const rollCos = Math.cos(block.roll);
  const rollSin = Math.sin(block.roll);
  const corners = [-1, 1].flatMap(zSign => xy.map(([xSign, ySign]) => {
    const x = xSign * block.dx / 2;
    const y = ySign * block.dy / 2;
    const z = zSign * block.dz / 2;
    const rolledX = x * rollCos + z * rollSin;
    const rolledZ = z * rollCos - x * rollSin;
    const worldX = block.x + rolledX * yawCos - y * yawSin;
    const worldY = block.y + rolledX * yawSin + y * yawCos;
    const worldZ = block.z + rolledZ;
    return { screen: project(worldX, worldY, worldZ), order: depth(worldX, worldY, worldZ) };
  }));
  const faces = [
    { indices: [0, 1, 2, 3], color: colors.shade },
    { indices: [0, 4, 5, 1], color: colors.shade },
    { indices: [1, 5, 6, 2], color: colors.shade },
    { indices: [2, 6, 7, 3], color: colors.stone },
    { indices: [3, 7, 4, 0], color: colors.stone },
    { indices: [4, 5, 6, 7], color: colors.light }
  ];
  faces.sort((a, b) => {
    const order = face => face.indices.reduce((sum, i) => sum + corners[i].order, 0);
    return order(a) - order(b);
  });
  for (const face of faces) {
    polygon(face.indices.map(index => corners[index].screen), face.color, colors.seam);
  }
}

function drawFaults() {
  for (const marker of markers) {
    const { origin, release } = faults[marker.dataset.point];
    const [x, y] = project(...origin);
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    const active = selected.has(marker.dataset.point);
    if (!active || tension < 14) continue;
    const progress = clamp(tension / (100 * release), .25, 1);
    const size = unit * .49 * progress;
    path([[x - size * .50, y - size * 1.4], [x - size * .07, y - size * .65],
      [x - size * .21, y - size * .22], [x + size * .31, y + size * .46],
      [x + size * .22, y + size * 1.22]]);
    context.strokeStyle = colors.active;
    context.lineWidth = 1.7;
    context.stroke();
  }
}

function draw() {
  if (!context || !width || !height) return;
  context.clearRect(0, 0, width, height);
  drawGround();
  fixedBlocks.map(pose).forEach(drawBlock);
  const poses = movingBlocks.map(pose);
  poses.sort((a, b) => depth(a.x, a.y, a.z) - depth(b.x, b.y, b.z));
  poses.forEach(drawBlock);
  drawFaults();
}

function update() {
  slider.value = tension;
  value.textContent = Math.round(tension) + '%';
  const names = [...selected].sort();
  const done = names.filter(name => tension / 100 >= faults[name].release);
  const selectedText = names.length ? listFormat.format(names) + ' selected' : 'Select a fault point';
  const phase = !names.length || tension === 0 ? 'Intact' :
    tension >= 100 ? 'Crumbled' : done.length ? 'Separating' : 'Under tension';
  const message = phase + ' · ' + selectedText;
  if (status.textContent !== message) status.textContent = message;
  markers.forEach(button => button.setAttribute('aria-pressed', selected.has(button.dataset.point)));
  play.disabled = selected.size === 0;
  draw();
}

function stop() {
  if (animation) cancelAnimationFrame(animation);
  animation = 0;
  play.textContent = 'Play collapse';
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  unit = Math.min(width / 14.8, height / 7.2);
  if (!context) return;
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  draw();
}

for (const marker of markers) {
  marker.addEventListener('click', () => {
    stop();
    const point = marker.dataset.point;
    if (selected.has(point)) selected.delete(point);
    else selected.add(point);
    update();
  });
}
slider.addEventListener('input', () => {
  stop();
  tension = Number(slider.value);
  update();
});
play.addEventListener('click', () => {
  if (animation) {
    stop();
    return;
  }
  if (tension === 100) tension = 0;
  if (reducedMotion.matches) {
    tension = 100;
    update();
    return;
  }
  const start = performance.now();
  const initial = tension;
  play.textContent = 'Pause';
  function frame(now) {
    tension = Math.min(100, initial + (now - start) / 40);
    update();
    if (tension < 100) animation = requestAnimationFrame(frame);
    else stop();
  }
  animation = requestAnimationFrame(frame);
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && animation) {
    stop();
    update();
  }
});
reset.addEventListener('click', () => {
  stop();
  tension = 0;
  update();
});

function orbit(nextAngle) {
  angle = clamp(nextAngle, -1.05, 1.05);
  draw();
}

canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, angle };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (drag?.id === event.pointerId) orbit(drag.angle + (event.clientX - drag.x) * .007);
});
canvas.addEventListener('lostpointercapture', () => { drag = null; });
canvas.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  orbit(angle + (event.key === 'ArrowRight' ? .15 : -.15));
});
window.addEventListener('pagehide', stop);
new ResizeObserver(resize).observe(stage);
update();
resize();

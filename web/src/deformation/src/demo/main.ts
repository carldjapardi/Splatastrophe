import { loadCatalog, loadFixture } from '../../../playground/catalog';
import { createSceneLoader } from '../../../playground/loading';
import { mountGate } from '../../../playground/gate';
import { mountViewer } from '../../../playground/viewer';

const select = required<HTMLSelectElement>('building');
const reload = required<HTMLButtonElement>('reload');
const retry = required<HTMLButtonElement>('retry');
const controls = required<HTMLFieldSetElement>('controls');
const gateControls = required<HTMLElement>('gate-controls');
const gateId = 'brandenburg-gate';
const gateUrl = `${import.meta.env.BASE_URL}models/brandenburg-gate.ply`;
const status = required<HTMLElement>('load-status');
const errorBox = required<HTMLElement>('load-error');
const errorText = required<HTMLElement>('error-message');
const description = required<HTMLElement>('building-description');
const attribution = required<HTMLElement>('attribution');
const events = new AbortController();
const options = { signal: events.signal };
const loader = createSceneLoader<{ gate: boolean; dispose(): void }>();
let sequence = 0;

async function load() {
  const request = ++sequence;
  controls.disabled = true;
  gateControls.hidden = true;
  status.textContent = 'Loading building…';
  status.dataset.state = 'loading';
  errorBox.hidden = true;
  document.body.dataset.ready = '0';
  document.querySelector('#stage')!.setAttribute('aria-busy', 'true');
  try {
    const selectedId = select.value || gateId;
    const viewer = await loader.replace(async (signal) => {
      const entries = await loadCatalog(signal);
      signal.throwIfAborted();
      const entry = entries.find((entry) => entry.id === selectedId) ?? entries[0];
      select.replaceChildren(...entries.map((entry) => new Option(entry.name, entry.id)));
      select.add(new Option('Brandenburg Gate', gateId), 0);
      if (selectedId === gateId) {
        select.value = selectedId;
        description.textContent = 'Photo-based reconstruction. Drag to orbit and scroll to zoom.';
        attribution.textContent = 'PhotoTourism IMC-PT 2020 / Brandenburg Gate, with the NeRF-W split.';
        return { gate: true, ...await mountGate(gateUrl, signal) };
      }
      select.value = entry.id;
      description.textContent = entry.description;
      attribution.textContent = entry.attribution;
      const fixture = await loadFixture(entry, signal);
      const viewer = await mountViewer(entry, fixture, signal);
      return { gate: false, dispose: () => viewer.dispose() };
    });
    if (!viewer || request !== sequence) return;
    controls.disabled = viewer.gate;
    controls.hidden = viewer.gate;
    gateControls.hidden = !viewer.gate;
    document.body.dataset.building = viewer.gate ? 'gate' : 'tower';
    status.textContent = viewer.gate ? 'Ready · Gaussian reconstruction' : 'Ready · procedural fixture';
    status.dataset.state = 'ready';
  } catch (error) {
    if (request !== sequence) return;
    status.textContent = 'Unable to load';
    status.dataset.state = 'error';
    errorText.textContent = error instanceof Error ? error.message : String(error);
    errorBox.hidden = false;
  } finally {
    if (request === sequence) document.querySelector('#stage')!.setAttribute('aria-busy', 'false');
  }
}
reload.addEventListener('click', () => void load(), options);
retry.addEventListener('click', () => void load(), options);
select.addEventListener('change', () => void load(), options);
function dispose() {
  sequence += 1;
  events.abort();
  loader.dispose();
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, options);
if (import.meta.hot) import.meta.hot.dispose(dispose);
void load();

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Playground markup is missing ${id}`);
  return element as T;
}

import { loadCatalog, loadFixture } from '../../../playground/catalog';
import { createSceneLoader } from '../../../playground/loading';
import { mountLandmark } from '../../../playground/landmark';
import { mountViewer } from '../../../playground/viewer';

const select = required<HTMLSelectElement>('building');
const reload = required<HTMLButtonElement>('reload');
const retry = required<HTMLButtonElement>('retry');
const controls = required<HTMLFieldSetElement>('controls');
const landmarkControls = required<HTMLElement>('landmark-controls');
const status = required<HTMLElement>('load-status');
const errorBox = required<HTMLElement>('load-error');
const errorText = required<HTMLElement>('error-message');
const description = required<HTMLElement>('building-description');
const attribution = required<HTMLElement>('attribution');
const events = new AbortController();
const options = { signal: events.signal };
const loader = createSceneLoader<{ landmark: boolean; dispose(): void }>();
let sequence = 0;

async function load() {
  const request = ++sequence;
  controls.disabled = true;
  landmarkControls.hidden = true;
  status.textContent = 'Loading building…';
  status.dataset.state = 'loading';
  errorBox.hidden = true;
  document.body.dataset.ready = '0';
  document.querySelector('#stage')!.setAttribute('aria-busy', 'true');
  try {
    const selectedId = select.value;
    const viewer = await loader.replace(async (signal) => {
      const entries = await loadCatalog(signal);
      signal.throwIfAborted();
      const entry = entries.find((entry) => entry.id === selectedId) ?? entries[0];
      select.replaceChildren(...entries.map((entry) => new Option(entry.name, entry.id)));
      select.value = entry.id;
      description.textContent = entry.description;
      attribution.textContent = entry.attribution;
      if (entry.fixture === 'static-sog') return { landmark: true, ...await mountLandmark(entry, signal) };
      const fixture = await loadFixture(entry, signal);
      const viewer = await mountViewer(entry, fixture, signal);
      return { landmark: false, dispose: () => viewer.dispose() };
    });
    if (!viewer || request !== sequence) return;
    controls.disabled = viewer.landmark;
    controls.hidden = viewer.landmark;
    landmarkControls.hidden = !viewer.landmark;
    document.body.dataset.building = viewer.landmark ? 'landmark' : 'tower';
    status.textContent = viewer.landmark ? 'Ready · Gaussian reconstruction' : 'Ready · procedural fixture';
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

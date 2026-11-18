import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotlightSpec } from '../src/playground/catalog';
import type { SplatCloud } from '../src/deformation/src/splats';
import type { TowerMeshData } from '../src/deformation/src/towerMesh';

const state = vi.hoisted(() => ({
  hasLayer: false,
  applicationsCreated: vi.fn(),
  applicationsDestroyed: vi.fn(),
  materials: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
}));

// Inject failures without creating a real browser/GPU application. All the
// production factory's ownership/cleanup code still runs.
vi.mock('playcanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('playcanvas')>();
  return {
    ...actual,
    Application: class {
      scene = {};
      graphicsDevice = {};
      root = { addChild() {} };
      constructor() { state.applicationsCreated(); }
      setCanvasFillMode() {}
      setCanvasResolution() {}
      destroy() { state.applicationsDestroyed(); }
    },
    Entity: class {
      camera = {};
      script = { create: () => ({ layer: state.hasLayer ? { id: 7 } : null, configureMaterial() {} }) };
      light = { layers: [0] };
      render = { meshInstances: [{}] };
      addComponent() {}
      addChild() {}
      setLocalScale() {}
      setLocalPosition() {}
    },
    StandardMaterial: class extends actual.StandardMaterial {
      constructor() {
        super();
        const destroy = vi.fn(() => super.destroy());
        this.destroy = destroy;
        state.materials.push({ destroy });
      }
    },
    Mesh: class {
      setPositions() {}
      setNormals() {}
      setUvs() {}
      setIndices() {}
      update() {}
    },
    MeshInstance: class {},
  };
});
vi.mock('playcanvas/scripts/esm/gsplat/gsplat-relighting.mjs', () => ({ GSplatRelighting: class {} }));
vi.mock('../src/deformation/src/demo/splatView', () => ({
  createSplatView() { throw new Error('injected splat initialization failure'); },
}));

import { createTowerScene } from '../src/deformation/src/demo/scene';

const light: SpotlightSpec = {
  position: [4, 6, 4], target: [0, 2.5, 0], intensity: 4, color: '#fff3dc',
  range: 24, innerConeAngle: 30, outerConeAngle: 55,
};
function initialize() {
  return createTowerScene({} as HTMLCanvasElement, {} as TowerMeshData,
    {} as TowerMeshData, {} as SplatCloud, [], light, [0.38, 0.4, 0.44]);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.materials.length = 0;
  state.hasLayer = false;
});

describe('scene initialization failure cleanup', () => {
  it('destroys the allocated application when relighting setup fails', () => {
    expect(initialize).toThrow(/relighting layer/);
    expect(state.applicationsCreated).toHaveBeenCalledOnce();
    expect(state.applicationsDestroyed).toHaveBeenCalledOnce();
  });

  it('also destroys owned materials when failure occurs later in setup', () => {
    state.hasLayer = true;
    expect(initialize).toThrow('injected splat initialization failure');
    expect(state.materials.length).toBeGreaterThan(0);
    for (const material of state.materials) expect(material.destroy).toHaveBeenCalledOnce();
    expect(state.applicationsDestroyed).toHaveBeenCalledOnce();
  });
});

import {
  Application,
  BLEND_NORMAL,
  Color,
  CULLFACE_NONE,
  Entity,
  FILLMODE_NONE,
  LAYERID_UI,
  LIGHTFALLOFF_LINEAR,
  Mesh,
  MeshInstance,
  RESOLUTION_AUTO,
  StandardMaterial,
  Vec3,
  Quat as PcQuat,
} from 'playcanvas';
import { GSplatRelighting } from 'playcanvas/scripts/esm/gsplat/gsplat-relighting.mjs';
import { quatConjugate, quatRotate, sub, type Quat, type Vec3 as Vec3Tuple } from '../math';
import type { SplatCloud } from '../splats';
import type { TowerMeshData } from '../towerMesh';
import type { Point, SpotlightSpec } from '../../../playground/catalog';
import { pointOnPlane as intersectDragPlane } from '../../../playground/light';
import { createSplatView, type SplatView } from './splatView';

export interface TowerEntities {
  app: Application;
  camera: Entity;
  visible: Entity;
  proxy: Entity;
  blocks: Entity;
  splats: SplatView;
  uploadTower(mesh: TowerMeshData, proxyMesh: TowerMeshData): void;
  syncBlock(index: number, position: Vec3Tuple, rotation: Quat): void;
  setMode(mode: 'bend' | 'impact'): void;
  setBendVisibility(flags: { mesh: boolean; proxy: boolean; splats: boolean }): void;
  raycastBlocks(origin: Vec3Tuple, direction: Vec3Tuple): { index: number; point: Vec3Tuple } | null;
  dispose(): void;
  setLight(light: SpotlightSpec): void;
  resize(): void;
  pointOnPlane(x: number, y: number, height: number): Point | null;
  setRelighting(enabled: boolean): void;
  hitLight(x: number, y: number): 'position' | 'target' | null;
}

export interface BlockPrototype {
  halfExtents: Vec3Tuple;
  position: Vec3Tuple;
  rotation: Quat;
}

export function createTowerScene(
  canvas: HTMLCanvasElement,
  visibleMesh: TowerMeshData,
  proxyMesh: TowerMeshData,
  splats: SplatCloud,
  blocks: BlockPrototype[],
  lightSpec: SpotlightSpec,
  ambient: Vec3Tuple,
): TowerEntities {
  const app = new Application(canvas, {
    graphicsDeviceOptions: { antialias: false },
  });
  const materials: StandardMaterial[] = [];
  const ownedMaterial = (color: Color, gloss: number) => {
    const material = standard(color, gloss);
    materials.push(material);
    return material;
  };
  let splatView: SplatView | undefined;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      splatView?.dispose();
    } finally {
      try {
        materials.forEach((material) => material.destroy());
      } finally {
        app.destroy();
      }
    }
  }
  try {
    app.setCanvasFillMode(FILLMODE_NONE);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.scene.ambientLight = new Color(...ambient);

    const camera = new Entity('camera');
    camera.addComponent('camera', {
      clearColor: new Color(0.62, 0.7, 0.76),
      fov: 38,
      nearClip: 0.05,
      farClip: 80,
    });
    app.root.addChild(camera);
    camera.addComponent('script');
    const relighting = camera.script!.create(GSplatRelighting);
    if (!relighting?.layer) throw new Error('PlayCanvas relighting layer was not initialized');

    const lightEntity = new Entity('spotlight');
    lightEntity.addComponent('light', {
      type: 'spot',
      range: lightSpec.range,
      innerConeAngle: lightSpec.innerConeAngle,
      outerConeAngle: lightSpec.outerConeAngle,
      falloffMode: LIGHTFALLOFF_LINEAR,
      color: new Color().fromString(lightSpec.color),
      intensity: lightSpec.intensity,
      castShadows: true,
    });
    const light = lightEntity.light;
    if (!light) throw new Error('spotlight component is missing');
    light.shadowResolution = 2048;
    light.shadowBias = 0.1;
    light.normalOffsetBias = 0.05;
    light.layers = [...light.layers, relighting.layer.id];
    app.root.addChild(lightEntity);
    function handle(name: string, color: Color, size: number) {
      const material = ownedMaterial(color, 0);
      material.useLighting = false;
      material.emissive.copy(color);
      // The UI layer renders its transparent sublayer after the splat pass.
      material.blendType = BLEND_NORMAL;
      material.depthTest = false;
      material.depthWrite = false;
      material.update();
      const entity = new Entity(name);
      entity.addComponent('render', {
        type: 'sphere', material, castShadows: false, layers: [LAYERID_UI],
      });
      entity.setLocalScale(size, size, size);
      app.root.addChild(entity);
      return entity;
    }
    const lightHandle = handle('spotlight-position', new Color(1, 0.72, 0.1), 0.35);
    const aimHandle = handle('spotlight-aim', new Color(0.05, 0.8, 0.7), 0.2);

    const groundMaterial = ownedMaterial(new Color(0.45, 0.48, 0.45), 0.15);
    const ground = new Entity('ground');
    ground.addComponent('render', { type: 'box', material: groundMaterial });
    ground.setLocalScale(40, 0.12, 40);
    ground.setLocalPosition(0, -0.06, 0);
    const groundInstance = ground.render?.meshInstances[0];
    if (groundInstance) groundInstance.receiveShadows = true;
    app.root.addChild(ground);

    const visibleMaterial = ownedMaterial(new Color(0.74, 0.66, 0.54), 0.28);
    visibleMaterial.opacity = 0.55;
    visibleMaterial.blendType = BLEND_NORMAL;
    visibleMaterial.update();
    const visible = meshEntity(app, 'tower-visible', visibleMesh, visibleMaterial, false);

    const proxyMaterial = ownedMaterial(new Color(0.5, 0.5, 0.5), 0);
    proxyMaterial.cull = CULLFACE_NONE;
    relighting.configureMaterial(proxyMaterial);
    const proxy = meshEntity(app, 'tower-proxy', proxyMesh, proxyMaterial, true);
    proxy.render!.layers = [relighting.layer.id];

    const blockRoot = new Entity('impact-blocks');
    const blockEntities: Entity[] = [];
    blocks.forEach((block, index) => {
      const material = ownedMaterial(index % 2 === 0 ? new Color(0.62, 0.4, 0.3) : new Color(0.78, 0.62, 0.46), 0.22);
      const entity = new Entity(`block-${index}`);
      entity.addComponent('render', { type: 'box', material });
      entity.setLocalPosition(block.position[0], block.position[1], block.position[2]);
      entity.setLocalRotation(block.rotation[0], block.rotation[1], block.rotation[2], block.rotation[3]);
      entity.setLocalScale(block.halfExtents[0] * 2, block.halfExtents[1] * 2, block.halfExtents[2] * 2);
      const instance = entity.render?.meshInstances[0];
      if (instance) {
        instance.castShadows = true;
        instance.receiveShadows = true;
      }
      blockRoot.addChild(entity);
      blockEntities.push(entity);
    });
    blockRoot.enabled = false;
    app.root.addChild(blockRoot);

    const view = createSplatView(app, splats);
    splatView = view;
    app.start();

    const result: TowerEntities = {
      app,
      camera,
      visible,
      proxy,
      blocks: blockRoot,
      splats: view,
      dispose,
      setLight(spec) {
        lightEntity.setLocalPosition(...spec.position);
        if (Math.hypot(...spec.position.map((v, i) => v - spec.target[i])) > 0.1) {
          const direction = new Vec3(...spec.target).sub(new Vec3(...spec.position)).normalize();
          // Spotlights emit along -Y. This also handles a directly vertical aim.
          lightEntity.setRotation(new PcQuat().setFromDirections(Vec3.DOWN, direction));
        }
        light.intensity = spec.intensity;
        light.color = new Color().fromString(spec.color);
        lightHandle.setLocalPosition(...spec.position);
        aimHandle.setLocalPosition(...spec.target);
      },
      setRelighting(enabled) {
        relighting.blend = enabled ? 1 : 0;
      },
      hitLight(x, y) {
        const hit = ([['position', lightHandle], ['target', aimHandle]] as const)
          .map(([name, entity]) => {
            const position = entity.getPosition();
            const p = camera.camera!.worldToScreen(position, new Vec3());
            const edge = position.clone().add(camera.right.clone().mulScalar(entity.getLocalScale().x / 2));
            const radius = Math.max(18, Math.abs(camera.camera!.worldToScreen(edge).x - p.x) + 4);
            return { name, distance: p.z > 0 ? Math.hypot(p.x - x, p.y - y) / radius : Infinity };
          }).sort((a, b) => a.distance - b.distance)[0];
        return hit.distance < 1 ? hit.name : null;
      },
      pointOnPlane(x, y, height) {
        const component = camera.camera!;
        const a = component.screenToWorld(x, y, component.nearClip);
        const b = component.screenToWorld(x, y, component.farClip);
        return intersectDragPlane([a.x, a.y, a.z], [b.x, b.y, b.z], height);
      },
      resize() {
        const bounds = canvas.parentElement!.getBoundingClientRect();
        app.resizeCanvas(Math.max(1, Math.floor(bounds.width)), Math.max(1, Math.floor(bounds.height)));
      },
      uploadTower(mesh, proxySource) {
        replaceMesh(visible, mesh);
        replaceMesh(proxy, proxySource);
      },
      syncBlock(index, position, rotation) {
        const entity = blockEntities[index];
        entity.setLocalPosition(position[0], position[1], position[2]);
        entity.setLocalRotation(rotation[0], rotation[1], rotation[2], rotation[3]);
      },
      setMode(mode) {
        const bend = mode === 'bend';
        visible.enabled = bend;
        proxy.enabled = bend;
        blockRoot.enabled = !bend;
        if (!bend) view.setVisible(false);
      },
      setBendVisibility(flags) {
        visible.enabled = flags.mesh;
        proxy.enabled = flags.proxy;
        view.setVisible(flags.splats);
      },
      raycastBlocks(origin, direction) {
        let bestIndex = -1;
        let bestDistance = Infinity;
        let bestPoint: [number, number, number] = [0, 0, 0];
        for (let index = 0; index < blocks.length; index += 1) {
          const entity = blockEntities[index];
          const position = entity.getLocalPosition();
          const rotation = entity.getLocalRotation();
          const distance = rayBox(
            origin,
            direction,
            [position.x, position.y, position.z],
            [rotation.x, rotation.y, rotation.z, rotation.w],
            blocks[index].halfExtents,
          );
          if (distance === null || distance >= bestDistance) continue;
          bestIndex = index;
          bestDistance = distance;
          bestPoint = [
            origin[0] + direction[0] * distance,
            origin[1] + direction[1] * distance,
            origin[2] + direction[2] * distance,
          ];
        }
        return bestIndex < 0 ? null : { index: bestIndex, point: bestPoint };
      },
    };
    result.resize();
    result.setLight(lightSpec);
    return result;
  } catch (error) {
    dispose();
    throw error;
  }
}

function meshEntity(
  app: Application,
  name: string,
  source: TowerMeshData,
  material: StandardMaterial,
  castShadows: boolean,
): Entity {
  const mesh = new Mesh(app.graphicsDevice);
  mesh.setPositions(source.deformedPositions);
  mesh.setNormals(source.deformedNormals);
  mesh.setUvs(0, source.uvs);
  mesh.setIndices(source.indices);
  mesh.update();
  const entity = new Entity(name);
  const instance = new MeshInstance(mesh, material, entity);
  instance.castShadows = castShadows;
  instance.receiveShadows = true;
  entity.addComponent('render', { meshInstances: [instance] });
  app.root.addChild(entity);
  return entity;
}

function replaceMesh(entity: Entity, source: TowerMeshData): void {
  const mesh = entity.render?.meshInstances[0]?.mesh;
  if (!mesh) return;
  mesh.setPositions(source.deformedPositions);
  mesh.setNormals(source.deformedNormals);
  mesh.update();
}

function standard(diffuse: Color, gloss: number): StandardMaterial {
  const material = new StandardMaterial();
  material.diffuse = diffuse;
  material.gloss = gloss;
  material.useMetalness = true;
  material.metalness = 0;
  material.update();
  return material;
}

function rayBox(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  center: Vec3Tuple,
  rotation: Quat,
  halfExtents: Vec3Tuple,
): number | null {
  const inverse = quatConjugate(rotation);
  const localOrigin = quatRotate(inverse, sub(origin, center));
  const localDirection = quatRotate(inverse, direction);
  let tMin = 0;
  let tMax = 80;
  for (let axis = 0; axis < 3; axis += 1) {
    const start = localOrigin[axis];
    const delta = localDirection[axis];
    const half = halfExtents[axis];
    if (Math.abs(delta) < 1e-8) {
      if (start < -half || start > half) return null;
      continue;
    }
    let t1 = (-half - start) / delta;
    let t2 = (half - start) / delta;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

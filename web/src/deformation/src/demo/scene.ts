import {
  Application,
  BLEND_NORMAL,
  Color,
  CULLFACE_NONE,
  Entity,
  FILLMODE_FILL_WINDOW,
  Mesh,
  MeshInstance,
  RESOLUTION_AUTO,
  StandardMaterial,
} from 'playcanvas';
import { quatConjugate, quatRotate, sub, type Quat, type Vec3 as Vec3Tuple } from '../math';
import type { SplatCloud } from '../splats';
import type { TowerMeshData } from '../towerMesh';
import type { DirectionalLightSpec } from '../fixture';
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
  lightSpec: DirectionalLightSpec,
): TowerEntities {
  const app = new Application(canvas, {
    graphicsDeviceOptions: { antialias: false },
  });
  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);
  app.scene.ambientLight = new Color(lightSpec.ambient[0], lightSpec.ambient[1], lightSpec.ambient[2]);

  const camera = new Entity('camera');
  camera.addComponent('camera', {
    clearColor: new Color(0.62, 0.7, 0.76),
    fov: 38,
    nearClip: 0.05,
    farClip: 80,
  });
  app.root.addChild(camera);

  const lightEntity = new Entity('sun');
  lightEntity.addComponent('light', {
    type: 'directional',
    color: new Color(lightSpec.color[0], lightSpec.color[1], lightSpec.color[2]),
    intensity: lightSpec.intensity,
    castShadows: true,
  });
  const light = lightEntity.light;
  if (!light) throw new Error('directional light component is missing');
  light.shadowResolution = 2048;
  light.shadowDistance = 30;
  light.shadowBias = 0.25;
  light.normalOffsetBias = 0.12;
  const lightDirection = unit(lightSpec.direction);
  lightEntity.setLocalPosition(-lightDirection[0] * 12, -lightDirection[1] * 12, -lightDirection[2] * 12);
  lightEntity.lookAt(0, 2.6, 0);
  app.root.addChild(lightEntity);

  const groundMaterial = standard(new Color(0.45, 0.48, 0.45), 0.15);
  const ground = new Entity('ground');
  ground.addComponent('render', { type: 'box', material: groundMaterial });
  ground.setLocalScale(40, 0.12, 40);
  ground.setLocalPosition(0, -0.06, 0);
  const groundInstance = ground.render?.meshInstances[0];
  if (groundInstance) groundInstance.receiveShadows = true;
  app.root.addChild(ground);

  const visibleMaterial = standard(new Color(0.74, 0.66, 0.54), 0.28);
  visibleMaterial.opacity = 0.55;
  visibleMaterial.blendType = BLEND_NORMAL;
  visibleMaterial.update();
  const visible = meshEntity(app, 'tower-visible', visibleMesh, visibleMaterial, false);

  const proxyMaterial = standard(new Color(0.93, 0.78, 0.48), 0.4);
  proxyMaterial.opacity = 0.22;
  proxyMaterial.blendType = BLEND_NORMAL;
  proxyMaterial.depthWrite = false;
  proxyMaterial.cull = CULLFACE_NONE;
  proxyMaterial.update();
  const proxy = meshEntity(app, 'tower-proxy', proxyMesh, proxyMaterial, true);

  const blockRoot = new Entity('impact-blocks');
  const blockEntities: Entity[] = [];
  blocks.forEach((block, index) => {
    const material = standard(index % 2 === 0 ? new Color(0.62, 0.4, 0.3) : new Color(0.78, 0.62, 0.46), 0.22);
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

  const splatView = createSplatView(app, splats);
  app.start();

  return {
    app,
    camera,
    visible,
    proxy,
    blocks: blockRoot,
    splats: splatView,
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
      if (!bend) splatView.setVisible(false);
    },
    setBendVisibility(flags) {
      visible.enabled = flags.mesh;
      proxy.enabled = flags.proxy;
      splatView.setVisible(flags.splats);
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

function unit(value: Vec3Tuple): Vec3Tuple {
  const len = Math.hypot(value[0], value[1], value[2]);
  if (len < 1e-8) return [0, -1, 0];
  return [value[0] / len, value[1] / len, value[2] / len];
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

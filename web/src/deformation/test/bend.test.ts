import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../../fixtures/physics/synthetic-tower.json';
import { createBendController } from '../src/bendController';
import { parseBendFixture } from '../src/fixture';
import {
  covarianceQuadraticForm,
  quatFromAxisAngle,
  quatRotate,
} from '../src/math';
import { buildTowerSplats, deformSplat, deformSplats } from '../src/splats';
import { buildTowerMesh, deformTowerMesh } from '../src/towerMesh';

const fixture = parseBendFixture(fixtureJson);

describe('synthetic tower bend', () => {
  it('uses a unit quaternion [x, y, z, w] and a right-handed bend', () => {
    const quarter = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const turned = quatRotate(quarter, [0, 1, 0]);
    expect(Math.hypot(...quarter)).toBeCloseTo(1, 6);
    expect(turned[0]).toBeCloseTo(-1, 5);
    expect(turned[1]).toBeCloseTo(0, 5);
    expect(quarter[3]).toBeGreaterThan(0.7);
  });

  it('keeps the anchored base planted and bends the tip along the requested direction', () => {
    const field = createBendController({
      tower: fixture.tower,
      maxTipAngleRadians: fixture.bend.maxTipAngleRadians,
      responseSeconds: 0,
    });
    field.setBend(1, [1, 4, 0]);
    field.update(1);
    const bend = field.getField();
    const base = bend.sample([0.4, fixture.tower.anchorHeight * 0.5, -0.2]);
    expect(base.anchored).toBe(true);
    expect(base.position).toEqual([0.4, fixture.tower.anchorHeight * 0.5, -0.2]);
    expect(base.rotation).toEqual([0, 0, 0, 1]);

    const tip = bend.sample([0, fixture.tower.height, 0]);
    expect(tip.anchored).toBe(false);
    expect(tip.position[0]).toBeGreaterThan(0.4);
    expect(Math.abs(tip.position[2])).toBeLessThan(0.05);
    expect(tip.position[1]).toBeLessThan(fixture.tower.height);
    expect(Math.hypot(...tip.rotation)).toBeCloseTo(1, 5);

    const lower = bend.sample([0, fixture.tower.anchorHeight + 0.8, 0]);
    expect(lower.position[0]).toBeLessThan(tip.position[0]);

    field.setBend(1, [-2, 0, 0]);
    field.update(1);
    const opposite = field.getField().sample([0, fixture.tower.height, 0]);
    expect(opposite.position[0]).toBeLessThan(-0.4);
    field.dispose();
  });

  it('stretches the outside fiber and compresses the inside fiber', () => {
    const controller = createBendController({
      tower: fixture.tower,
      maxTipAngleRadians: fixture.bend.maxTipAngleRadians,
      responseSeconds: 0,
    });
    controller.setBend(1, [1, 0, 0]);
    controller.update(1);
    const field = controller.getField();
    const y = fixture.tower.height;
    const center = field.sample([0, y, 0]);
    const inside = field.sample([0.45, y, 0]);
    const outside = field.sample([-0.45, y, 0]);
    expect(center.axialStretch).toBeCloseTo(1, 5);
    expect(inside.axialStretch).toBeLessThan(1);
    expect(outside.axialStretch).toBeGreaterThan(1);
    controller.dispose();
  });

  it('eases toward the target and reset returns the rest pose', () => {
    const controller = createBendController({
      tower: fixture.tower,
      maxTipAngleRadians: fixture.bend.maxTipAngleRadians,
      responseSeconds: 0.3,
    });
    controller.setBend(1, [0, 1, 1]);
    controller.update(0.05);
    expect(controller.currentStrength).toBeGreaterThan(0);
    expect(controller.currentStrength).toBeLessThan(0.5);
    controller.update(2);
    expect(controller.currentStrength).toBeGreaterThan(0.95);
    expect(controller.currentDirection[2]).toBeGreaterThan(0.9);
    controller.reset();
    const rest = controller.getField().sample([0, fixture.tower.height, 0]);
    expect(rest.position[0]).toBeCloseTo(0, 5);
    expect(rest.position[1]).toBeCloseTo(fixture.tower.height, 5);
    expect(() => {
      controller.dispose();
      controller.setBend(1, [1, 0, 0]);
    }).toThrow(/disposed/);
  });

  it('deforms the visible mesh and a copied proxy with the same field', () => {
    const controller = createBendController({
      tower: fixture.tower,
      maxTipAngleRadians: fixture.bend.maxTipAngleRadians,
      responseSeconds: 0,
    });
    controller.setBend(0.8, [0.2, 0, 1]);
    controller.update(1);
    const field = controller.getField();
    const visible = buildTowerMesh(fixture.tower);
    const proxy = buildTowerMesh(fixture.tower);
    deformTowerMesh(visible, field);
    deformTowerMesh(proxy, field);
    let maxGap = 0;
    for (let i = 0; i < visible.deformedPositions.length; i += 1) {
      maxGap = Math.max(maxGap, Math.abs(visible.deformedPositions[i] - proxy.deformedPositions[i]));
    }
    expect(maxGap).toBe(0);

    const shell = buildTowerMesh(fixture.tower, { outset: fixture.bend.proxyOutset });
    deformTowerMesh(shell, field);
    let baseMaxY = 0;
    let tipMoved = false;
    for (let i = 0; i < shell.positions.length; i += 3) {
      if (shell.positions[i + 1] === 0) {
        expect(shell.deformedPositions[i + 1]).toBeCloseTo(0, 5);
        baseMaxY = Math.max(baseMaxY, Math.abs(shell.deformedPositions[i] - shell.positions[i]));
      }
      const moved = Math.hypot(
        shell.deformedPositions[i] - shell.positions[i],
        shell.deformedPositions[i + 1] - shell.positions[i + 1],
        shell.deformedPositions[i + 2] - shell.positions[i + 2],
      );
      if (shell.positions[i + 1] > fixture.tower.height - 0.05 && moved > 0.2) tipMoved = true;
      const normalLength = Math.hypot(
        shell.deformedNormals[i],
        shell.deformedNormals[i + 1],
        shell.deformedNormals[i + 2],
      );
      expect(normalLength).toBeCloseTo(1, 4);
    }
    expect(baseMaxY).toBe(0);
    expect(tipMoved).toBe(true);
    controller.dispose();
  });

  it('updates splat rotation, scale, and covariance, not only the center', () => {
    const cloud = buildTowerSplats(fixture.tower, {
      grid: fixture.bend.splatGrid,
      scale: fixture.bend.splatScale,
      inset: fixture.bend.splatInset,
    });
    const controller = createBendController({
      tower: fixture.tower,
      maxTipAngleRadians: fixture.bend.maxTipAngleRadians,
      responseSeconds: 0,
    });
    controller.setBend(1, [1, 0, 0]);
    controller.update(1);
    deformSplats(cloud, controller.getField());

    let sawRotation = false;
    let sawStretch = false;
    let sawMovedCenter = false;
    for (let i = 0; i < cloud.count; i += 1) {
      const p = i * 3;
      const r = i * 4;
      const restY = cloud.restPositions[p + 1];
      if (restY <= fixture.tower.anchorHeight) {
        expect(cloud.positions[p]).toBeCloseTo(cloud.restPositions[p], 5);
        expect(cloud.rotations[r + 3]).toBeCloseTo(1, 5);
        continue;
      }
      const deformed = deformSplat(
        [cloud.restPositions[p], restY, cloud.restPositions[p + 2]],
        [0, 0, 0, 1],
        [cloud.restScales[p], cloud.restScales[p + 1], cloud.restScales[p + 2]],
        controller.getField().sample([cloud.restPositions[p], restY, cloud.restPositions[p + 2]]),
      );
      expect(deformed.covariance[1]).toBeCloseTo(deformed.covariance[3], 6);
      expect(covarianceQuadraticForm(deformed.covariance, [1, 0, 0])).toBeGreaterThan(0);
      expect(covarianceQuadraticForm(deformed.covariance, [0, 1, 0])).toBeGreaterThan(0);
      expect(covarianceQuadraticForm(deformed.covariance, [0, 0, 1])).toBeGreaterThan(0);
      if (Math.hypot(deformed.position[0] - cloud.restPositions[p], deformed.position[1] - restY) > 0.05) {
        sawMovedCenter = true;
      }
      if (Math.abs(deformed.rotation[3]) < 0.999) sawRotation = true;
      if (Math.abs(deformed.scale[1] - cloud.restScales[p + 1]) > 1e-3) sawStretch = true;
    }
    expect(sawMovedCenter).toBe(true);
    expect(sawRotation).toBe(true);
    expect(sawStretch).toBe(true);
    controller.dispose();
  });
});

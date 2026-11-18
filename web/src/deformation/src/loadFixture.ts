import fixtureJson from '../../../../fixtures/physics/synthetic-tower.json';
import { parseBendFixture, type BendFixture } from './fixture';
import { parseImpactFixture } from '../../impact/src/index';
import type { ImpactSpec } from '../../impact/src/types';

export const bendFixture: BendFixture = parseBendFixture(fixtureJson);
export const impactFixture: ImpactSpec = parseImpactFixture(fixtureJson);

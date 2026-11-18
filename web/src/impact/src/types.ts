/** Meters. Quaternions are [x, y, z, w]. */
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface ImpactBodySpec {
  id: string;
  halfExtents: Vec3;
  position: Vec3;
  rotation: Quat;
}

export interface ImpactConnectionSpec {
  id: string;
  bodyA: string;
  bodyB: string;
  /** Joint anchor in body A's local space, meters. */
  anchorA: Vec3;
  /** Joint anchor in body B's local space, meters. */
  anchorB: Vec3;
  /** Break when the larger applied endpoint impulse reaches this many N·s. */
  breakImpulse: number;
}

export interface ImpactSpec {
  id: string;
  gravity: Vec3;
  maxImpulse: number;
  influenceRadius: number;
  density: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  fixedTimestep: number;
  bodies: ImpactBodySpec[];
  connections: ImpactConnectionSpec[];
}

export interface BodyState {
  id: string;
  position: [number, number, number];
  rotation: Quat;
}

export interface ConnectionState {
  id: string;
  bodyA: string;
  bodyB: string;
  intact: boolean;
  breakImpulse: number;
}

export interface ImpactHit {
  bodyId: string;
  impulse: number;
}

export interface ImpactResult {
  applied: ImpactHit[];
  broken: string[];
}

export interface ImpactController {
  /**
   * Apply an impulse at a world-space point. `strength` is a fraction of
   * `maxImpulse` (clamped to [0, 2]). Nearby predefined joints break when the
   * impulse delivered to an endpoint reaches that joint's threshold.
   */
  impact(point: Vec3, direction: Vec3, strength: number): ImpactResult;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
  getBodies(): BodyState[];
  getConnections(): ConnectionState[];
  readonly disposed: boolean;
}

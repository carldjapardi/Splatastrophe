// The engine bundles this official script without TypeScript declarations.
declare module 'playcanvas/scripts/esm/gsplat/gsplat-relighting.mjs' {
  import { Layer, Material, Script } from 'playcanvas';
  export class GSplatRelighting extends Script {
    blend: number;
    readonly layer: Layer | null;
    configureMaterial(material: Material): void;
  }
}

import { mat2d, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import type { Drawable2D } from "../drawable";

export type EffectPlacement =
  | { kind: "world"; position: ReadonlyVec2; angle?: number }
  | { kind: "attached"; node: Drawable2D; offset?: ReadonlyVec2; angle?: number };

/** A rigid effect frame. Node scale places the socket without resizing particles. */
export class EffectAnchor {
  private node?: Drawable2D;
  private readonly local = mat2d.create();
  private readonly world = mat2d.create();
  private readonly nodePose = mat2d.create();

  constructor(placement: EffectPlacement) {
    const offset = placement.kind === "world" ? placement.position : placement.offset;
    mat2d.fromRotation(this.local, placement.angle ?? 0);
    this.local[4] = offset?.[0] ?? 0;
    this.local[5] = offset?.[1] ?? 0;
    if (placement.kind === "attached") this.node = placement.node;
  }

  at(alpha: number): ReadonlyMat2d {
    return this.node
      ? this.resolve(this.node.worldMatrixAt(alpha, this.nodePose))
      : this.local;
  }

  forRender(): ReadonlyMat2d {
    return this.node ? this.resolve(this.node.renderWorldMatrix) : this.local;
  }

  detach() {
    if (!this.node) return;
    mat2d.copy(this.local, this.resolve(this.node.worldMatrix(this.nodePose)));
    this.node = undefined;
  }

  private resolve(parent: ReadonlyMat2d) {
    mat2d.multiply(this.world, parent, this.local);
    const angle = Math.atan2(this.world[1], this.world[0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return mat2d.set(this.world, c, s, -s, c, this.world[4], this.world[5]);
  }
}

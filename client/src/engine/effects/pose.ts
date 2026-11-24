import { mat2d, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import type { Drawable2D } from "../drawable";

export type EffectOrigin =
  | { kind: "world"; position: ReadonlyVec2; angle?: number }
  | { kind: "attached"; node: Drawable2D; offset?: ReadonlyVec2; angle?: number };

/** A captured or attached world pose. Sampling borrows a matrix until the next call. */
export class EffectPose {
  private node?: Drawable2D;
  private readonly local = mat2d.create();
  private readonly world = mat2d.create();
  private readonly nodePose = mat2d.create();

  constructor(origin: EffectOrigin) {
    const offset = origin.kind === "world" ? origin.position : origin.offset;
    mat2d.fromRotation(this.local, origin.angle ?? 0);
    this.local[4] = offset?.[0] ?? 0;
    this.local[5] = offset?.[1] ?? 0;
    if (origin.kind === "attached") this.node = origin.node;
  }

  /** Freeze the current simulation pose before the attachment moves or is removed. */
  detach() {
    if (!this.node) return;
    mat2d.copy(this.local, this.worldFrame(this.node.worldMatrix(this.nodePose)));
    this.node = undefined;
  }

  frameAt(alpha: number): ReadonlyMat2d {
    return this.node
      ? this.worldFrame(this.node.worldMatrixAt(alpha, this.nodePose))
      : this.local;
  }

  /** Use the drawable hierarchy's already sampled pose in a render pass. */
  renderFrame(): ReadonlyMat2d {
    return this.node ? this.worldFrame(this.node.renderWorldMatrix) : this.local;
  }

  /** Node scale positions the attachment without resizing the effect. */
  private worldFrame(parent: ReadonlyMat2d) {
    mat2d.multiply(this.world, parent, this.local);
    const angle = Math.atan2(this.world[1], this.world[0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return mat2d.set(this.world, c, s, -s, c, this.world[4], this.world[5]);
  }
}

import { mat2d, vec2, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import { appendTransform, applyMatrix, Transform2D } from "./transform";
import { lerp } from "./util";

type Draw = (ctx: CanvasRenderingContext2D) => void;

/** Draws in local coordinates. Children paint after their parent, in creation order. */
export class Drawable2D extends Transform2D {
  declare readonly parent: Drawable2D | null;
  private readonly children: Drawable2D[] = [];
  private previous?: Transform2D;
  private readonly sampledPosition = vec2.create();
  private readonly sampledScale = vec2.create();
  private readonly sampledWorld = mat2d.create();

  constructor(
    private readonly draw?: Draw,
    parent?: Drawable2D
  ) {
    super(parent);
    parent?.children.push(this);
  }

  /** Origin in parent coordinates for the frame being drawn. */
  get renderPosition(): ReadonlyVec2 {
    return this.sampledPosition;
  }

  /** Start a fixed tick, or snap the subtree to its new pose after a teleport. */
  snapshotPose() {
    const previous = (this.previous ??= new Transform2D());
    vec2.copy(previous.position, this.position);
    vec2.copy(previous.scale, this.scale);
    previous.rotation = this.rotation;
    for (const child of this.children) child.snapshotPose();
  }

  render(ctx: CanvasRenderingContext2D, alpha = 1) {
    // Resolve every part before drawing so geometry can connect two sampled origins.
    let root: Drawable2D = this;
    while (root.parent) root = root.parent;
    root.sample(alpha);
    this.paint(ctx);
  }

  private sample(alpha: number, parentWorld?: ReadonlyMat2d) {
    // A newly constructed drawable can be posed before its first fixed tick.
    const from = this.previous ?? this;
    vec2.lerp(this.sampledPosition, from.position, this.position, alpha);
    vec2.lerp(this.sampledScale, from.scale, this.scale, alpha);
    const rotation = lerp(from.rotation, this.rotation, alpha);
    if (parentWorld) mat2d.copy(this.sampledWorld, parentWorld);
    else mat2d.identity(this.sampledWorld);
    appendTransform(this.sampledWorld, this.sampledPosition, rotation, this.sampledScale);
    for (const child of this.children) child.sample(alpha, this.sampledWorld);
  }

  private paint(ctx: CanvasRenderingContext2D) {
    if (this.draw) {
      ctx.save();
      applyMatrix(ctx, this.sampledWorld);
      this.draw(ctx);
      ctx.restore();
    }
    for (const child of this.children) child.paint(ctx);
  }
}

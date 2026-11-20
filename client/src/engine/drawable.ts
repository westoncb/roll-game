import { mat2d, vec2, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import { appendTransform, applyMatrix, Transform2D } from "./transform";
import { lerp } from "./math";
import type { StyledShape } from "./shape";
import type { DrawFrame } from "./draw-routines";

export type DrawableContent =
  | ((ctx: CanvasRenderingContext2D, frame: DrawFrame) => void)
  | StyledShape;
type DrawableColor = string | { fill: string; stroke: string };
let nextDrawSeed = 0;

/** Draws in local coordinates. Children paint after their parent, in creation order. */
export class Drawable2D extends Transform2D {
  declare readonly parent: Drawable2D | null;
  /** Default fill and stroke for this drawable and its descendants. */
  color?: DrawableColor;
  /** Override to reproduce the same procedural artwork across instances. */
  drawSeed = nextDrawSeed++;
  private readonly children: Drawable2D[] = [];
  private previous?: Transform2D;
  private readonly sampledPosition = vec2.create();
  private readonly scratchPosition = vec2.create();
  private readonly sampledScale = vec2.create();
  private readonly sampledWorld = mat2d.create();

  constructor(
    public content?: DrawableContent,
    parent?: Drawable2D
  ) {
    super(parent);
    parent?.children.push(this);
  }

  /** Stop updating and drawing a child whose lifetime has ended. */
  dispose() {
    if (!this.parent) return;
    const siblings = this.parent.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
  }

  /** Origin in parent coordinates for the frame being drawn. */
  get renderPosition(): ReadonlyVec2 {
    return this.sampledPosition;
  }

  /** World pose prepared by samplePose for this frame. */
  get renderWorldMatrix(): ReadonlyMat2d {
    return this.sampledWorld;
  }

  private get paintColor(): DrawableColor | undefined {
    return this.color ?? this.parent?.paintColor;
  }

  /** Start a fixed tick, or snap the subtree to its new pose after a teleport. */
  snapshotPose() {
    const previous = (this.previous ??= new Transform2D());
    vec2.copy(previous.position, this.position);
    vec2.copy(previous.scale, this.scale);
    previous.rotation = this.rotation;
    for (const child of this.children) child.snapshotPose();
  }

  render(ctx: CanvasRenderingContext2D, alpha = 1, time = 0) {
    this.samplePose(alpha);
    this.paintSampled(ctx, time);
  }

  /** Prepare the whole hierarchy so passes can share the same interpolated pose. */
  samplePose(alpha: number) {
    let root: Drawable2D = this;
    while (root.parent) root = root.parent;
    root.sample(alpha);
  }

  /** Sample a single node's ancestry at a time within the tick, independently of paint. */
  worldMatrixAt(alpha: number, out = mat2d.create()): mat2d {
    if (this.parent) this.parent.worldMatrixAt(alpha, out);
    else mat2d.identity(out);
    return this.appendSample(out, alpha, this.scratchPosition);
  }

  private appendSample(out: mat2d, alpha: number, position: vec2) {
    // A newly constructed drawable can be posed before its first fixed tick.
    const from = this.previous ?? this;
    vec2.lerp(position, from.position, this.position, alpha);
    vec2.lerp(this.sampledScale, from.scale, this.scale, alpha);
    const rotation = lerp(from.rotation, this.rotation, alpha);
    return appendTransform(out, position, rotation, this.sampledScale);
  }

  private sample(alpha: number, parentWorld?: ReadonlyMat2d) {
    if (parentWorld) mat2d.copy(this.sampledWorld, parentWorld);
    else mat2d.identity(this.sampledWorld);
    this.appendSample(this.sampledWorld, alpha, this.sampledPosition);
    for (const child of this.children) child.sample(alpha, this.sampledWorld);
  }

  paintSampled(ctx: CanvasRenderingContext2D, time = 0) {
    if (this.content) {
      ctx.save();
      try {
        applyMatrix(ctx, this.sampledWorld);
        const color = this.paintColor;
        if (typeof color === "string") ctx.fillStyle = ctx.strokeStyle = color;
        else if (color) {
          ctx.fillStyle = color.fill;
          ctx.strokeStyle = color.stroke;
        }
        const frame = { time, seed: this.drawSeed };
        if (typeof this.content === "function") this.content(ctx, frame);
        else this.content.style.draw(ctx, this.content.shape, frame);
      } finally {
        ctx.restore();
      }
    }
    for (const child of this.children) child.paintSampled(ctx, time);
  }
}

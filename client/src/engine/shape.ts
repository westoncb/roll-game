import type { ReadonlyVec2 } from "gl-matrix";
import type { DrawFrame, DrawRoutine } from "./draw-routines";

/** Geometry in the drawable's local coordinates. */
export type Shape2D =
  | { readonly kind: "polygon"; readonly vertices: readonly ReadonlyVec2[] }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly cornerRadius?: number;
    };

export class ShapeStyle {
  constructor(readonly routines: readonly DrawRoutine[]) {}

  draw(ctx: CanvasRenderingContext2D, shape: Shape2D, frame: DrawFrame) {
    for (const draw of this.routines) {
      ctx.save();
      try {
        ctx.beginPath();
        draw(ctx, shape, frame);
      } finally {
        ctx.restore();
        ctx.beginPath();
      }
    }
  }
}

export interface StyledShape {
  readonly shape: Shape2D;
  readonly style: ShapeStyle;
}

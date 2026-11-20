import type { ReadonlyVec2 } from "gl-matrix";
import {
  drawRoutines,
  type BoundDrawCall,
  type DrawCall,
  type DrawFrame,
  type DrawRoutines
} from "./draw-routines";

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
  readonly calls: readonly DrawCall[];
  readonly #draws: readonly BoundDrawCall[];

  constructor(
    calls: readonly DrawCall[],
    routines: DrawRoutines = drawRoutines,
    source = "ShapeStyle.calls"
  ) {
    this.calls = Object.freeze(calls.map((call) => Object.freeze({ ...call })));
    this.#draws = this.calls.map((call, i) => {
      const location = `${source}[${i}]`;
      if (!Object.hasOwn(routines, call.routine))
        throw new Error(`Unknown draw routine "${call.routine}" at ${location}.`);
      return routines[call.routine](call, location);
    });
  }

  draw(ctx: CanvasRenderingContext2D, shape: Shape2D, frame: DrawFrame) {
    for (const draw of this.#draws) {
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

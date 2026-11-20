import type { ReadonlyVec2 } from "gl-matrix";

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

export interface ShapeStyle {
  /** Painted in order, back to front. */
  readonly layers: readonly ShapeLayer[];
}

export type ShapeLayer = Readonly<
  ({ kind: "fill" } | { kind: "stroke"; width: number }) & {
    /** Omit to use the drawable's fill or stroke color. */
    color?: string;
    opacity?: number;
  }
>;

export interface StyledShape {
  readonly shape: Shape2D;
  readonly style: ShapeStyle;
}

export function drawShape(ctx: CanvasRenderingContext2D, { shape, style }: StyledShape) {
  const path = new Path2D();
  if (shape.kind === "polygon") {
    const { vertices } = shape;
    if (vertices.length < 3) return;
    path.moveTo(vertices[0][0], vertices[0][1]);
    for (let i = 1; i < vertices.length; i++) path.lineTo(vertices[i][0], vertices[i][1]);
    path.closePath();
  } else {
    path.roundRect(shape.x, shape.y, shape.width, shape.height, shape.cornerRadius ?? 0);
  }

  for (const layer of style.layers) {
    ctx.save();
    if (layer.opacity !== undefined) ctx.globalAlpha *= layer.opacity;
    if (layer.kind === "fill") {
      if (layer.color !== undefined) ctx.fillStyle = layer.color;
      ctx.fill(path);
    } else {
      if (layer.color !== undefined) ctx.strokeStyle = layer.color;
      ctx.lineWidth = layer.width;
      ctx.stroke(path);
    }
    ctx.restore();
  }
}

import type { Shape2D } from "./shape";

export type RoutineSettings = Readonly<Record<string, unknown>>;

export interface DrawFrame {
  /** Interpolated simulation time in seconds. */
  readonly time: number;
  /** Stable across frames for this drawable. */
  readonly seed: number;
}

export type DrawRoutine = (
  ctx: CanvasRenderingContext2D,
  shape: Shape2D,
  frame: DrawFrame
) => void;

export function shapePath(shape: Shape2D) {
  const path = new Path2D();
  if (shape.kind === "rect") {
    path.roundRect(shape.x, shape.y, shape.width, shape.height, shape.cornerRadius ?? 0);
  } else if (shape.vertices.length >= 3) {
    const { vertices } = shape;
    path.moveTo(vertices[0][0], vertices[0][1]);
    for (let i = 1; i < vertices.length; i++) path.lineTo(vertices[i][0], vertices[i][1]);
    path.closePath();
  }
  return path;
}

function readPaint(
  settings: RoutineSettings,
  source: string,
  extra: readonly string[] = []
) {
  for (const key of Object.keys(settings)) {
    if (!["color", "opacity"].includes(key) && !extra.includes(key))
      throw new Error(`Unknown field ${source}.${key}.`);
  }
  const { color, opacity } = settings;
  if (color !== undefined && !(typeof color === "string" && color.trim()))
    throw new Error(`Invalid ${source}.color.`);
  if (
    opacity !== undefined &&
    !(typeof opacity === "number" && opacity >= 0 && opacity <= 1)
  )
    throw new Error(`Invalid ${source}.opacity.`);
  return { color, opacity };
}

export function fill(settings: RoutineSettings = {}, source = "fill"): DrawRoutine {
  const { color, opacity } = readPaint(settings, source);
  return (ctx, shape) => {
    if (color !== undefined) ctx.fillStyle = color;
    if (opacity !== undefined) ctx.globalAlpha *= opacity;
    ctx.fill(shapePath(shape));
  };
}

export function stroke(settings: RoutineSettings, source = "stroke"): DrawRoutine {
  const { color, opacity } = readPaint(settings, source, ["width"]);
  const { width } = settings;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0)
    throw new Error(`${source}.width must be positive and finite.`);
  return (ctx, shape) => {
    if (color !== undefined) ctx.strokeStyle = color;
    if (opacity !== undefined) ctx.globalAlpha *= opacity;
    ctx.lineWidth = width;
    ctx.stroke(shapePath(shape));
  };
}

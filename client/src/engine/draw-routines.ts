import type { Shape2D } from "./shape";

/** The instruction stored in a style asset. Each routine owns its settings. */
export interface DrawCall {
  readonly routine: string;
  readonly [setting: string]: unknown;
}

export interface DrawFrame {
  /** Interpolated simulation time in seconds. */
  readonly time: number;
  /** Stable across frames for this drawable. */
  readonly seed: number;
}

export type DrawRoutine<Settings> = (
  ctx: CanvasRenderingContext2D,
  shape: Shape2D,
  settings: Settings,
  frame: DrawFrame
) => void;

export type BoundDrawCall = (
  ctx: CanvasRenderingContext2D,
  shape: Shape2D,
  frame: DrawFrame
) => void;
type BindDrawCall = (call: DrawCall, source: string) => BoundDrawCall;
export type DrawRoutines = Readonly<Record<string, BindDrawCall>>;

/** Read settings once when the style is created and reuse them for every draw. */
export function defineDrawRoutine<Settings>(
  read: (call: DrawCall, source: string) => Settings,
  draw: DrawRoutine<Settings>
): BindDrawCall {
  return (call, source) => {
    const settings = read(call, source);
    return (ctx, shape, frame) => draw(ctx, shape, settings, frame);
  };
}

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

function readPaint(call: DrawCall, source: string, extra: readonly string[] = []) {
  for (const key of Object.keys(call)) {
    if (!["routine", "color", "opacity"].includes(key) && !extra.includes(key))
      throw new Error(`Unknown field ${source}.${key}.`);
  }
  const { color, opacity } = call;
  if (color !== undefined && !(typeof color === "string" && color.trim()))
    throw new Error(`Invalid ${source}.color.`);
  if (
    opacity !== undefined &&
    !(typeof opacity === "number" && opacity >= 0 && opacity <= 1)
  )
    throw new Error(`Invalid ${source}.opacity.`);
  return { color, opacity };
}

export const drawRoutines = {
  fill: defineDrawRoutine(readPaint, (ctx, shape, { color, opacity }) => {
    if (color !== undefined) ctx.fillStyle = color;
    if (opacity !== undefined) ctx.globalAlpha *= opacity;
    ctx.fill(shapePath(shape));
  }),
  stroke: defineDrawRoutine(
    (call, source) => {
      const paint = readPaint(call, source, ["width"]);
      const { width } = call;
      if (typeof width !== "number" || !Number.isFinite(width) || width <= 0)
        throw new Error(`${source}.width must be positive and finite.`);
      return { ...paint, width };
    },
    (ctx, shape, { color, opacity, width }) => {
      if (color !== undefined) ctx.strokeStyle = color;
      if (opacity !== undefined) ctx.globalAlpha *= opacity;
      ctx.lineWidth = width;
      ctx.stroke(shapePath(shape));
    }
  )
} satisfies DrawRoutines;

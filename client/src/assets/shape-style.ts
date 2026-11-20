import type { ShapeLayer, ShapeStyle } from "../engine/shape";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLayer(value: unknown, source: string): ShapeLayer {
  if (!isObject(value)) throw new Error(`${source} must be a paint layer.`);
  const { kind, color, opacity, width } = value;
  if (kind !== "fill" && kind !== "stroke") throw new Error(`Invalid ${source}.kind.`);
  for (const field of Object.keys(value)) {
    if (
      !["kind", "color", "opacity"].includes(field) &&
      !(kind === "stroke" && field === "width")
    )
      throw new Error(`Unknown field ${source}.${field}.`);
  }
  if (color !== undefined && !(typeof color === "string" && color.trim()))
    throw new Error(`Invalid ${source}.color.`);
  if (
    opacity !== undefined &&
    !(typeof opacity === "number" && opacity >= 0 && opacity <= 1)
  )
    throw new Error(`Invalid ${source}.opacity.`);
  if (kind === "fill") return { kind, color, opacity };
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0)
    throw new Error(`${source}.width must be positive and finite.`);
  return { kind, color, opacity, width };
}

export function readShapeStyle(data: unknown, source: string): ShapeStyle {
  if (!isObject(data) || data.version !== 1 || !Array.isArray(data.layers))
    throw new Error(`${source} must be a version 1 shape style with a layers array.`);
  return {
    layers: data.layers.map((layer, i) => readLayer(layer, `${source}.layers[${i}]`))
  };
}

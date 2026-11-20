import { ShapeStyle } from "../engine/shape";
import { drawRoutines, type DrawCall, type DrawRoutines } from "../engine/draw-routines";
import { sciFiDirt } from "./draw-routines/sci-fi-dirt";
import { sketchBorder } from "./draw-routines/sketch-border";

const gameDrawRoutines = { ...drawRoutines, sciFiDirt, sketchBorder };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCall(value: unknown, source: string): DrawCall {
  if (!isObject(value) || typeof value.routine !== "string")
    throw new Error(`${source} must name a draw routine.`);
  return { ...value, routine: value.routine };
}

function readLegacyLayer(value: unknown, source: string): DrawCall {
  if (!isObject(value) || (value.kind !== "fill" && value.kind !== "stroke"))
    throw new Error(`Invalid ${source}.kind.`);
  if (Object.hasOwn(value, "routine")) throw new Error(`Unknown field ${source}.routine.`);
  const { kind, ...settings } = value;
  return { routine: kind, ...settings };
}

export function readShapeStyle(
  data: unknown,
  source: string,
  routines: DrawRoutines = gameDrawRoutines
): ShapeStyle {
  if (!isObject(data) || (data.version !== 1 && data.version !== 2))
    throw new Error(`${source} must be a version 1 or 2 shape style.`);
  const legacy = data.version === 1;
  const field = legacy ? "layers" : "calls";
  const entries = data[field];
  if (!Array.isArray(entries)) throw new Error(`${source}.${field} must be an array.`);
  const read = legacy ? readLegacyLayer : readCall;
  const location = `${source}.${field}`;
  const calls = entries.map((entry, i) => read(entry, `${location}[${i}]`));
  return new ShapeStyle(calls, routines, location);
}

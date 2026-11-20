import type { DrawRoutine, RoutineSettings } from "./draw-routines";
import { ShapeStyle } from "./shape";

type RoutineReader = (settings: RoutineSettings, source: string) => DrawRoutine;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readShapeStyle(
  data: unknown,
  source: string,
  readers: Readonly<Record<string, RoutineReader>>
): ShapeStyle {
  if (!isObject(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3))
    throw new Error(`${source} must be a version 1, 2, or 3 shape style.`);

  const field = data.version === 1 ? "layers" : data.version === 2 ? "calls" : "routines";
  const entries = data[field];
  if (!Array.isArray(entries)) throw new Error(`${source}.${field} must be an array.`);
  const nameField = data.version === 1 ? "kind" : "routine";
  const routines = entries.map((entry: unknown, i) => {
    const location = `${source}.${field}[${i}]`;
    if (!isObject(entry)) throw new Error(`${location} must name a draw routine.`);
    const { [nameField]: name, ...settings } = entry;
    // Version 1 defined only fill and stroke layers.
    if (nameField === "kind" && name !== "fill" && name !== "stroke")
      throw new Error(`Invalid ${location}.kind.`);
    if (typeof name !== "string") throw new Error(`${location} must name a draw routine.`);
    if (!Object.hasOwn(readers, name))
      throw new Error(`Unknown draw routine "${name}" at ${location}.`);
    return readers[name](settings, location);
  });
  return new ShapeStyle(routines);
}

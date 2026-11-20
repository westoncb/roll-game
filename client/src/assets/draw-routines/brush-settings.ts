import type { RoutineSettings } from "../../engine/draw-routines";

export function checkFields(
  settings: RoutineSettings,
  fields: readonly string[],
  source: string
) {
  for (const key of Object.keys(settings))
    if (!fields.includes(key)) throw new Error(`Unknown field ${source}.${key}.`);
}

export function color(settings: RoutineSettings, field: string, source: string) {
  const value = settings[field];
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${source}.${field} must be a six-digit hex color.`);
  return value;
}

export function positive(settings: RoutineSettings, field: string, source: string) {
  const value = settings[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${source}.${field} must be positive and finite.`);
  return value;
}

/** Local random stream so repainting artwork never advances gameplay randomness. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

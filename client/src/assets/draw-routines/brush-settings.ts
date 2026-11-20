import type { DrawCall } from "../../engine/draw-routines";

export function checkFields(call: DrawCall, fields: readonly string[], source: string) {
  for (const key of Object.keys(call))
    if (key !== "routine" && !fields.includes(key))
      throw new Error(`Unknown field ${source}.${key}.`);
}

export function color(call: DrawCall, field: string, source: string) {
  const value = call[field];
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${source}.${field} must be a six-digit hex color.`);
  return value;
}

export function positive(call: DrawCall, field: string, source: string) {
  const value = call[field];
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

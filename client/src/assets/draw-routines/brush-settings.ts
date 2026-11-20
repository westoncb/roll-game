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

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function positive(settings: RoutineSettings, field: string, source: string) {
  const value = settings[field];
  if (!isPositive(value))
    throw new Error(`${source}.${field} must be positive and finite.`);
  return value;
}

export function fraction(settings: RoutineSettings, field: string, source: string) {
  const value = settings[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${source}.${field} must be between 0 and 1.`);
  return value;
}

export function positiveRange(
  settings: RoutineSettings,
  field: string,
  source: string
): readonly [min: number, max: number] {
  const value = settings[field];
  if (isPositive(value)) return [value, value];
  if (Array.isArray(value) && value.length === 2) {
    const [min, max] = value;
    if (isPositive(min) && isPositive(max) && min <= max) return [min, max];
  }
  throw new Error(
    `${source}.${field} must be a positive finite number or an ordered [min, max] pair of positive finite numbers.`
  );
}

export { seededRandom } from "../../engine/math";

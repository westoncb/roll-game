import type { EmitterDefinition, ParticleEffectDefinition } from "./definition.ts";

type Check = (value: unknown) => boolean;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const nonnegative: Check = (v) => finite(v) && v >= 0;
const positive: Check = (v) => finite(v) && v > 0;
const unit: Check = (v) => finite(v) && v >= 0 && v <= 1;

function pair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(finite);
}

function sampled(check: Check): Check {
  return (v) => check(v) || (pair(v) && v[0] <= v[1] && v.every(check));
}

function overLife(check: Check): Check {
  return (v) => {
    if (check(v)) return true;
    if (!Array.isArray(v) || !v.length) return false;
    let previous = -1;
    for (const key of v) {
      if (
        !isObject(key) ||
        !finite(key.at) ||
        !unit(key.at) ||
        key.at <= previous ||
        !check(key.value)
      )
        return false;
      previous = key.at;
    }
    return true;
  };
}

function emission(v: unknown) {
  if (!isObject(v)) return false;
  if (v.kind === "burst") return nonnegative(v.count) && Number.isSafeInteger(v.count);
  return (
    v.kind === "rate" &&
    nonnegative(v.perSecond) &&
    (v.duration === undefined || nonnegative(v.duration))
  );
}

const fields = {
  emission,
  lifetime: sampled(positive),
  delay: nonnegative,
  space: (v) => v === "world" || v === "local",
  pass: (v) => v === "behind" || v === "front",
  offset: pair,
  segment: pair,
  direction: sampled(finite),
  speed: sampled(finite),
  acceleration: pair,
  drag: nonnegative,
  rotation: sampled(finite),
  angularSpeed: sampled(finite),
  radius: sampled(nonnegative),
  stretch: nonnegative,
  sizeOverLife: overLife(nonnegative),
  opacityOverLife: overLife(unit),
  colorOverLife: overLife((v) => typeof v === "string" && v.trim().length > 0),
  blend: (v) => v === "normal" || v === "additive",
  strength: (v) =>
    isObject(v) &&
    Object.entries(v).every(
      ([name, scale]) =>
        ["amount", "speed", "size"].includes(name) &&
        pair(scale) &&
        scale.every(nonnegative)
    )
} satisfies Record<keyof EmitterDefinition, Check>;

function assertEmitter(value: unknown, source: string): asserts value is EmitterDefinition {
  if (!isObject(value)) throw new Error(`${source} must be an emitter object.`);
  for (const [field, check] of Object.entries(fields)) {
    if (!(field in value) && field !== "emission" && field !== "lifetime") continue;
    if (!check(value[field])) throw new Error(`Invalid ${source}.${field}.`);
  }
  for (const field of Object.keys(value)) {
    if (!Object.hasOwn(fields, field)) throw new Error(`Unknown field ${source}.${field}.`);
  }
}

export function readParticleEffect(
  data: unknown,
  source: string
): ParticleEffectDefinition {
  if (!isObject(data) || data.version !== 1)
    throw new Error(`${source} must be a version 1 particle effect.`);
  const { fixedSeed } = data;
  if (
    fixedSeed !== undefined &&
    !(
      finite(fixedSeed) &&
      Number.isInteger(fixedSeed) &&
      fixedSeed >= 0 &&
      fixedSeed <= 0xffffffff
    )
  )
    throw new Error(`${source}.fixedSeed must be an unsigned 32-bit integer.`);
  if (!Array.isArray(data.emitters))
    throw new Error(`${source}.emitters must be an array.`);
  const emitters = data.emitters.map((value: unknown, i) => {
    assertEmitter(value, `${source}.emitters[${i}]`);
    return value;
  });
  return { fixedSeed, emitters };
}

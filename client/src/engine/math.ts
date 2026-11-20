import { vec2 } from "gl-matrix";

/** Write the closest point on the closed segment AB into out. */
export function closestPointOnSegment(out: vec2, point: vec2, a: vec2, b: vec2) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return vec2.copy(out, a);
  const projection = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return vec2.set(out, a[0] + t * dx, a[1] + t * dy);
}

export const tau = Math.PI * 2;

export function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

export function angleDifference(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function approach(value: number, target: number, maxChange: number) {
  return value + Math.max(-maxChange, Math.min(maxChange, target - value));
}

export function approachAngle(angle: number, target: number, maxChange: number) {
  return approach(angle, angle + angleDifference(angle, target), maxChange);
}

/** Largest size that fits when increasing the size can only decrease clearance. */
export function largestFit(min: number, max: number, fits: (size: number) => boolean) {
  if (fits(max)) return max;
  if (!fits(min)) return null;
  for (let i = 0; i < 10; i++) {
    const mid = (min + max) / 2;
    if (fits(mid)) min = mid;
    else max = mid;
  }
  return min;
}

/** An independent, reproducible 32-bit random stream. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

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

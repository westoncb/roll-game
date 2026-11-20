import { vec2 } from "gl-matrix";
import type { GroundEdge, GroundPolygon } from "./ground";
import { closestPointOnSegment } from "./math";

export type GroundContact = {
  ground: GroundPolygon;
  edgeIndex: number;
  point: vec2;
  normal: vec2;
  depth: number;
};

/** Signed distance is negative inside the polygon. */
export function nearestBoundary(center: vec2, ground: GroundPolygon) {
  const vertices = ground.vertices;
  const candidate = vec2.create();
  const point = vec2.create();
  let edgeIndex = 0;
  let minSquared = Infinity;
  let inside = false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    closestPointOnSegment(candidate, center, a, b);
    const squared = vec2.squaredDistance(center, candidate);
    if (squared < minSquared) {
      edgeIndex = i;
      minSquared = squared;
      vec2.copy(point, candidate);
    }
    // A horizontal ray toggles inside/outside at each boundary crossing.
    if (a[1] > center[1] !== b[1] > center[1]) {
      const crossingX = a[0] + ((center[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (center[0] < crossingX) inside = !inside;
    }
  }
  const distance = Math.sqrt(minSquared);
  const normal = vec2.create();
  if (distance > 0) {
    vec2.subtract(normal, center, point);
    vec2.scale(normal, normal, (inside ? -1 : 1) / distance);
  } else {
    vec2.copy(normal, ground.edges[edgeIndex].normal);
  }
  return { ground, edgeIndex, point, normal, distance: inside ? -distance : distance };
}

export function circleGroundContact(
  center: vec2,
  radius: number,
  ground: GroundPolygon
): GroundContact | null {
  const { distance, ...boundary } = nearestBoundary(center, ground);
  if (distance > radius + 0.0001) return null;
  return { ...boundary, depth: Math.max(0, radius - distance) };
}

export function nearbyEdges(
  center: vec2,
  radius: number,
  ground: GroundPolygon[]
): GroundEdge[] {
  const edges: GroundEdge[] = [];
  const point = vec2.create();
  for (const polygon of ground) {
    for (const edge of polygon.edges) {
      closestPointOnSegment(point, center, edge.a, edge.b);
      if (vec2.squaredDistance(center, point) <= radius * radius) edges.push(edge);
    }
  }
  return edges;
}

// The caller supplies the nearby edges within reach of the segment.
export function segmentCrossesEdge(a: vec2, b: vec2, edge: GroundEdge) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const ex = edge.b[0] - edge.a[0],
    ey = edge.b[1] - edge.a[1];
  const cross = dx * ey - dy * ex;
  if (Math.abs(cross) < 1e-8) return false;
  const ax = edge.a[0] - a[0],
    ay = edge.a[1] - a[1];
  const t = (ax * ey - ay * ex) / cross;
  const u = (ax * dy - ay * dx) / cross;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}

/** Clip a terrain segment against the interior of a clockwise convex polygon (canvas coordinates). */
export function edgeIntersectsConvexPolygon(edge: GroundEdge, vertices: vec2[]) {
  let enter = 0;
  let exit = 1;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const start = dx * (edge.a[1] - a[1]) - dy * (edge.a[0] - a[0]);
    const end = dx * (edge.b[1] - a[1]) - dy * (edge.b[0] - a[0]);
    if (start < 0 && end < 0) return false;
    if (start < 0) enter = Math.max(enter, start / (start - end));
    if (end < 0) exit = Math.min(exit, start / (start - end));
    if (enter > exit) return false;
  }
  return true;
}

export type TerrainHit = Pick<
  GroundContact,
  "ground" | "edgeIndex" | "point" | "normal"
> & {
  /** Fraction of the requested motion completed at first contact. */
  fraction: number;
};

/** Cast against solid terrain, including the destination. A resting contact allows departure. */
export function castSegment(from: vec2, to: vec2, ground: GroundPolygon[]) {
  return sweepCircle(from, 0, vec2.subtract(vec2.create(), to, from), ground);
}

/** Sweep a circle against offset faces and the round arcs around exposed vertices. */
export function sweepCircle(
  from: vec2,
  radius: number,
  delta: vec2,
  ground: GroundPolygon[]
): TerrainHit | null {
  const motionSquared = vec2.squaredLength(delta);
  if (motionSquared === 0) return null;
  const tolerance = 0.0001;
  // Projecting a float32 velocity onto a resting face can leave a tiny inward component.
  const tangentTolerance = radius > 0 ? Math.sqrt(motionSquared) * 1e-6 : 1e-9;
  let first: TerrainHit | null = null;
  for (const polygon of ground) {
    const initial = nearestBoundary(from, polygon);
    if (
      initial.distance < -tolerance ||
      (initial.distance < radius - tolerance &&
        vec2.dot(delta, initial.normal) < -tangentTolerance)
    )
      return { ...initial, fraction: 0 };

    for (const edge of polygon.edges) {
      const x = from[0] - edge.a[0],
        y = from[1] - edge.a[1];
      const inward = -vec2.dot(delta, edge.normal);
      const gap = x * edge.normal[0] + y * edge.normal[1] - radius;
      if (inward > tangentTolerance && gap >= -tolerance) {
        const fraction = Math.max(0, gap / inward);
        if (fraction <= 1 && (!first || fraction < first.fraction)) {
          const along =
            (x + delta[0] * fraction) * edge.tangent[0] +
            (y + delta[1] * fraction) * edge.tangent[1];
          if (along >= 0 && along <= edge.length) {
            first = {
              ground: polygon,
              edgeIndex: edge.index,
              fraction,
              normal: edge.normal,
              point: vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, along)
            };
          }
        }
      }
      if (radius === 0) continue;
      const toward = -(x * delta[0] + y * delta[1]);
      const discriminant =
        toward * toward - motionSquared * (x * x + y * y - radius * radius);
      if (toward <= 0 || discriminant <= 0) continue;
      const fraction = (toward - Math.sqrt(discriminant)) / motionSquared;
      if (fraction < 0 || fraction > 1 || (first && first.fraction <= fraction)) continue;
      const normal = vec2.fromValues(x + delta[0] * fraction, y + delta[1] * fraction);
      const prev =
        polygon.edges[(edge.index + polygon.edges.length - 1) % polygon.edges.length];
      if (vec2.dot(normal, prev.tangent) < 0 || vec2.dot(normal, edge.tangent) > 0)
        continue;
      first = {
        ground: polygon,
        edgeIndex: edge.index,
        point: edge.a,
        normal: vec2.normalize(normal, normal),
        fraction
      };
    }
  }
  return first;
}

/** First contact of a swept disk with a capsule. Equal endpoints describe a circle.
 * The returned point is on the stationary collider, including for an initial overlap. */
export function castCapsule(
  from: vec2,
  to: vec2,
  movingRadius: number,
  a: vec2,
  b: vec2,
  radius: number
) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const speed2 = dx * dx + dy * dy;
  const reach = movingRadius + radius;
  const point = closestPointOnSegment(vec2.create(), from, a, b);
  let fraction = Infinity;
  if (vec2.squaredDistance(point, from) <= reach * reach) fraction = 0;
  else if (speed2 > 0) {
    // Enter either round cap or one of the two parallel sides.
    for (const center of [a, b]) {
      const x = from[0] - center[0],
        y = from[1] - center[1];
      const proj = -(x * dx + y * dy);
      const disc = proj * proj - speed2 * (x * x + y * y - reach * reach);
      if (proj < 0 || disc < 0) continue;
      const t = (proj - Math.sqrt(disc)) / speed2;
      if (t >= 0 && t <= 1) fraction = Math.min(fraction, t);
    }
    const length = vec2.distance(a, b);
    if (length) {
      const tx = (b[0] - a[0]) / length,
        ty = (b[1] - a[1]) / length;
      const x = from[0] - a[0],
        y = from[1] - a[1];
      const distance = y * tx - x * ty,
        velocity = dy * tx - dx * ty;
      if (distance * velocity < 0) {
        const t = (Math.sign(distance) * reach - distance) / velocity;
        const along = (x + t * dx) * tx + (y + t * dy) * ty;
        if (t >= 0 && t <= 1 && along >= 0 && along <= length)
          fraction = Math.min(fraction, t);
      }
    }
  }
  if (!Number.isFinite(fraction)) return null;
  const center = vec2.lerp(vec2.create(), from, to, fraction);
  closestPointOnSegment(point, center, a, b);
  const normal = vec2.subtract(vec2.create(), center, point);
  if (!vec2.squaredLength(normal)) vec2.set(normal, speed2 ? -dx : 1, -dy);
  vec2.normalize(normal, normal);
  vec2.scaleAndAdd(point, point, normal, radius);
  return { fraction, point, normal };
}

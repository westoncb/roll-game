import { vec2 } from "gl-matrix";
import type { GroundEdge, GroundPolygon } from "./ground";
import { closestPointOnSegment } from "./util";

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

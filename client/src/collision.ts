import { vec2 } from "gl-matrix";
import type { GroundPolygon } from "./ground";
import { closestPointOnSegment } from "./util";

export type GroundContact = {
  ground: GroundPolygon;
  edgeIndex: number;
  point: vec2;
  normal: vec2;
  depth: number;
};

/** Nearest boundary contact for a circle against one solid, simple polygon. */
export function circleGroundContact(
  center: vec2,
  radius: number,
  ground: GroundPolygon
): GroundContact | null {
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
  if (!inside && minSquared > radius * radius) return null;
  const distance = Math.sqrt(minSquared);
  const normal = vec2.create();
  if (distance > 0) {
    vec2.subtract(normal, center, point);
    vec2.scale(normal, normal, (inside ? -1 : 1) / distance);
  } else {
    const a = vertices[edgeIndex];
    const b = vertices[(edgeIndex + 1) % vertices.length];
    vec2.set(normal, (b[1] - a[1]) * ground.winding, (a[0] - b[0]) * ground.winding);
    vec2.normalize(normal, normal);
  }
  return {
    ground,
    edgeIndex,
    point,
    normal,
    depth: inside ? radius + distance : radius - distance
  };
}

import { vec2 } from "gl-matrix";
import { nearbyEdges, nearestBoundary, type GroundContact } from "./collision";
import type { GroundEdge, GroundPolygon } from "./ground";
import { angleDifference, closestPointOnSegment } from "./util";

// An edge offset is measured along its tangent. A corner offset is measured
// along the circular arc at edge.a, starting from the preceding face.
export type Support = { kind: "edge" | "corner"; edge: GroundEdge; offset: number };

const clearanceTolerance = 0.001;

function neighbor(edge: GroundEdge, direction: number) {
  const edges = edge.ground.edges;
  return edges[(edge.index + direction + edges.length) % edges.length];
}

function turnAt(edge: GroundEdge) {
  const previous = neighbor(edge, -1).tangent;
  return angleDifference(
    Math.atan2(previous[1], previous[0]),
    Math.atan2(edge.tangent[1], edge.tangent[0])
  );
}

function limits(support: Support, radius: number): [number, number] {
  const edge = support.edge;
  if (support.kind === "corner") return [0, radius * turnAt(edge)];
  // At an inside corner the two offset lines meet before the original vertex.
  const trim = (turn: number) => radius * Math.tan(Math.max(0, -turn) / 2);
  return [trim(turnAt(edge)), edge.length - trim(turnAt(neighbor(edge, 1)))];
}

export function surfaceNormal(support: Support, radius: number) {
  if (support.kind === "edge") return support.edge.normal;
  const start = neighbor(support.edge, -1).normal;
  const angle = Math.atan2(start[1], start[0]) + support.offset / radius;
  return vec2.fromValues(Math.cos(angle), Math.sin(angle));
}

export function surfacePose(support: Support, radius: number) {
  const { edge, offset } = support;
  const normal = surfaceNormal(support, radius);
  const pos = vec2.scaleAndAdd(vec2.create(), edge.a, normal, radius);
  if (support.kind === "edge") vec2.scaleAndAdd(pos, pos, edge.tangent, offset);
  return { pos, normal };
}

export function supportFromContact(
  contact: Pick<GroundContact, "ground" | "edgeIndex" | "point" | "normal">,
  radius: number
): Support {
  const edge = contact.ground.edges[contact.edgeIndex];
  const along = vec2.dot(vec2.subtract(vec2.create(), contact.point, edge.a), edge.tangent);
  const corner =
    along < 0.0001 ? edge : along > edge.length - 0.0001 ? neighbor(edge, 1) : null;
  if (corner && turnAt(corner) > 0) {
    const n = neighbor(corner, -1).normal;
    const angle = angleDifference(
      Math.atan2(n[1], n[0]),
      Math.atan2(contact.normal[1], contact.normal[0])
    );
    return {
      kind: "corner",
      edge: corner,
      offset: radius * Math.max(0, Math.min(turnAt(corner), angle))
    };
  }
  return { kind: "edge", edge, offset: along };
}

function alongTangent(normal: vec2, vector: vec2) {
  return -normal[1] * vector[0] + normal[0] * vector[1];
}

export function steerAlongSurface(
  support: Support,
  input: vec2,
  center: vec2,
  radius: number,
  ground: GroundPolygon[],
  atRest: boolean
) {
  const normal = surfaceNormal(support, radius);
  const drive = alongTangent(normal, input);
  if (!atRest) return { support, drive };

  // At a junction the resting collider can touch several paths, even on one polygon.
  const paths = [{ support, normal }];
  const point = vec2.create();
  for (const edge of nearbyEdges(center, radius + clearanceTolerance, ground)) {
    if (edge === support.edge) continue;
    closestPointOnSegment(point, center, edge.a, edge.b);
    const radial = vec2.subtract(vec2.create(), center, point);
    if (Math.abs(vec2.length(radial) - radius) > clearanceTolerance) continue;
    const next = supportFromContact(
      {
        ground: edge.ground,
        edgeIndex: edge.index,
        point,
        normal: vec2.normalize(radial, radial)
      },
      radius
    );
    paths.push({ support: next, normal: surfaceNormal(next, radius) });
  }
  let best = { support, drive: 0 };
  let strength = -1;
  for (const path of paths) {
    const projected = alongTangent(path.normal, input);
    if (Math.abs(projected) <= strength) continue;
    // Only consider travel that clears every other touching surface.
    const direction = Math.sign(projected);
    if (
      paths.some((other) => direction * alongTangent(path.normal, other.normal) < -0.000001)
    )
      continue;
    best = { support: path.support, drive: projected };
    strength = Math.abs(projected);
  }
  return best;
}

function adjacent(support: Support, direction: number, radius: number): Support {
  const { edge, kind } = support;
  let next: Support;
  if (kind === "corner") {
    next = { kind: "edge", edge: direction > 0 ? edge : neighbor(edge, -1), offset: 0 };
  } else {
    const vertex = direction > 0 ? neighbor(edge, 1) : edge;
    next =
      turnAt(vertex) > 0.000001
        ? { kind: "corner", edge: vertex, offset: 0 }
        : { kind: "edge", edge: neighbor(edge, direction), offset: 0 };
  }
  const [start, end] = limits(next, radius);
  next.offset = direction > 0 ? start : end;
  return next;
}

export function advanceAlongSurface(
  initial: Support,
  distance: number,
  radius: number,
  ground: GroundPolygon[]
) {
  let support = initial;
  const direction = Math.sign(distance);
  let remaining = Math.abs(distance);
  let travelled = 0;
  let retainedSpeed = 1;
  // A fixed tick usually stays on one feature. The bound also handles pinched passages.
  for (let transitions = 0; remaining > 0.000001 && transitions < 32; transitions++) {
    const [start, end] = limits(support, radius);
    if (end < start) {
      retainedSpeed = 0;
      break;
    }
    const available = direction > 0 ? end - support.offset : support.offset - start;
    const step = Math.max(0, Math.min(remaining, available));
    const at = (travel: number): Support => ({
      ...support,
      offset: support.offset + direction * travel
    });
    let reached = at(step);
    const pos = surfacePose(reached, radius).pos;
    // Another island or a non-adjacent wall can interrupt this feature.
    const obstruction = ground.find(
      (p) => nearestBoundary(pos, p).distance < radius - clearanceTolerance
    );
    if (obstruction) {
      let low = 0,
        high = step;
      for (let i = 0; i < 16; i++) {
        const mid = (low + high) / 2;
        const sample = surfacePose(at(mid), radius);
        if (nearestBoundary(sample.pos, obstruction).distance < radius - clearanceTolerance)
          high = mid;
        else low = mid;
      }
      const hit = nearestBoundary(surfacePose(at(high), radius).pos, obstruction);
      remaining -= low;
      travelled += low;
      reached = at(low);
      const transfer = supportFromContact(hit, radius);
      if (transfer.edge === support.edge && transfer.kind === support.kind) {
        support = reached;
        retainedSpeed = 0;
        break;
      }
      support = transfer;
    } else {
      remaining -= step;
      travelled += step;
      support = reached;
      if (remaining <= 0.000001) break;
      support = adjacent(reached, direction, radius);
    }
    // Project incoming velocity onto the outgoing tangent at the actual join.
    // Rounded corners have a continuous tangent; an inside right angle costs all speed.
    const incoming = surfacePose(reached, radius).normal;
    const outgoing = surfacePose(support, radius).normal;
    const alignment = Math.max(0, Math.min(1, vec2.dot(incoming, outgoing)));
    retainedSpeed *= alignment;
    remaining *= alignment;
  }
  if (remaining > 0.000001) retainedSpeed = 0;
  return { support, travel: direction * travelled, retainedSpeed };
}

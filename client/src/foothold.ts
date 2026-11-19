import { vec2 } from "gl-matrix";
import { segmentCrossesEdge } from "./collision";
import type { GroundEdge } from "./ground";
import { angleDifference, largestFit } from "./util";

export const footHeight = 8;
export const halfSole = 9;
export const foldedFootScale = 0.3;
export const foldedHalfSole = halfSole * foldedFootScale;

export type FootAnchor = { edge: GroundEdge; offset: number; maxHalfWidth: number };
export type Pose = { angle: number; length: number; footAngle: number };
export type LegStance = {
  center: vec2;
  restLength: number;
  minReach: number;
  maxReach: number;
};

export function plantedPose(center: vec2, { edge, offset }: FootAnchor): Pose {
  const ankle = vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, offset);
  vec2.scaleAndAdd(ankle, ankle, edge.normal, footHeight);
  const delta = vec2.subtract(ankle, ankle, center);
  return {
    angle: Math.atan2(delta[1], delta[0]),
    length: vec2.length(delta),
    footAngle: Math.atan2(-edge.normal[1], -edge.normal[0])
  };
}

// Check the leg and the whole footprint, including narrow tips of terrain
// that can poke between the two ends of the sole.
export function poseFits(
  center: vec2,
  pose: Pose,
  edges: GroundEdge[],
  height: number,
  halfWidth: number,
  soleEdge?: GroundEdge
) {
  const { angle, length, footAngle } = pose;
  const ankle = vec2.fromValues(
    center[0] + Math.cos(angle) * length,
    center[1] + Math.sin(angle) * length
  );
  const fx = Math.cos(footAngle),
    fy = Math.sin(footAngle);
  const sole = vec2.fromValues(ankle[0] + height * fx, ankle[1] + height * fy);
  const heel = vec2.fromValues(sole[0] - halfWidth * fy, sole[1] + halfWidth * fx);
  const toe = vec2.fromValues(sole[0] + halfWidth * fy, sole[1] - halfWidth * fx);
  return !edges.some(
    (edge) =>
      segmentCrossesEdge(center, ankle, edge) ||
      (edge !== soleEdge &&
        (segmentCrossesEdge(ankle, heel, edge) ||
          segmentCrossesEdge(ankle, toe, edge) ||
          segmentCrossesEdge(heel, toe, edge)))
  );
}

export function reachable(
  stance: LegStance,
  anchor: FootAnchor,
  restAngle: number,
  swing: number,
  edges: GroundEdge[]
) {
  const pose = plantedPose(stance.center, anchor);
  // Allow for rounding when reconstructing a contact on the boundary of the leg's reach.
  return (
    pose.length <= stance.maxReach + 0.001 &&
    pose.length >= stance.minReach - 0.001 &&
    Math.abs(angleDifference(restAngle, pose.angle)) <= swing + 0.00001 &&
    Math.cos(pose.angle - pose.footAngle) > 0 &&
    poseFits(stance.center, pose, edges, footHeight, anchor.maxHalfWidth, anchor.edge)
  );
}

function* offsetsNear(aim: number, start: number, end: number) {
  let left = Math.max(start, Math.min(end, aim));
  let right = left;
  yield left;
  // If nearby terrain blocks the preferred pose, search out to both ends of the reachable interval.
  while (left > start || right < end) {
    if (left > start) {
      left = Math.max(start, left - 1);
      yield left;
    }
    if (right < end) {
      right = Math.min(end, right + 1);
      yield right;
    }
  }
}

export function findFoothold(
  stance: LegStance,
  restAngle: number,
  swing: number,
  rollRadius: number,
  edges: GroundEdge[]
): FootAnchor | null {
  let best: FootAnchor | null = null;
  let bestScore = Infinity;
  for (const edge of edges) {
    const fromEdge = vec2.subtract(vec2.create(), stance.center, edge.a);
    const height = vec2.dot(fromEdge, edge.normal) - footHeight;
    if (height <= 0 || height > stance.maxReach) continue;

    // Project the leg's angular and length limits onto the line of possible ankles.
    const inward = Math.atan2(-edge.normal[1], -edge.normal[0]);
    const phase = angleDifference(restAngle, inward);
    const arc = Math.acos(height / stance.maxReach);
    const low = Math.max(-arc, phase - swing);
    const high = Math.min(arc, phase + swing);
    if (low > high) continue;
    const along = vec2.dot(fromEdge, edge.tangent);
    const start = Math.max(foldedHalfSole, along + height * Math.tan(low));
    const end = Math.min(edge.length - foldedHalfSole, along + height * Math.tan(high));
    if (start > end) continue;

    // Unroll the spoke onto the face. On a straight run, each unit of travel
    // cancels a unit of arc, so the preferred landing spot stays fixed in the world.
    const preferred = along + rollRadius * phase;
    for (const offset of offsetsNear(preferred, start, end)) {
      const anchor = {
        edge,
        offset,
        maxHalfWidth: Math.min(halfSole, offset, edge.length - offset)
      };
      const pose = plantedPose(stance.center, anchor);
      if (pose.length < stance.minReach) continue;
      const width = largestFit(foldedHalfSole, anchor.maxHalfWidth, (width) =>
        poseFits(stance.center, pose, edges, footHeight, width, edge)
      );
      if (width === null) continue;
      const score =
        Math.abs(angleDifference(restAngle, pose.angle)) * stance.maxReach +
        Math.abs(pose.length - stance.restLength);
      if (score < bestScore) {
        anchor.maxHalfWidth = width;
        best = anchor;
        bestScore = score;
      }
      break;
    }
  }
  return best;
}

// Two pads on one face can each open up to the midpoint between their contacts.
export function padHalfWidth(anchor: FootAnchor, contacts: (FootAnchor | null)[]) {
  let width = anchor.maxHalfWidth;
  for (const other of contacts) {
    if (other && other !== anchor && other.edge === anchor.edge)
      width = Math.min(width, Math.abs(anchor.offset - other.offset) / 2);
  }
  return width;
}

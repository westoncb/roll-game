import { vec2 } from "gl-matrix";
import { edgeIntersectsConvexPolygon, segmentCrossesEdge } from "./collision";
import type { GroundEdge } from "./ground";
import { halfSole, maxLegAngle, playerConfig, rollRadius } from "./player-config";
import { angleDifference } from "./util";

const { foot } = playerConfig;

export type FootAnchor = { edge: GroundEdge; offset: number };
export type Pose = { angle: number; length: number; footAngle: number };
export type LegStance = {
  center: vec2;
  restLength: number;
  minReach: number;
  maxReach: number;
};

function ankleAt(edge: GroundEdge, offset: number) {
  const ankle = vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, offset);
  return vec2.scaleAndAdd(ankle, ankle, edge.normal, foot.height);
}

export function plantedPose(center: vec2, { edge, offset }: FootAnchor): Pose {
  const ankle = ankleAt(edge, offset);
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

function* offsetsNear(aim: number, start: number, end: number) {
  let left = Math.max(start, Math.min(end, aim));
  let right = left;
  yield left;
  // Visit legal offsets in increasing distance from the preferred point, including both endpoints.
  while (left > start || right < end) {
    const nextLeft = Math.max(start, left - 1);
    const nextRight = Math.min(end, right + 1);
    if (right === end || (left > start && aim - nextLeft <= nextRight - aim)) {
      left = nextLeft;
      yield left;
    } else {
      right = nextRight;
      yield right;
    }
  }
}

function contactRange(stance: LegStance, restAngle: number, edge: GroundEdge) {
  const fromEdge = vec2.subtract(vec2.create(), stance.center, edge.a);
  const height = vec2.dot(fromEdge, edge.normal) - foot.height;
  if (height <= 0 || height > stance.maxReach) return null;

  // Project the leg's angular and length limits onto the line of possible ankles.
  const inward = Math.atan2(-edge.normal[1], -edge.normal[0]);
  const phase = angleDifference(restAngle, inward);
  const arc = Math.acos(height / stance.maxReach);
  const low = Math.max(-arc, phase - maxLegAngle);
  const high = Math.min(arc, phase + maxLegAngle);
  if (low > high) return null;
  const along = vec2.dot(fromEdge, edge.tangent);
  const start = Math.max(halfSole, along + height * Math.tan(low));
  const end = Math.min(edge.length - halfSole, along + height * Math.tan(high));
  if (start > end) return null;

  return { start, end, along, phase };
}

// A contact owns the space for a deployed sole throughout its approach and grip.
type Foothold = {
  anchor: FootAnchor;
  gripping: boolean;
  effort: number;
  sole: vec2;
};

function foothold(
  edge: GroundEdge,
  offset: number,
  gripping: boolean,
  effort: number
): Foothold {
  return {
    anchor: { edge, offset },
    gripping,
    effort,
    sole: vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, offset)
  };
}

function slideIsClear(
  stance: LegStance,
  edge: GroundEdge,
  from: number,
  to: number,
  edges: GroundEdge[]
) {
  const low = Math.min(from, to),
    high = Math.max(from, to);
  const left = ankleAt(edge, low),
    right = ankleAt(edge, high);
  const heel = vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, low - halfSole);
  const toe = vec2.scaleAndAdd(vec2.create(), edge.a, edge.tangent, high + halfSole);
  const legSweep = [stance.center, right, left],
    padSweep = [left, right, toe, heel];
  return !edges.some(
    (other) =>
      other !== edge &&
      (edgeIntersectsConvexPolygon(other, legSweep) ||
        edgeIntersectsConvexPolygon(other, padSweep))
  );
}

type LegFrame = { stance: LegStance; angle: number };
type Grip = { anchor: FootAnchor; plantedOffset: number; travel: number };

// Holding, sliding and landing all use the same reach and full-sole terrain checks.
// A landing must fit both at touchdown and a short time into the following stride.
function* optionsOnEdge(
  edge: GroundEdge,
  edges: GroundEdge[],
  landing: LegFrame,
  hold: LegFrame,
  grip?: Grip,
  previous?: FootAnchor
): Generator<Foothold> {
  const range = contactRange(landing.stance, landing.angle, edge);
  const future = landing === hold ? range : contactRange(hold.stance, hold.angle, edge);
  if (!range || !future) return;
  let start = Math.max(range.start, future.start),
    end = Math.min(range.end, future.end);
  // Unrolling a spoke onto the walking surface gives it a world-stationary aim.
  let aim = range.along + rollRadius * range.phase;
  if (grip) {
    const { offset } = grip.anchor;
    start = Math.max(start, offset - grip.travel, grip.plantedOffset - halfSole);
    end = Math.min(end, offset + grip.travel, grip.plantedOffset + halfSole);
    aim = offset;
  } else if (previous?.edge === edge) {
    aim = previous.offset;
  }
  if (start > end) return;
  const ideal = Math.max(start, Math.min(end, aim));
  const pose = plantedPose(landing.stance.center, { edge, offset: ideal });
  const effort = grip
    ? 0
    : Math.abs(angleDifference(landing.angle, pose.angle)) * rollRadius +
      Math.abs(pose.length - landing.stance.restLength);
  for (const offset of offsetsNear(ideal, start, end)) {
    const anchor = { edge, offset };
    if (
      !fitsStance(landing.stance, anchor, edges) ||
      (hold !== landing && !fitsStance(hold.stance, anchor, edges))
    )
      continue;
    if (
      grip &&
      offset !== grip.anchor.offset &&
      !slideIsClear(landing.stance, edge, grip.anchor.offset, offset, edges)
    )
      continue;
    yield foothold(edge, offset, !!grip, effort + Math.abs(offset - aim));
  }
}

function fitsStance(stance: LegStance, anchor: FootAnchor, edges: GroundEdge[]) {
  const pose = plantedPose(stance.center, anchor);
  return (
    pose.length >= stance.minReach - 0.001 &&
    poseFits(stance.center, pose, edges, foot.height, halfSole, anchor.edge)
  );
}

type LegRequest = {
  current: LegFrame;
  landing: LegFrame;
  hold: LegFrame;
  previous?: FootAnchor;
  grip?: Grip;
};

function preference(a: Foothold, b: Foothold) {
  return Number(b.gripping) - Number(a.gripping) || a.effort - b.effort;
}

function overlap(a: Foothold, b: Foothold) {
  return vec2.squaredDistance(a.sole, b.sole) < foot.width ** 2;
}

function conflict(picks: (Foothold | null)[]) {
  for (const [i, pick] of picks.entries()) {
    if (!pick) continue;
    for (let j = 0; j < i; j++) {
      const other = picks[j];
      if (other && overlap(pick, other)) return [i, j];
    }
  }
  return null;
}

// Choose the most contacts, then keep the most existing grips, then minimize travel.
export function planFootholds(edges: GroundEdge[], requests: LegRequest[]) {
  const searches = requests.map(({ current, landing, hold, previous, grip }) => {
    const faces = edges.map((edge) =>
      optionsOnEdge(edge, edges, landing, hold, undefined, previous)
    );
    if (grip) faces.push(optionsOnEdge(grip.anchor.edge, edges, current, current, grip));
    return faces;
  });
  // Usually the preferred grips fit together. Explore alternate offsets only when feet compete.
  const first = searches.map((faces) =>
    faces
      .flatMap((face) => {
        const next = face.next();
        return next.done ? [] : [next.value];
      })
      .sort(preference)
  );
  const preferred = first.map((list) => list[0] ?? null);
  if (!conflict(preferred)) return preferred;
  const options = searches.map((faces, i) =>
    first[i].concat(faces.flatMap((face) => [...face])).sort(preference)
  );
  let best: (Foothold | null)[] = requests.map(() => null);
  let bestCount = 0,
    bestGrips = 0,
    bestEffort = Infinity;
  function choose(available: Foothold[][]) {
    const picks = available.map((list) => list[0] ?? null);
    let count = 0,
      grips = 0,
      effort = 0;
    for (const pick of picks) {
      if (!pick) continue;
      count++;
      if (pick.gripping) grips++;
      effort += pick.effort;
    }
    // The first options give an optimistic bound even when some of them overlap.
    if (
      count < bestCount ||
      (count === bestCount &&
        (grips < bestGrips || (grips === bestGrips && effort >= bestEffort)))
    )
      return;
    const pair = conflict(picks);
    if (pair) {
      const [a, b] = pair;
      const leg = available[a].length <= available[b].length ? a : b;
      for (const candidate of available[leg]) {
        choose(
          available.map((list, i) =>
            i === leg ? [candidate] : list.filter((option) => !overlap(option, candidate))
          )
        );
      }
      choose(available.map((list, i) => (i === leg ? [] : list)));
      return;
    }
    best = picks;
    bestCount = count;
    bestGrips = grips;
    bestEffort = effort;
  }
  choose(options);
  return best;
}

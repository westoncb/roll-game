import { vec2 } from "gl-matrix";
import { edgeIntersectsConvexPolygon, segmentCrossesEdge } from "./collision";
import type { GroundEdge } from "./ground";
import {
  halfSole,
  maxLegAngle,
  maxLegReach,
  minLegReach,
  playerConfig,
  rollRadius
} from "./player-config";
import { angleDifference, largestFit } from "./util";

const { foot } = playerConfig;

export type FootAnchor = { edge: GroundEdge; offset: number };
export type Pose = { angle: number; length: number; footAngle: number };
export type LegStance = {
  center: vec2;
  restLength: number;
  landingReach: number;
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

function contactRange(
  { stance, angle }: LegFrame,
  edge: GroundEdge,
  reach = stance.landingReach
) {
  const fromEdge = vec2.subtract(vec2.create(), stance.center, edge.a);
  const height = vec2.dot(fromEdge, edge.normal) - foot.height;
  if (height <= 0 || height > reach) return null;

  // Project the leg's angular and length limits onto the line of possible ankles.
  const inward = Math.atan2(-edge.normal[1], -edge.normal[0]);
  const phase = angleDifference(angle, inward);
  const arc = Math.acos(height / reach);
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
export type GripRequest = { angle: number; grip?: Grip };

// A new landing must fit both at touchdown and a short time into the following stride.
function* optionsOnEdge(
  edge: GroundEdge,
  edges: GroundEdge[],
  landing: LegFrame,
  hold: LegFrame,
  grip?: Grip,
  previous?: FootAnchor
): Generator<Foothold> {
  // Crouching shortens the reach for a new step. A planted leg can still use its full travel.
  const range = contactRange(
    landing,
    edge,
    grip ? maxLegReach : landing.stance.landingReach
  );
  const future = landing === hold ? range : contactRange(hold, edge);
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
    pose.length >= minLegReach - 0.001 &&
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

function planGrips(edges: GroundEdge[], stance: LegStance, legs: GripRequest[]) {
  return chooseFootholds(
    legs.map(({ angle, grip }) => {
      const frame = { stance, angle };
      return grip ? [optionsOnEdge(grip.anchor.edge, edges, frame, frame, grip)] : [];
    })
  );
}

export function fitCrouchGrips(
  edges: GroundEdge[],
  legs: GripRequest[],
  stanceAt: (fraction: number) => LegStance
) {
  const target = planGrips(edges, stanceAt(1), legs);
  if (legs.every((leg, i) => !leg.grip || target[i])) return { fraction: 1, held: target };

  // Movement alone may require a step. Protect each grip that survived it, including
  // those that need to slide. Each trial shares the same per-tick slide budget.
  const before = planGrips(edges, stanceAt(0), legs);
  const retainsGrips = (plan: (Foothold | null)[]) =>
    before.every((foot, i) => !foot || plan[i]);
  if (retainsGrips(target)) return { fraction: 1, held: target };
  const required = legs.map((leg, i) => (before[i] ? leg : { angle: leg.angle }));
  const planAt = (t: number) => planGrips(edges, stanceAt(t), required);
  const fraction = largestFit(0, 1, (t) => t === 0 || retainsGrips(planAt(t))) ?? 0;
  return { fraction, held: fraction === 0 ? before : planAt(fraction) };
}

function* unoccupied(options: Generator<Foothold>, reserved: Foothold[]) {
  for (const option of options)
    if (!reserved.some((foot) => overlap(foot, option))) yield option;
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

export function planFootholds(
  edges: GroundEdge[],
  requests: LegRequest[],
  held: (Foothold | null)[] = []
) {
  const reserved = held.filter((foot) => foot !== null);
  const searches = requests.map(({ current, landing, hold, previous, grip }, i) => {
    if (held[i]) return [];
    const faces = edges.map((edge) =>
      optionsOnEdge(edge, edges, landing, hold, undefined, previous)
    );
    if (grip) faces.push(optionsOnEdge(grip.anchor.edge, edges, current, current, grip));
    return reserved.length ? faces.map((face) => unoccupied(face, reserved)) : faces;
  });
  return chooseFootholds(searches).map((foot, i) => held[i] ?? foot);
}

// Choose the most contacts, then keep the most existing grips, then minimize travel.
function chooseFootholds(searches: Generator<Foothold>[][]) {
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
  let best: (Foothold | null)[] = searches.map(() => null);
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

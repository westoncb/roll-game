import { vec2 } from "gl-matrix";
import { nearbyEdges, segmentCrossesEdge } from "./collision";
import type { Entity } from "./entity";
import type { GroundEdge, GroundPolygon } from "./ground";
import type { InputState } from "./input";
import { collectContacts, gravityAt, stepPhysics, type PhysicsBody } from "./physics";
import {
  advanceAlongSurface,
  supportFromContact,
  surfacePose,
  type Support
} from "./walking";
import { angleDifference, approach, approachAngle, tau } from "./util";

const legCount = 10;
const spacing = tau / legCount;
const restLength = 23;
const maxReach = 43;
const footHeight = 4;
const halfSole = 3;
const walkSpeed = 98;
const jumpSpeed = 205;

type FootAnchor = { edge: GroundEdge; t: number };
type FootState = { kind: "free" } | { kind: "reaching" | "planted"; anchor: FootAnchor };
// Angles are in world coordinates. The leg index identifies its part of the rotating body.
type Pose = { angle: number; length: number; footAngle: number };
type Leg = Pose & { foot: FootState };

function ankleAt({ edge, t }: FootAnchor) {
  const ankle = vec2.lerp(vec2.create(), edge.a, edge.b, t);
  return vec2.scaleAndAdd(ankle, ankle, edge.normal, footHeight);
}

function plantedPose(center: vec2, anchor: FootAnchor): Pose {
  const delta = vec2.subtract(vec2.create(), ankleAt(anchor), center);
  const normal = anchor.edge.normal;
  return {
    angle: Math.atan2(delta[1], delta[0]),
    length: vec2.length(delta),
    footAngle: Math.atan2(-normal[1], -normal[0])
  };
}

// Check the leg and the whole footprint, including narrow tips of terrain
// that can poke between the two ends of the sole.
function poseFits(center: vec2, pose: Pose, edges: GroundEdge[], soleEdge?: GroundEdge) {
  const { angle, length, footAngle } = pose;
  const ankle = vec2.fromValues(
    center[0] + Math.cos(angle) * length,
    center[1] + Math.sin(angle) * length
  );
  const fx = Math.cos(footAngle),
    fy = Math.sin(footAngle);
  const sole = vec2.fromValues(ankle[0] + footHeight * fx, ankle[1] + footHeight * fy);
  const heel = vec2.fromValues(sole[0] - halfSole * fy, sole[1] + halfSole * fx);
  const toe = vec2.fromValues(sole[0] + halfSole * fy, sole[1] - halfSole * fx);
  return !edges.some(
    (edge) =>
      segmentCrossesEdge(center, ankle, edge) ||
      (edge !== soleEdge &&
        (segmentCrossesEdge(ankle, heel, edge) ||
          segmentCrossesEdge(ankle, toe, edge) ||
          segmentCrossesEdge(heel, toe, edge)))
  );
}

// While the ankle is rotating toward its target, retract as far as necessary
// to keep the visible foot on the accessible side of the terrain.
function clearSwing(center: vec2, leg: Leg, edges: GroundEdge[]) {
  if (poseFits(center, leg, edges)) return;
  let low = 0;
  let high = leg.length;
  for (let i = 0; i < 10; i++) {
    const length = (low + high) / 2;
    if (poseFits(center, { ...leg, length }, edges)) low = length;
    else high = length;
  }
  leg.length = low;
}

function reachable(
  center: vec2,
  anchor: FootAnchor,
  restAngle: number,
  nearby: GroundEdge[]
) {
  const pose = plantedPose(center, anchor);
  if (
    pose.length > maxReach ||
    pose.length < 14 ||
    Math.abs(angleDifference(restAngle, pose.angle)) >= spacing * 0.49
  )
    return false;
  const ankle = ankleAt(anchor);
  const toBody = vec2.subtract(vec2.create(), center, ankle);
  if (vec2.dot(toBody, anchor.edge.normal) <= 0) return false;
  return poseFits(center, pose, nearby, anchor.edge);
}

// Split the unwrapped clockwise span between successive planted legs into equal gaps.
function targetAngles(legs: Leg[], bodyAngle: number) {
  const angles = legs.map((_, i) => bodyAngle + i * spacing);
  const pins: number[] = [];
  for (const [i, leg] of legs.entries()) {
    if (leg.foot.kind === "planted") {
      angles[i] += angleDifference(angles[i], leg.angle);
      pins.push(i);
    }
  }
  for (let p = 0; p < pins.length; p++) {
    const first = pins[p],
      last = pins[(p + 1) % pins.length];
    const count = (last - first + legCount) % legCount || legCount;
    const span = angles[last] + (last <= first ? tau : 0) - angles[first];
    for (let j = 1; j < count; j++)
      angles[(first + j) % legCount] = angles[first] + (span * j) / count;
  }
  return angles;
}

export class Player implements Entity {
  readonly body: PhysicsBody;
  angle = 0;
  readonly legs: Leg[] = Array.from({ length: legCount }, (_, i) => ({
    angle: i * spacing,
    length: restLength,
    footAngle: i * spacing,
    foot: { kind: "free" }
  }));
  support: Support | null = null;
  private direction = 0;
  private jump = false;

  constructor(start: vec2, ground: GroundPolygon[]) {
    this.body = {
      pos: vec2.clone(start),
      vel: vec2.create(),
      accel: vec2.create(),
      radius: 28,
      contacts: []
    };
    collectContacts(this.body, ground);
    this.land(ground);
  }

  control(input: InputState) {
    this.direction =
      Number(input.keysDown.has("ArrowRight")) - Number(input.keysDown.has("ArrowLeft"));
    this.jump = input.keysPressed.has("Space");
  }

  move(ground: GroundPolygon[], dt: number) {
    const body = this.body;
    if (this.support) {
      const speed = this.direction * walkSpeed;
      if (!this.jump) {
        const { support, travel } = advanceAlongSurface(
          this.support,
          speed * dt,
          body.radius,
          ground
        );
        this.support = support;
        const { pos, normal } = surfacePose(support, body.radius);
        vec2.copy(body.pos, pos);
        vec2.set(body.vel, (-normal[1] * travel) / dt, (normal[0] * travel) / dt);
        vec2.zero(body.accel);
        this.angle += travel / body.radius;
        collectContacts(body, ground);
        return;
      }
      const { normal } = surfacePose(this.support, body.radius);
      vec2.set(body.vel, -normal[1] * speed, normal[0] * speed);
      vec2.scaleAndAdd(body.vel, body.vel, normal, jumpSpeed);
      this.support = null;
    }
    vec2.copy(body.accel, gravityAt(body, ground));
    stepPhysics(body, ground, dt);
    this.land(ground);
  }

  private land(ground: GroundPolygon[]) {
    // Re-query after each correction: one concave polygon can supply multiple faces.
    for (let i = 0; i < 6; i++) {
      const contacts = this.body.contacts;
      if (!contacts.length) return;
      const hit = contacts.reduce((deepest, contact) =>
        contact.depth > deepest.depth ? contact : deepest
      );
      if (vec2.dot(this.body.vel, hit.normal) <= 0)
        this.support = supportFromContact(hit, this.body.radius);
      if (hit.depth < 0.0001) return;
      vec2.scaleAndAdd(this.body.pos, this.body.pos, hit.normal, hit.depth);
      const inward = Math.min(0, vec2.dot(this.body.vel, hit.normal));
      vec2.scaleAndAdd(this.body.vel, this.body.vel, hit.normal, -inward);
      collectContacts(this.body, ground);
    }
  }

  afterPhysics(dt: number, ground: GroundPolygon[]) {
    this.updateFeet(dt, ground);
  }

  private findFoothold(
    aim: number,
    restAngle: number,
    edges: GroundEdge[]
  ): FootAnchor | null {
    const dir = vec2.fromValues(Math.cos(aim), Math.sin(aim));
    let best: FootAnchor | null = null;
    let bestScore = Infinity;
    for (const edge of edges) {
      if (edge.length <= 2 * halfSole) continue;
      const toward = -vec2.dot(dir, edge.normal);
      if (toward <= 0) continue;
      const fromEdge = vec2.subtract(vec2.create(), this.body.pos, edge.a);
      const reach = (vec2.dot(fromEdge, edge.normal) - footHeight) / toward;
      if (reach <= 0) continue;
      const along = vec2.dot(fromEdge, edge.tangent) + reach * vec2.dot(dir, edge.tangent);
      const anchor = {
        edge,
        t: Math.max(halfSole, Math.min(edge.length - halfSole, along)) / edge.length
      };
      if (!reachable(this.body.pos, anchor, restAngle, edges)) continue;
      // Reserve sole space for both planted and approaching feet.
      if (
        this.legs.some(
          ({ foot }) =>
            foot.kind !== "free" &&
            foot.anchor.edge === edge &&
            Math.abs(foot.anchor.t - anchor.t) * edge.length < 2 * halfSole
        )
      )
        continue;
      const pose = plantedPose(this.body.pos, anchor);
      // Leave margin on acquisition so a moving leg can finish its step.
      if (
        pose.length > maxReach - 2 ||
        Math.abs(angleDifference(restAngle, pose.angle)) > spacing * 0.42
      )
        continue;
      const score =
        Math.abs(angleDifference(aim, pose.angle)) * maxReach +
        Math.abs(pose.length - restLength);
      if (score < bestScore) {
        bestScore = score;
        best = anchor;
      }
    }
    return best;
  }

  private updateFeet(dt: number, ground: GroundPolygon[]) {
    const edges = nearbyEdges(this.body.pos, maxReach + footHeight + halfSole, ground);
    for (const [i, leg] of this.legs.entries()) {
      if (leg.foot.kind === "free") continue;
      if (
        !this.support ||
        !reachable(this.body.pos, leg.foot.anchor, this.angle + i * spacing, edges)
      ) {
        leg.foot = { kind: "free" };
      } else if (leg.foot.kind === "planted") {
        Object.assign(leg, plantedPose(this.body.pos, leg.foot.anchor));
      }
    }
    const targets = targetAngles(this.legs, this.angle);
    for (const [i, leg] of this.legs.entries()) {
      if (leg.foot.kind === "planted") continue;
      if (leg.foot.kind === "free" && this.support) {
        const anchor = this.findFoothold(targets[i], this.angle + i * spacing, edges);
        if (anchor) leg.foot = { kind: "reaching", anchor };
      }
      const target =
        leg.foot.kind === "reaching"
          ? plantedPose(this.body.pos, leg.foot.anchor)
          : { angle: targets[i], length: restLength, footAngle: targets[i] };
      leg.angle = approachAngle(leg.angle, target.angle, 14 * dt);
      leg.length = approach(leg.length, target.length, 175 * dt);
      leg.footAngle = approachAngle(leg.footAngle, target.footAngle, 15 * dt);
      if (
        leg.foot.kind === "reaching" &&
        Math.abs(angleDifference(leg.angle, target.angle)) < 0.0001 &&
        Math.abs(leg.length - target.length) < 0.0001 &&
        Math.abs(angleDifference(leg.footAngle, target.footAngle)) < 0.0001
      ) {
        leg.foot = { kind: "planted", anchor: leg.foot.anchor };
      } else {
        clearSwing(this.body.pos, leg, edges);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.body.pos[0], this.body.pos[1]);
    ctx.strokeStyle = "#e9c680";
    ctx.fillStyle = "#e9c680";
    for (const leg of this.legs) {
      const x = Math.cos(leg.angle) * leg.length;
      const y = Math.sin(leg.angle) * leg.length;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(leg.footAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(footHeight, -halfSole);
      ctx.lineTo(footHeight, halfSole);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.roundRect(-13, -10, 26, 20, 5);
    ctx.fill();
    ctx.restore();
  }
}

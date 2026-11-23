import { vec2 } from "gl-matrix";
import { castSegment, sweepCircle } from "../engine/collision";
import type { GroundPolygon } from "../engine/ground";
import type { InputState } from "../engine/input";
import { gravityY } from "../engine/physics";
import type { FungalColony } from "../fungus/colony";
import { approach, tau } from "../utils/math";
import { playerConfig } from "./config";
import {
  extensionTimeAt,
  punchImpact,
  tipVelocity,
  type PunchImpact
} from "./grapple-motion";
import type { CastBeam } from "./gun";
import type { Player } from "./player";
import {
  advanceAlongSurface,
  supportFromContact,
  surfaceNormal,
  surfacePose,
  type Support
} from "./walking";

const { gun } = playerConfig;
const decisionSeconds = 0.18;

type Aim = { point: vec2; kind: "punch" | "gem" | "terrain"; remaining: number };

// The pilot only issues held keys and pointer positions. The shared player controller
// handles charge, aim, shot travel, surface grip and braking for both competitors.
export class RivalController {
  private previousKeys = new Set<string>();
  private aim: Aim | null = null;
  private walk: vec2 | null = null;
  private jumpTime = 0;
  private cooldown = 0.65;
  private nextDecision = 0;

  constructor(
    private readonly self: Player,
    private readonly opponent: Player,
    private readonly ground: GroundPolygon[],
    private readonly colonies: FungalColony[],
    private readonly cast: CastBeam
  ) {}

  onRespawn() {
    this.previousKeys.clear();
    this.aim = this.walk = null;
    this.jumpTime = this.nextDecision = 0;
    this.cooldown = 0.35;
  }

  control(dt: number) {
    this.nextDecision -= dt;
    this.cooldown -= dt;
    if (this.nextDecision <= 0 && !this.aim && this.jumpTime <= 0) {
      this.decide();
      this.nextDecision = decisionSeconds;
    }

    const aim = this.aim;
    if (aim?.kind === "punch") aim.point = this.intercept();
    if (aim) aim.remaining -= dt;
    this.jumpTime -= dt;
    const keys = new Set<string>();
    if (aim && aim.remaining > 0) keys.add("KeyF");
    if (this.jumpTime > 0) keys.add("Space");
    if (this.walk && !aim) {
      const [dx, dy] = vec2.subtract(vec2.create(), this.walk, this.self.body.pos);
      if (Math.abs(dx) > 12) keys.add(dx > 0 ? "KeyD" : "KeyA");
      if (Math.abs(dy) > 12) keys.add(dy > 0 ? "KeyS" : "KeyW");
    }
    const point = aim?.point ?? null;
    const input: InputState = { keysDown: keys, mousePos: point, changes: [] };
    for (const code of ["KeyF", "Space"]) {
      if (keys.has(code) !== this.previousKeys.has(code))
        input.changes.push({
          code,
          type: keys.has(code) ? "press" : "release",
          mousePos: point
        });
    }
    this.previousKeys = keys;
    this.self.control(input, dt, "mouse");
    if (aim && aim.remaining <= 0) {
      this.aim = null;
      this.cooldown = 0.45;
    }
  }

  private sight(target: vec2) {
    const from = this.self.body.pos;
    const direction = vec2.subtract(vec2.create(), target, from);
    const range = vec2.length(direction);
    return this.cast(
      from,
      vec2.normalize(direction, direction),
      Math.min(range + 1, gun.maxReach)
    );
  }

  private intercept() {
    const { pos, vel } = this.opponent.body;
    const flight = extensionTimeAt(vec2.distance(this.self.body.pos, pos));
    // Lead within the robot's silhouette so the sight still selects the glove.
    const lead = Math.min(
      flight,
      (this.opponent.body.radius * 0.7) / Math.max(1, vec2.length(vel))
    );
    return vec2.scaleAndAdd(vec2.create(), pos, vel, lead);
  }

  private hazard(from: vec2, to: vec2, radius: number) {
    return this.colonies.some((c) => c.playerContact(from, to, radius));
  }

  private punchTowardFungus(impact: PunchImpact) {
    const { pos, radius, vel } = this.opponent.body;
    const velocity = vec2.scaleAndAdd(vec2.create(), vel, impact.normal, impact.impulse);
    const at = vec2.clone(pos),
      end = vec2.create(),
      step = vec2.create();
    const dt = 1 / 30;
    let support: Support | null = null,
      speed = 0;
    for (let i = 0; i < 24; i++) {
      if (support) {
        speed = approach(speed, 0, playerConfig.movement.coastDeceleration * dt);
        if (!speed) break;
        const next = advanceAlongSurface(support, speed, dt, radius, this.ground);
        support = next.support;
        vec2.copy(end, surfacePose(support, radius).pos);
        speed *= next.retainedSpeed;
      } else {
        velocity[1] += gravityY * dt;
        vec2.scale(step, velocity, dt);
        const hit = sweepCircle(at, radius, step, this.ground);
        vec2.scaleAndAdd(end, at, step, hit?.fraction ?? 1);
        if (hit) {
          support = supportFromContact(hit, radius);
          speed = -hit.normal[1] * velocity[0] + hit.normal[0] * velocity[1];
        }
      }
      if (this.hazard(at, end, radius)) return true;
      vec2.copy(at, end);
    }
    return false;
  }

  private decide() {
    const { pos, vel, radius } = this.self.body;
    const gems = this.colonies.flatMap((colony) => Array.from(colony.gems.values()));
    this.walk = null;
    if (this.self.inFungus && this.self.gun.ready && this.cooldown <= 0) {
      this.reposition(pos, true);
      if (!this.aim && this.self.support) this.jumpTime = 0.22;
      return;
    }
    const ahead = vec2.scaleAndAdd(vec2.create(), pos, vel, 0.36);
    if (
      this.self.support &&
      (this.opponent.gun.threatens(this.self) || this.hazard(pos, ahead, radius + 12))
    ) {
      const normal = surfaceNormal(this.self.support, radius);
      const escape = vec2.scaleAndAdd(vec2.create(), pos, normal, 145);
      const travel = vec2.subtract(vec2.create(), escape, pos);
      if (
        !sweepCircle(pos, radius, travel, this.ground) &&
        !this.hazard(pos, escape, radius)
      ) {
        this.jumpTime = 0.21;
        return;
      }
    }
    if (!this.self.gun.ready || this.cooldown > 0) return;
    const aim = this.intercept();
    const distance = vec2.distance(pos, aim);
    const hit = this.sight(aim);
    if (hit.kind === "robot") {
      const direction = vec2.subtract(vec2.create(), aim, pos);
      const velocity = tipVelocity(
        vec2.normalize(direction, direction),
        vec2.distance(pos, hit.point),
        vel
      );
      const impact = punchImpact(velocity, hit.normal, hit.target.body.vel);
      if (
        impact.damage > 0 &&
        (distance < 230 ||
          this.opponent.health <= impact.damage ||
          this.punchTowardFungus(impact))
      ) {
        this.aim = { kind: "punch", point: aim, remaining: 0.35 };
        return;
      }
    }
    gems.sort(
      (a, b) =>
        vec2.squaredDistance(pos, a.visual.position) -
        vec2.squaredDistance(pos, b.visual.position)
    );
    for (const gem of gems) {
      if (vec2.distance(pos, gem.visual.position) > gun.maxReach + gem.radius) continue;
      const hit = this.sight(gem.visual.position);
      if (hit.kind === "gem") {
        this.aim = {
          kind: "gem",
          point: vec2.clone(hit.gem.visual.position),
          remaining: 0.38
        };
        return;
      }
    }
    this.reposition(gems[0]?.visual.position ?? this.opponent.body.pos);
  }

  // Probe reachable surfaces for a firing position. Favor cover-free sight of
  // the objective, then shorter travel, and reject paths that cross living tissue.
  private reposition(goal: vec2, escapingFungus = false) {
    const { pos, radius } = this.self.body;
    let best: { score: number; point: vec2; walk: boolean } | null = null;
    for (let i = 0; i < 24; i++) {
      const angle = (tau * i) / 24;
      const direction = vec2.fromValues(Math.cos(angle), Math.sin(angle));
      const hit = this.cast(pos, direction, gun.maxReach);
      if (hit.kind !== "clingable") continue;
      const landing = vec2.scaleAndAdd(vec2.create(), hit.point, hit.normal, radius);
      const travel = vec2.subtract(vec2.create(), landing, pos);
      const distance = vec2.length(travel);
      if (distance < 55) continue;
      const obstruction = sweepCircle(pos, radius - 1, travel, this.ground);
      if (obstruction || this.hazard(escapingFungus ? landing : pos, landing, radius + 4))
        continue;
      const blocked = castSegment(landing, goal, this.ground);
      const score = vec2.distance(landing, goal) + 0.35 * distance + (blocked ? 380 : 0);
      if (!best || score < best.score) {
        const walk =
          !escapingFungus &&
          this.self.support?.edge === hit.ground.edges[hit.edgeIndex] &&
          distance < 230;
        best = { score, point: walk ? landing : hit.point, walk };
      }
    }
    if (best?.walk) this.walk = best.point;
    else if (best) this.aim = { kind: "terrain", point: best.point, remaining: 0.24 };
    else if (this.self.support) {
      const normal = surfaceNormal(this.self.support, radius);
      const tangent = vec2.fromValues(-normal[1], normal[0]);
      const sign = Math.sign(vec2.dot(tangent, vec2.subtract(vec2.create(), goal, pos)));
      const next = vec2.scaleAndAdd(vec2.create(), pos, tangent, sign * 75);
      if (!this.hazard(pos, next, radius + 3)) this.walk = next;
    }
  }
}

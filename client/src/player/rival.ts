import { vec2 } from "gl-matrix";
import { castSegment, sweepCircle } from "../engine/collision";
import type { GroundPolygon } from "../engine/ground";
import type { InputState } from "../engine/input";
import { sampleGravity } from "../engine/physics";
import type { FungalColony } from "../fungus/colony";
import { closestPointOnSegment, tau } from "../utils/math";
import { playerConfig } from "./config";
import type { CastBeam } from "./gun";
import type { Player } from "./player";
import { surfaceNormal } from "./walking";

const { gun } = playerConfig;
const decisionSeconds = 0.18;

type Aim = { point: vec2; kind: "hook" | "throw" | "gem" | "terrain"; remaining: number };

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
    if (aim?.kind === "hook") aim.point = this.intercept();
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
    return this.cast(from, vec2.normalize(direction, direction), range + 1);
  }

  private intercept() {
    const { pos, vel } = this.opponent.body;
    const flight = vec2.distance(this.self.body.pos, pos) / gun.extensionSpeed;
    return vec2.scaleAndAdd(vec2.create(), pos, vel, Math.min(flight, 0.45));
  }

  private hazard(from: vec2, to: vec2, radius: number) {
    return this.colonies.some((c) => c.playerContact(from, to, radius));
  }

  // Try direct and lofted throws toward nearby gems and strands. Sweep the opponent's
  // whole collider until it reaches tissue, hits solid ground, or leaves throw range.
  private throwTarget(gems: vec2[]) {
    const { pos, radius } = this.opponent.body;
    const candidates = gems.filter((p) => vec2.distance(pos, p) < 610);
    for (const colony of this.colonies) {
      if (!colony.gems.size) continue;
      let range = 230;
      const tissue = vec2.create(),
        point = vec2.create();
      for (const fiber of colony.fabric.nearby(pos, pos, range, true)) {
        closestPointOnSegment(point, pos, fiber.a, fiber.b);
        const distance = vec2.distance(pos, point);
        if (distance < range) {
          range = distance;
          vec2.copy(tissue, point);
        }
      }
      if (range < 230 && candidates.every((p) => vec2.distance(p, tissue) > radius / 2))
        candidates.push(tissue);
    }
    const nearest = candidates
      .sort((a, b) => vec2.squaredDistance(pos, a) - vec2.squaredDistance(pos, b))
      .slice(0, 3);
    for (const target of nearest) {
      const heading = Math.atan2(target[1] - pos[1], target[0] - pos[0]);
      for (const offset of [0, -0.25, 0.25, -0.55, 0.55]) {
        const angle = heading + offset;
        const direction = vec2.fromValues(Math.cos(angle), Math.sin(angle));
        const velocity = vec2.scale(vec2.create(), direction, gun.throwSpeed);
        const at = vec2.clone(pos),
          acceleration = vec2.create(),
          step = vec2.create(),
          end = vec2.create();
        const dt = 1 / 24;
        for (let i = 0; i < 18; i++) {
          sampleGravity(acceleration, at, radius, this.ground);
          vec2.scaleAndAdd(velocity, velocity, acceleration, dt);
          vec2.scale(step, velocity, dt);
          const impact = sweepCircle(at, radius, step, this.ground);
          vec2.scaleAndAdd(end, at, step, impact?.fraction ?? 1);
          if (this.hazard(at, end, radius))
            return vec2.scaleAndAdd(
              vec2.create(),
              pos,
              direction,
              vec2.distance(pos, target)
            );
          if (impact) break;
          vec2.copy(at, end);
        }
      }
    }
    return null;
  }

  private decide() {
    const { pos, vel, radius } = this.self.body;
    const gems = this.colonies.flatMap((c) =>
      Array.from(c.gems.values(), (gem) => gem.visual.position)
    );
    this.walk = null;
    if (this.self.gun.tethered) {
      const target = this.throwTarget(gems);
      if (target) this.aim = { kind: "throw", point: target, remaining: 0.38 };
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
    const enemyDistance = vec2.distance(pos, this.opponent.body.pos);
    if (
      enemyDistance < 660 &&
      this.sight(this.opponent.body.pos).kind === "robot" &&
      this.throwTarget(gems)
    ) {
      this.aim = { kind: "hook", point: this.intercept(), remaining: 0.35 };
      return;
    }
    gems.sort((a, b) => vec2.squaredDistance(pos, a) - vec2.squaredDistance(pos, b));
    for (const gem of gems) {
      if (vec2.distance(pos, gem) > 590) break;
      const hit = this.sight(gem);
      if (hit.kind === "gem") {
        this.aim = {
          kind: "gem",
          point: vec2.clone(hit.gem.visual.position),
          remaining: 0.38
        };
        return;
      }
    }
    this.reposition(gems[0] ?? this.opponent.body.pos);
  }

  // Probe reachable surfaces for a firing position. Favor cover-free sight of
  // the objective, then shorter travel, and reject paths that cross living tissue.
  private reposition(goal: vec2) {
    const { pos, radius } = this.self.body;
    let best: { score: number; point: vec2; walk: boolean } | null = null;
    for (let i = 0; i < 24; i++) {
      const angle = (tau * i) / 24;
      const direction = vec2.fromValues(Math.cos(angle), Math.sin(angle));
      const hit = this.cast(pos, direction);
      if (hit.kind !== "clingable") continue;
      const landing = vec2.scaleAndAdd(vec2.create(), hit.point, hit.normal, radius);
      const travel = vec2.subtract(vec2.create(), landing, pos);
      const distance = vec2.length(travel);
      if (distance < 55) continue;
      const obstruction = sweepCircle(pos, radius - 1, travel, this.ground);
      if (obstruction || this.hazard(pos, landing, radius + 4)) continue;
      const blocked = castSegment(landing, goal, this.ground);
      const score = vec2.distance(landing, goal) + 0.35 * distance + (blocked ? 380 : 0);
      if (!best || score < best.score) {
        const walk =
          this.self.support?.edge === hit.ground.edges[hit.edgeIndex] && distance < 230;
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

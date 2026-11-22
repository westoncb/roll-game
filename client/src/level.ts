import { vec2 } from "gl-matrix";
import { gameAssets } from "./assets";
import { castCapsule, castSegment } from "./engine/collision";
import { Drawable2D } from "./engine/drawable";
import type { Entity } from "./engine/entity";
import { FlowBackground } from "./flow-background";
import { GroundPolygon } from "./engine/ground";
import type { InputState } from "./engine/input";
import { lerp, tau } from "./utils/math";
import { ParticleSystem } from "./engine/particles/system";
import { stepPhysics } from "./engine/physics";
import { Player, type PlayerEvents } from "./player/player";
import type { BeamHit, CastBeam } from "./player/gun";
import { respawnGraceSeconds, rivalColors } from "./player/config";
import { RivalController } from "./player/rival";
import { FungalColony } from "./fungus/colony";
import type { ColonyData } from "./fungus/config";
import { GrowthDomain } from "./fungus/domain";
import { PointsPopup } from "./points-popup";

export type Point = [number, number];
export type GroundData = { vertices: Point[]; style?: string };
export type LevelData = {
  width: number;
  height: number;
  playerStart: Point;
  rivalStart?: Point;
  ground: GroundData[];
  fungalColonies?: ColonyData[];
};

export type RoundResult = "player-contact" | "cleared";
const respawnDelaySeconds = 2;

function inPlay(entity: Entity) {
  return !(entity instanceof Player && entity.respawnRemaining > 0);
}

export class Level {
  readonly particles = new ParticleSystem();
  private readonly points = new Set<PointsPopup>();
  shake = 0;
  readonly size: Readonly<{ width: number; height: number }>;
  readonly player: Player;
  readonly rival?: Player;
  private readonly rivalController?: RivalController;
  result: RoundResult | null = null;
  readonly ground: GroundPolygon[];
  private readonly groundVisual = new Drawable2D();
  private readonly flowBackground = new FlowBackground();
  private previousTime = 0;
  private time = 0;
  readonly entities: Entity[];
  readonly fungalColonies: FungalColony[];
  private readonly domain: GrowthDomain;
  private readonly playerFrom = vec2.create();
  private readonly rivalFrom = vec2.create();

  constructor(data: LevelData) {
    this.size = { width: data.width, height: data.height };
    const terrainSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.ground = data.ground.map(({ vertices, style = "terrain" }, i) => {
      const polygon = new GroundPolygon(vertices.map(([x, y]) => vec2.fromValues(x, y)));
      const visual = new Drawable2D(
        {
          shape: { kind: "polygon", vertices: polygon.vertices },
          style: gameAssets.shapeStyles.get(style)
        },
        this.groundVisual
      );
      visual.drawSeed = (terrainSeed + i) >>> 0;
      return polygon;
    });
    this.domain = new GrowthDomain(data.width, data.height, this.ground);
    this.fungalColonies = (data.fungalColonies ?? []).map(
      (config) =>
        new FungalColony(config, this.domain, (position, strength) => {
          this.particles.play(
            gameAssets.particles.get("fungal-ash"),
            { kind: "world", position },
            { strength }
          );
        })
    );
    const castFor =
      (opponent: () => Player | undefined): CastBeam =>
      (from, direction, distance, robotMotion) => {
        const to = vec2.scaleAndAdd(vec2.create(), from, direction, distance);
        const groundHit = castSegment(from, to, this.ground);
        let first: BeamHit | null = groundHit ? { kind: "clingable", ...groundHit } : null;
        for (const colony of this.fungalColonies) {
          const gem = colony.castGem(from, to);
          if (gem && (!first || gem.fraction < first.fraction))
            first = { kind: "gem", ...gem };
        }
        const target = opponent();
        if (target && !target.respawnRemaining && !target.spawnProtection) {
          const { pos, radius } = target.body;
          // Sweep the flying tip against a moving robot in its end-of-tick frame.
          // Sight and AI probes sample only the current pose.
          const previous = target === this.player ? this.playerFrom : this.rivalFrom;
          const drift =
            robotMotion === "swept" ? vec2.subtract(vec2.create(), pos, previous) : null;
          const start = drift ? vec2.add(vec2.create(), from, drift) : from;
          const hit = castCapsule(start, to, 0, pos, pos, radius);
          if (hit && (!first || hit.fraction < first.fraction)) {
            if (drift) vec2.scaleAndAdd(hit.point, hit.point, drift, hit.fraction - 1);
            first = { kind: "robot", target, ...hit };
          }
        }
        return first ?? { kind: "clear", point: to };
      };
    const events: PlayerEvents = {
      scored: (player, points, at) => {
        const color = player === this.player ? "#ffaaa7" : "#82eddf";
        this.points.add(new PointsPopup(points, color, at, this.time, this.size));
      },
      punched: (at, direction, damage) => {
        this.impact(at, direction, damage / 45);
      },
      defeated: (victim, attacker) => {
        this.impact(victim.body.pos, victim.body.vel, 1);
        attacker?.award("knockout", victim.body.pos);
        victim.punchedBy = null;
        if (this.rival) victim.respawnRemaining = respawnDelaySeconds;
        else this.result = "player-contact";
      }
    };
    this.player = new Player(
      vec2.fromValues(...data.playerStart),
      this.ground,
      this.particles,
      castFor(() => this.rival),
      events
    );
    this.entities = [...this.fungalColonies, this.player];
    if (data.rivalStart) {
      const cast = castFor(() => this.player);
      this.rival = new Player(
        vec2.fromValues(...data.rivalStart),
        this.ground,
        this.particles,
        cast,
        events,
        rivalColors
      );
      this.rivalController = new RivalController(
        this.rival,
        this.player,
        this.ground,
        this.fungalColonies,
        cast
      );
      this.entities.push(this.rival);
    }
  }

  private impact(position: vec2, direction: vec2, strength: number) {
    this.shake = Math.max(this.shake, 6 * strength);
    this.particles.play(
      gameAssets.particles.get("impact-sparks"),
      { kind: "world", position, angle: Math.atan2(direction[1], direction[0]) },
      { strength }
    );
  }

  private resolveContact(actor: Player, from: vec2, dt: number) {
    if (!actor.health) return;
    const { pos, radius } = actor.body;
    if (actor.spawnProtection) {
      // Only a robot that had to spawn inside fungus waits for a clear position.
      if (actor.spawnProtection === "overgrown") {
        if (!this.fungalColonies.some((c) => c.playerContact(pos, pos, radius)))
          actor.spawnProtection = respawnGraceSeconds;
      } else actor.spawnProtection = Math.max(0, actor.spawnProtection - dt);
      return;
    }
    // Merge the exposed parts of this tick so overlapping colonies drain at one rate.
    const intervals: { start: number; end: number }[] = [];
    for (const colony of this.fungalColonies) {
      const hit = colony.playerContact(from, pos, radius);
      if (!hit) continue;
      const exit = vec2.exactEquals(from, pos)
        ? hit
        : colony.playerContact(pos, from, radius);
      if (exit) intervals.push({ start: hit.fraction, end: 1 - exit.fraction });
    }
    let covered = 0,
      end = 0;
    for (const interval of intervals.sort((a, b) => a.start - b.start)) {
      covered += Math.max(0, interval.end - Math.max(interval.start, end));
      end = Math.max(end, interval.end);
    }
    actor.exposeToFungus(covered * dt, end === 1);
  }

  private spawnPosition(actor: Player, opponent: Player) {
    const radius = actor.body.radius;
    const safe = (p: vec2) =>
      this.domain.clear(p, p, radius - 0.01) &&
      (opponent.respawnRemaining > 0 ||
        vec2.distance(p, opponent.body.pos) > radius + opponent.body.radius) &&
      !this.fungalColonies.some((c) => c.playerContact(p, p, radius + 12));
    const home = actor.home;
    // Prefer home, then the nearest clear ring around it as the colony spreads.
    if (safe(home)) return home;
    const test = vec2.create();
    for (let ring = 1; ring <= 8; ring++) {
      for (let i = 0; i < 16; i++) {
        const angle = (i * tau) / 16;
        vec2.set(
          test,
          home[0] + ring * radius * Math.cos(angle),
          home[1] + ring * radius * Math.sin(angle)
        );
        if (safe(test)) return test;
      }
    }
    return home;
  }

  private advanceRespawn(actor: Player, opponent: Player, dt: number) {
    if (!actor.respawnRemaining) return;
    actor.respawnRemaining -= dt;
    if (actor.respawnRemaining > 1e-6) return;
    actor.respawnRemaining = 0;
    actor.respawn(this.spawnPosition(actor, opponent), this.ground);
    const { pos, radius } = actor.body;
    actor.spawnProtection = this.fungalColonies.some((c) =>
      c.playerContact(pos, pos, radius)
    )
      ? "overgrown"
      : respawnGraceSeconds;
    if (actor === this.rival) this.rivalController?.onRespawn();
  }

  update(input: InputState, dt: number) {
    this.previousTime = this.time;
    this.time += dt;
    this.shake = Math.max(0, this.shake - 25 * dt);
    for (const popup of this.points) {
      if (popup.expiresAt <= this.previousTime) this.points.delete(popup);
    }
    if (this.result && this.rival) {
      this.particles.step(dt);
      return;
    }
    if (this.rival) {
      this.advanceRespawn(this.player, this.rival, dt);
      this.advanceRespawn(this.rival, this.player, dt);
    }
    vec2.copy(this.playerFrom, this.player.body.pos);
    if (this.rival) vec2.copy(this.rivalFrom, this.rival.body.pos);
    // A solo level keeps growing around the player's final contact pose.
    const active: Entity[] = this.result
      ? this.fungalColonies
      : this.entities.filter(inPlay);
    for (const entity of this.entities) entity.visual.snapshotPose();
    for (const entity of active) {
      entity.update?.(dt);
      if (entity === this.rival) this.rivalController?.control(dt);
      else entity.control?.(input, dt);
    }
    for (const entity of active) {
      if (entity.move) entity.move(this.ground, dt);
      else if (entity.body) stepPhysics(entity.body, this.ground, dt);
    }
    if (!this.result) {
      this.resolveContact(this.player, this.playerFrom, dt);
      if (this.rival) this.resolveContact(this.rival, this.rivalFrom, dt);
    }
    for (const entity of active) {
      if (!(entity instanceof Player && !entity.health))
        entity.afterPhysics?.(dt, this.ground);
    }
    if (
      !this.result &&
      this.rival &&
      this.fungalColonies.length &&
      this.fungalColonies.every((c) => !c.hasUncollectedGems)
    )
      this.result = "cleared";
    this.particles.step(dt);
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1, reducedMotion = false) {
    if (this.rival && this.result) alpha = 1;
    const time = lerp(this.previousTime, this.time, alpha);
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    this.flowBackground.draw(ctx, this.size, reducedMotion ? 0 : time);
    this.groundVisual.render(ctx, alpha, time);
    this.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) {
      if (inPlay(entity)) entity.visual.paintSampled(ctx, time);
    }
    this.particles.draw(ctx, "front", alpha);
    for (const popup of this.points) popup.visual.render(ctx, alpha, time);
  }
}

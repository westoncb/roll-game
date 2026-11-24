import { vec2 } from "gl-matrix";
import { gameAssets } from "./assets";
import { Camera } from "./engine/camera";
import { castCapsule, castSegment } from "./engine/collision";
import { Drawable2D } from "./engine/drawable";
import type { Entity } from "./engine/entity";
import { FlowBackground } from "./flow-background";
import { GroundPolygon } from "./engine/ground";
import type { InputState } from "./engine/input";
import { lerp, tau } from "./utils/math";
import { recordTickEvents } from "./engine/events";
import type { EmitGameEvent, GameEvents, PlayerId } from "./game-events";
import { stepPhysics } from "./engine/physics";
import { Player } from "./player/player";
import type { BeamHit, CastBeam } from "./player/gun";
import { respawnGraceSeconds, rivalColors } from "./player/config";
import { RivalController } from "./player/rival";
import { FungalColony } from "./fungus/colony";
import type { ColonyData } from "./fungus/config";
import { GrowthDomain } from "./fungus/domain";
import { LevelPresentation } from "./level-presentation";

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

function inPlay(entity: Entity<GameEvents>) {
  return !(entity instanceof Player && entity.respawnRemaining > 0);
}

export class Level {
  readonly presentation: LevelPresentation;
  readonly size: Readonly<{ width: number; height: number }>;
  readonly camera: Camera;
  readonly player: Player;
  readonly rival?: Player;
  private readonly rivalController?: RivalController;
  result: RoundResult | null = null;
  readonly ground: GroundPolygon[];
  private readonly groundVisual = new Drawable2D();
  private readonly flowBackground = new FlowBackground();
  private previousTime = 0;
  private time = 0;
  private previousFungalExposure = 0;
  private fungalExposure = 0;
  readonly entities: Entity<GameEvents>[];
  readonly fungalColonies: FungalColony[];
  private readonly domain: GrowthDomain;
  private readonly playerFrom = vec2.create();
  private readonly rivalFrom = vec2.create();

  constructor(data: LevelData) {
    this.size = { width: data.width, height: data.height };
    this.camera = new Camera(this.size);
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
      (config) => new FungalColony(config, this.domain)
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
          // Head selection and AI probes sample the current pose.
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
    this.player = new Player(
      "player",
      vec2.fromValues(...data.playerStart),
      this.ground,
      castFor(() => this.rival),
      this.resolveDefeat
    );
    this.entities = [...this.fungalColonies, this.player];
    if (data.rivalStart) {
      const cast = castFor(() => this.player);
      this.rival = new Player(
        "rival",
        vec2.fromValues(...data.rivalStart),
        this.ground,
        cast,
        this.resolveDefeat,
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
    this.presentation = new LevelPresentation(this);
  }

  getPlayer(id: PlayerId) {
    if (id === this.player.id) return this.player;
    if (this.rival?.id === id) return this.rival;
    throw new Error(`Player "${id}" is absent from this level.`);
  }

  private readonly resolveDefeat = (victim: Player, emit: EmitGameEvent) => {
    if (!this.rival) {
      this.result = "player-contact";
      return;
    }
    victim.respawnRemaining = respawnDelaySeconds;
    const opponent = victim === this.player ? this.rival : this.player;
    opponent.award("knockout", emit);
  };

  private resolveContact(actor: Player, from: vec2, dt: number, emit: EmitGameEvent) {
    if (!actor.health) return 0;
    const { pos, radius } = actor.body;
    if (actor.spawnProtection) {
      // Only a robot that had to spawn inside fungus waits for a clear position.
      if (actor.spawnProtection === "overgrown") {
        if (!this.fungalColonies.some((c) => c.playerContact(pos, pos, radius)))
          actor.spawnProtection = respawnGraceSeconds;
      } else actor.spawnProtection = Math.max(0, actor.spawnProtection - dt);
      return 0;
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
    actor.exposeToFungus(covered * dt, end === 1, emit);
    return covered;
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
    const tick = recordTickEvents<GameEvents>(this.time, this.time + dt, (emit) =>
      this.simulate(input, dt, emit)
    );
    this.previousTime = tick.start;
    this.time = tick.end;
    return tick;
  }

  private simulate(input: InputState, dt: number, emit: EmitGameEvent) {
    this.previousFungalExposure = this.fungalExposure;
    this.fungalExposure = 0;
    if (this.result && this.rival) return;
    if (this.rival) {
      this.advanceRespawn(this.player, this.rival, dt);
      this.advanceRespawn(this.rival, this.player, dt);
    }
    vec2.copy(this.playerFrom, this.player.body.pos);
    if (this.rival) vec2.copy(this.rivalFrom, this.rival.body.pos);
    // A solo level keeps growing around the player's final contact pose.
    const active: Entity<GameEvents>[] = this.result
      ? this.fungalColonies
      : this.entities.filter(inPlay);
    for (const entity of this.entities) entity.visual.snapshotPose();
    for (const entity of active) {
      entity.update?.(dt, emit);
      if (entity === this.rival) this.rivalController?.control(dt);
      else entity.control?.(input, dt, emit);
    }
    for (const entity of active) {
      if (entity.move) entity.move(this.ground, dt, emit);
      else if (entity.body) stepPhysics(entity.body, this.ground, dt);
    }
    if (!this.result) {
      this.fungalExposure = this.resolveContact(this.player, this.playerFrom, dt, emit);
      if (this.rival) this.resolveContact(this.rival, this.rivalFrom, dt, emit);
    }
    for (const entity of active) {
      if (!(entity instanceof Player && !entity.health))
        entity.afterPhysics?.(dt, this.ground, emit);
    }
    if (
      !this.result &&
      this.rival &&
      this.fungalColonies.length &&
      this.fungalColonies.every((c) => !c.hasUncollectedGems)
    )
      this.result = "cleared";
  }

  fungalExposureAt(alpha: number) {
    if (this.result || !this.player.health || this.player.spawnProtection) return 0;
    return lerp(this.previousFungalExposure, this.fungalExposure, alpha);
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1, reducedMotion = false) {
    if (this.rival && this.result) alpha = 1;
    const time = lerp(this.previousTime, this.time, alpha);
    const exposure = this.fungalExposureAt(alpha);
    this.camera.sampleShake(
      time,
      reducedMotion,
      exposure > 0 ? { amplitude: 5.5 * exposure, frequency: 9 } : undefined
    );
    ctx.save();
    this.camera.applyTo(ctx);
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    this.flowBackground.draw(ctx, this.size, reducedMotion ? 0 : time);
    this.groundVisual.render(ctx, alpha, time);
    this.presentation.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) {
      if (inPlay(entity)) entity.visual.paintSampled(ctx, time);
    }
    this.presentation.particles.draw(ctx, "front", alpha);
    this.presentation.drawOverlays(ctx, alpha, time, reducedMotion);
    ctx.restore();
  }
}

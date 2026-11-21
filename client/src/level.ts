import { vec2 } from "gl-matrix";
import { gameAssets } from "./assets";
import { castCapsule, castSegment } from "./engine/collision";
import { Drawable2D } from "./engine/drawable";
import type { Entity } from "./engine/entity";
import { GravityField } from "./gravity-field";
import { GroundPolygon } from "./engine/ground";
import type { InputState } from "./engine/input";
import { lerp, tau } from "./utils/math";
import { ParticleSystem } from "./engine/particles/system";
import { stepPhysics } from "./engine/physics";
import { Player } from "./player/player";
import type { BeamHit, CastBeam } from "./player/gun";
import { rivalColors } from "./player/config";
import { RivalController } from "./player/rival";
import { FungalColony } from "./fungus/colony";
import type { ColonyData } from "./fungus/config";
import { GrowthDomain } from "./fungus/domain";

export type Point = [number, number];
export type GroundData = { vertices: Point[]; gravityScale?: number; style?: string };
export type LevelData = {
  width: number;
  height: number;
  playerStart: Point;
  rivalStart?: Point;
  ground: GroundData[];
  fungalColonies?: ColonyData[];
};

export type RoundResult = "player-contact" | "cleared";
const respawnGraceSeconds = 1.5;

export class Level {
  readonly particles = new ParticleSystem();
  readonly size: Readonly<{ width: number; height: number }>;
  readonly player: Player;
  readonly rival?: Player;
  private readonly rivalController?: RivalController;
  result: RoundResult | null = null;
  readonly ground: GroundPolygon[];
  private readonly groundVisual = new Drawable2D();
  private readonly gravityField: GravityField;
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
    this.ground = data.ground.map(
      ({ vertices, gravityScale = 1, style = "terrain" }, i) => {
        const polygon = new GroundPolygon(
          vertices.map(([x, y]) => vec2.fromValues(x, y)),
          gravityScale
        );
        const visual = new Drawable2D(
          {
            shape: { kind: "polygon", vertices: polygon.vertices },
            style: gameAssets.shapeStyles.get(style)
          },
          this.groundVisual
        );
        visual.drawSeed = (terrainSeed + i) >>> 0;
        return polygon;
      }
    );
    const worldMin = vec2.create();
    const worldMax = vec2.fromValues(data.width, data.height);
    for (const polygon of this.ground) {
      for (const vertex of polygon.vertices) {
        vec2.min(worldMin, worldMin, vertex);
        vec2.max(worldMax, worldMax, vertex);
      }
    }
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
    const worldDiagonal = vec2.distance(worldMin, worldMax);
    const castFor =
      (opponent: () => Player | undefined): CastBeam =>
      (from, direction, distance) => {
        // A sight ray spans the entire world, even when the player is outside its bounds.
        const range = distance ?? vec2.distance(from, worldMin) + worldDiagonal;
        const to = vec2.scaleAndAdd(vec2.create(), from, direction, range);
        const groundHit = castSegment(from, to, this.ground);
        let first: BeamHit | null = groundHit ? { kind: "clingable", ...groundHit } : null;
        for (const colony of this.fungalColonies) {
          const gem = colony.castGem(from, to);
          if (gem && (!first || gem.fraction < first.fraction))
            first = { kind: "gem", ...gem };
        }
        const target = opponent();
        if (target && !target.spawnProtection) {
          const { pos, radius } = target.body;
          const hit = castCapsule(from, to, 0, pos, pos, radius);
          if (hit && (!first || hit.fraction < first.fraction))
            first = { kind: "robot", target, ...hit };
        }
        if (first) return first;
        // A shot fired from outside can still travel back into the level.
        for (const axis of [0, 1]) {
          if (
            (to[axis] < worldMin[axis] && to[axis] <= from[axis]) ||
            (to[axis] > worldMax[axis] && to[axis] >= from[axis])
          )
            return { kind: "miss", point: to };
        }
        return { kind: "clear", point: to };
      };
    this.player = new Player(
      vec2.fromValues(...data.playerStart),
      this.ground,
      this.particles,
      castFor(() => this.rival)
    );
    this.entities = [...this.fungalColonies, this.player];
    if (data.rivalStart) {
      const cast = castFor(() => this.player);
      this.rival = new Player(
        vec2.fromValues(...data.rivalStart),
        this.ground,
        this.particles,
        cast,
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
    this.gravityField = new GravityField(
      data.width,
      data.height,
      this.player.body.radius,
      this.ground
    );
  }

  private stopAtContact(actor: Player, from: vec2, dt: number) {
    const { pos, vel, radius } = actor.body;
    if (actor.spawnProtection) {
      // Only a robot that had to spawn inside fungus waits for a clear position.
      if (actor.spawnProtection === "overgrown") {
        if (!this.fungalColonies.some((c) => c.playerContact(pos, pos, radius)))
          actor.spawnProtection = respawnGraceSeconds;
      } else actor.spawnProtection = Math.max(0, actor.spawnProtection - dt);
      return false;
    }
    let fraction = Infinity;
    for (const colony of this.fungalColonies) {
      const hit = colony.playerContact(from, pos, radius);
      if (hit) fraction = Math.min(fraction, hit.fraction);
    }
    if (!Number.isFinite(fraction)) return false;
    vec2.lerp(pos, from, pos, fraction);
    vec2.zero(vel);
    return true;
  }

  private spawnPosition(actor: Player, opponent: Player) {
    const radius = actor.body.radius;
    const safe = (p: vec2) =>
      this.domain.clear(p, p, radius - 0.01) &&
      vec2.distance(p, opponent.body.pos) > radius + opponent.body.radius &&
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

  private respawn(actor: Player, opponent: Player) {
    opponent.knockouts++;
    if (opponent.gun.tethered === actor) {
      opponent.gun.endAim(false);
      opponent.gun.finish();
    }
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
    if (this.result && this.rival) return;
    vec2.copy(this.playerFrom, this.player.body.pos);
    if (this.rival) vec2.copy(this.rivalFrom, this.rival.body.pos);
    // A solo level keeps growing around the player's final contact pose.
    const active: Entity[] = this.result ? this.fungalColonies : this.entities;
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
      const playerHit = this.stopAtContact(this.player, this.playerFrom, dt);
      if (this.rival) {
        const rivalHit = this.stopAtContact(this.rival, this.rivalFrom, dt);
        if (playerHit) this.respawn(this.player, this.rival);
        if (rivalHit) this.respawn(this.rival, this.player);
      } else if (playerHit) this.result = "player-contact";
    }
    for (const entity of active) entity.afterPhysics?.(dt, this.ground);
    if (
      !this.result &&
      this.rival &&
      this.fungalColonies.length &&
      this.fungalColonies.every((c) => !c.hasUncollectedGems)
    )
      this.result = "cleared";
    this.particles.step(dt);
    this.previousTime = this.time;
    this.time += dt;
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1) {
    if (this.rival && this.result) alpha = 1;
    const time = lerp(this.previousTime, this.time, alpha);
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    this.gravityField.draw(ctx, time);
    this.groundVisual.render(ctx, alpha, time);
    this.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) entity.visual.paintSampled(ctx, time);
    this.particles.draw(ctx, "front", alpha);
  }
}

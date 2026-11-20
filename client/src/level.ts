import { vec2 } from "gl-matrix";
import { gameAssets } from "./assets";
import { castSegment } from "./engine/collision";
import { Drawable2D } from "./engine/drawable";
import type { Entity } from "./engine/entity";
import { GravityField } from "./gravity-field";
import { GroundPolygon } from "./engine/ground";
import type { InputState } from "./engine/input";
import { lerp } from "./engine/math";
import { ParticleSystem } from "./engine/particles/system";
import { stepPhysics } from "./engine/physics";
import { Player } from "./player/player";
import { FungalColony } from "./fungus/colony";
import type { ColonyData } from "./fungus/config";
import { GrowthDomain } from "./fungus/domain";

export type Point = [number, number];
export type GroundData = { vertices: Point[]; gravityScale?: number; style?: string };
export type LevelData = {
  width: number;
  height: number;
  playerStart: Point;
  ground: GroundData[];
  fungalColonies?: ColonyData[];
};

export class Level {
  readonly particles = new ParticleSystem();
  readonly size: Readonly<{ width: number; height: number }>;
  readonly player: Player;
  readonly ground: GroundPolygon[];
  private readonly groundVisual = new Drawable2D();
  private readonly gravityField: GravityField;
  private previousTime = 0;
  private time = 0;
  readonly entities: Entity[];
  readonly fungalColonies: FungalColony[];
  fungalContact: ReturnType<FungalColony["playerContact"]> = null;
  private readonly playerFrom = vec2.create();

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
    this.player = new Player(
      vec2.fromValues(...data.playerStart),
      this.ground,
      this.particles,
      (from, to) => {
        const hit = castSegment(from, to, this.ground);
        if (hit) return { kind: "clingable", ...hit };
        // A shot fired from outside can still travel back into the level.
        for (const axis of [0, 1]) {
          if (
            (to[axis] < worldMin[axis] && to[axis] <= from[axis]) ||
            (to[axis] > worldMax[axis] && to[axis] >= from[axis])
          )
            return { kind: "miss", point: to };
        }
        return null;
      }
    );
    const domain = new GrowthDomain(data.width, data.height, this.ground);
    this.fungalColonies = (data.fungalColonies ?? []).map(
      (config) => new FungalColony(config, domain)
    );
    this.entities = [...this.fungalColonies, this.player];
    this.gravityField = new GravityField(
      data.width,
      data.height,
      this.player.body.radius,
      this.ground
    );
  }

  update(input: InputState, dt: number) {
    vec2.copy(this.playerFrom, this.player.body.pos);
    // After entry the player holds its contact pose while the living colony keeps growing.
    const active = this.fungalContact
      ? this.entities.filter((entity) => entity !== this.player)
      : this.entities;
    for (const entity of this.entities) entity.visual.snapshotPose();
    for (const entity of active) {
      entity.update?.(dt);
      entity.control?.(input, dt);
    }
    for (const entity of active) {
      if (entity.move) entity.move(this.ground, dt);
      else if (entity.body) stepPhysics(entity.body, this.ground, dt);
    }
    if (!this.fungalContact) {
      const body = this.player.body;
      for (const colony of this.fungalColonies) {
        const hit = colony.playerContact(this.playerFrom, body.pos, body.radius);
        if (hit && (!this.fungalContact || hit.fraction < this.fungalContact.fraction))
          this.fungalContact = hit;
      }
      if (this.fungalContact) {
        vec2.lerp(body.pos, this.playerFrom, body.pos, this.fungalContact.fraction);
        vec2.zero(body.vel);
      }
    }
    for (const entity of active) entity.afterPhysics?.(dt, this.ground);
    this.particles.step(dt);
    this.previousTime = this.time;
    this.time += dt;
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1) {
    const time = lerp(this.previousTime, this.time, alpha);
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    this.gravityField.draw(ctx, time);
    this.groundVisual.render(ctx, alpha, time);
    this.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) entity.visual.paintSampled(ctx, time);
    this.particles.draw(ctx, "front", alpha);
  }
}

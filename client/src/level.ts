import { vec2 } from "gl-matrix";
import { castSegment } from "./collision";
import type { Entity } from "./entity";
import { GravityField } from "./gravity-field";
import { GroundPolygon } from "./ground";
import type { InputState } from "./input";
import { ParticleSystem } from "./particles/system";
import { stepPhysics } from "./physics";
import { Player } from "./player";

export type Point = [number, number];
export type GroundData = { vertices: Point[]; gravityScale?: number };
export type LevelData = {
  width: number;
  height: number;
  playerStart: Point;
  ground: GroundData[];
};

export class Level {
  readonly particles = new ParticleSystem();
  readonly size: Readonly<{ width: number; height: number }>;
  readonly player: Player;
  readonly ground: GroundPolygon[];
  private readonly gravityField: GravityField;
  readonly entities: Entity[];

  constructor(data: LevelData) {
    this.size = { width: data.width, height: data.height };
    this.ground = data.ground.map(
      (polygon) =>
        new GroundPolygon(
          polygon.vertices.map(([x, y]) => vec2.fromValues(x, y)),
          polygon.gravityScale ?? 1
        )
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
    this.entities = [this.player];
    this.gravityField = new GravityField(
      data.width,
      data.height,
      this.player.body.radius,
      this.ground
    );
  }

  update(input: InputState, dt: number) {
    for (const entity of this.entities) entity.visual.snapshotPose();
    for (const entity of this.entities) entity.control?.(input, dt);
    for (const entity of this.entities) {
      if (entity.move) entity.move(this.ground, dt);
      else stepPhysics(entity.body, this.ground, dt);
    }
    for (const entity of this.entities) entity.afterPhysics?.(dt, this.ground);
    this.particles.step(dt);
    this.gravityField.step(dt);
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1) {
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    this.gravityField.draw(ctx, alpha);
    for (const polygon of this.ground) polygon.draw(ctx);
    this.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) entity.visual.paintSampled(ctx);
    this.particles.draw(ctx, "front", alpha);
  }
}

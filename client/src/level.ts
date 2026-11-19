import { vec2 } from "gl-matrix";
import type { Entity } from "./entity";
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
    this.player = new Player(vec2.fromValues(...data.playerStart), this.ground);
    this.entities = [this.player];
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
  }

  draw(ctx: CanvasRenderingContext2D, alpha = 1) {
    for (const entity of this.entities) entity.visual.samplePose(alpha);
    for (const polygon of this.ground) polygon.draw(ctx);
    this.particles.draw(ctx, "behind", alpha);
    for (const entity of this.entities) entity.visual.paintSampled(ctx);
    this.particles.draw(ctx, "front", alpha);
  }
}

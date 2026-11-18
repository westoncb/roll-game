import { vec2 } from "gl-matrix";
import type { Entity } from "./entity";
import { GroundPolygon } from "./ground";
import type { InputState } from "./input";
import { stepPhysics } from "./physics";
import { Player } from "./player";

type Point = [number, number];
type GroundData = { vertices: Point[]; gravityScale?: number };
export type LevelData = { playerStart: Point; ground: GroundData[] };

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isGroundData(value: unknown): value is GroundData {
  if (!value || typeof value !== "object" || !("vertices" in value)) return false;
  const vertices = value.vertices;
  return (
    Array.isArray(vertices) &&
    vertices.length >= 3 &&
    vertices.every(isPoint) &&
    (!("gravityScale" in value) ||
      (typeof value.gravityScale === "number" && Number.isFinite(value.gravityScale)))
  );
}

export class Level {
  readonly player: Player;
  readonly ground: GroundPolygon[];
  readonly entities: Entity[];

  constructor(data: LevelData) {
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
    for (const entity of this.entities) entity.control?.(input, dt);
    for (const entity of this.entities) {
      if (entity.move) entity.move(this.ground, dt);
      else stepPhysics(entity.body, this.ground, dt);
    }
    for (const entity of this.entities) entity.afterPhysics?.(dt, this.ground);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const polygon of this.ground) polygon.draw(ctx);
    for (const entity of this.entities) entity.draw(ctx);
  }
}

export async function loadLevel(id: string, signal: AbortSignal): Promise<Level> {
  const response = await fetch(`/api/levels/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error(`Level "${id}" returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("playerStart" in data) ||
    !isPoint(data.playerStart)
  ) {
    throw new Error(`Level "${id}" needs a playerStart coordinate pair.`);
  }
  if (
    !("ground" in data) ||
    !Array.isArray(data.ground) ||
    !data.ground.every(isGroundData)
  ) {
    throw new Error(`Level "${id}" has invalid ground polygons.`);
  }
  return new Level({ playerStart: data.playerStart, ground: data.ground });
}

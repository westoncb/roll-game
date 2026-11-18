import type { GroundPolygon } from "./ground";
import type { InputState } from "./input";
import type { PhysicsBody } from "./physics";

export interface Entity {
  body: PhysicsBody;
  /** Can read last tick's contacts and set acceleration before integration. */
  control?(input: InputState, dt: number): void;
  move?(ground: GroundPolygon[], dt: number): void;
  /** Current contacts are available for collision response and posing parts. */
  afterPhysics?(dt: number, ground: GroundPolygon[]): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

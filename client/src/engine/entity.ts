import type { Drawable2D } from "./drawable";
import type { GroundPolygon } from "./ground";
import type { InputState } from "./input";
import type { PhysicsBody } from "./physics";

export interface Entity {
  /** Present for entities that participate in body physics. */
  readonly body?: PhysicsBody;
  /** The root drawable for this entity. Its position can also back the physics body. */
  readonly visual: Drawable2D;
  /** Advance autonomous state on the fixed clock before bodies move. */
  update?(dt: number): void;
  /** Can read last tick's contacts and set acceleration before integration. */
  control?(input: InputState, dt: number): void;
  move?(ground: GroundPolygon[], dt: number): void;
  /** Current contacts are available for collision response and posing parts. */
  afterPhysics?(dt: number, ground: GroundPolygon[]): void;
}

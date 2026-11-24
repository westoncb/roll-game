import type { ReadonlyVec2 } from "gl-matrix";
import type { EmitEvent } from "./engine/events";

export type PlayerId = "player" | "rival";
export type Coordinates = readonly [x: number, y: number];

export function coordinates(v: ReadonlyVec2): Coordinates {
  return [v[0], v[1]];
}

export type HealthSource =
  | { kind: "punch"; direction: Coordinates; strength: number }
  | { kind: "gem" | "fungus" };
export type ScoreReason = "gem" | "knockout";

export type GameEvents = {
  punched: {
    player: PlayerId;
    position: Coordinates;
    direction: Coordinates;
    strength: number;
  };
  /** Damage or healing after clamping. Respawning initializes a fresh health total. */
  healthChanged: {
    player: PlayerId;
    before: number;
    after: number;
    source: HealthSource;
    position: Coordinates;
  };
  defeated: { player: PlayerId; position: Coordinates; velocity: Coordinates };
  scored: { player: PlayerId; before: number; after: number; reason: ScoreReason };
  footPlanted: {
    player: PlayerId;
    foot: number;
    position: Coordinates;
    normal: Coordinates;
    speed: number;
    /** Approach speed along the surface normal on landing, or null for a walking step. */
    landingSpeed: number | null;
  };
  ashCrumbled: { position: Coordinates; strength: number };
};

export type EmitGameEvent = EmitEvent<GameEvents>;

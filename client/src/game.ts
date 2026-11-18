import type { InputState } from "./input";
import type { Level } from "./level";

export type GameState = { level: Level };

export function updateGame(game: GameState, input: InputState, dt: number) {
  game.level.update(input, dt);
}

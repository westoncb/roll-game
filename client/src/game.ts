import type { InputState } from "./engine/input";
import type { Level } from "./level";

export const gameKeys: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "KeyA",
  "KeyD",
  "KeyF",
  "KeyW",
  "KeyS",
  "Space"
]);

export type GameState = { level: Level };

export function updateGame(game: GameState, input: InputState, dt: number) {
  const tick = game.level.update(input, dt);
  game.level.presentation.update(tick);
  return tick;
}

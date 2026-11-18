import { useEffect, useRef, useState } from "react";
import { startGame } from "../game";
import { loadLevel } from "../level";

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const controller = new AbortController();
    let stopGame: (() => void) | undefined;
    loadLevel("test", controller.signal)
      .then((level) => {
        if (!controller.signal.aborted) stopGame = startGame(canvas, level);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      controller.abort();
      stopGame?.();
    };
  }, []);

  return error ? (
    <p role="alert">Could not start the game. {error}</p>
  ) : (
    <canvas id="game-canvas" ref={canvasRef} tabIndex={0} aria-label="Game canvas" />
  );
}

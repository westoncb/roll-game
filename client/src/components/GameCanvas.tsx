import { useEffect, useRef } from "react";
import { startGame } from "../game";

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    return startGame(canvas);
  }, []);

  return <canvas id="game-canvas" ref={canvasRef} tabIndex={0} aria-label="Game canvas" />;
}

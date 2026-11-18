import { useEffect, useRef, useState } from "react";
import { vec2 } from "gl-matrix";
import { Camera } from "../camera";
import { updateGame, type GameState } from "../game";
import { listenForInput, type InputState } from "../input";
import { loadLevel } from "../level";

export function Game() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!host || !canvas) return;

    const controller = new AbortController();
    let stopGame: (() => void) | undefined;
    loadLevel("test", controller.signal)
      .then((level) => {
        if (!controller.signal.aborted) stopGame = startGame(host, canvas, { level });
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
    <div id="game-host" ref={hostRef}>
      <canvas id="game-canvas" ref={canvasRef} tabIndex={0} aria-label="Game canvas" />
    </div>
  );
}

const stepSeconds = 1 / 60;

function startGame(host: HTMLElement, canvas: HTMLCanvasElement, game: GameState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const camera = new Camera(game.level.size);
  const viewport = window.visualViewport;
  const fitHost = () => {
    if (!viewport) return;
    host.style.width = `${viewport.width}px`;
    host.style.height = `${viewport.height}px`;
    host.style.left = `${viewport.offsetLeft}px`;
    host.style.top = `${viewport.offsetTop}px`;
  };
  const fitCanvas = (available: DOMRectReadOnly) => {
    camera.fit(available);
    canvas.style.width = `${camera.width}px`;
    canvas.style.height = `${camera.height}px`;
  };
  fitHost();
  fitCanvas(host.getBoundingClientRect());
  const observer = new ResizeObserver(([entry]) => fitCanvas(entry.contentRect));
  observer.observe(host);
  viewport?.addEventListener("resize", fitHost);
  viewport?.addEventListener("scroll", fitHost);

  const input: InputState = {
    keysDown: new Set(),
    keysPressed: new Set(),
    mousePos: vec2.create()
  };
  const stopInput = listenForInput(canvas, input, camera);
  let previousTime: number | undefined;
  let accumulator = 0;
  let frameId: number;

  const frame = (now: number) => {
    accumulator += Math.min(now - (previousTime ?? now), 50) / 1000;
    previousTime = now;
    while (accumulator >= stepSeconds) {
      updateGame(game, input, stepSeconds);
      input.keysPressed.clear();
      accumulator -= stepSeconds;
    }

    const density = window.devicePixelRatio * (viewport?.scale ?? 1);
    const width = Math.round(camera.width * density);
    const height = Math.round(camera.height * density);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (width > 0 && height > 0) {
      ctx.resetTransform();
      ctx.fillStyle = "#112233";
      ctx.fillRect(0, 0, width, height);
      // Account for the whole-pixel rounding of each bitmap dimension.
      ctx.scale(width / camera.width, height / camera.height);
      camera.applyTo(ctx);
      game.level.draw(ctx, accumulator / stepSeconds);
    }
    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    stopInput();
    observer.disconnect();
    viewport?.removeEventListener("resize", fitHost);
    viewport?.removeEventListener("scroll", fitHost);
  };
}

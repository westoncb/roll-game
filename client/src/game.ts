import { vec2 } from "gl-matrix";

import { listenForInput, type InputState } from "./input";
import type { Level } from "./level";

const stepSeconds = 1 / 60;

export function startGame(canvas: HTMLCanvasElement, level: Level): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const input: InputState = {
    keysDown: new Set(),
    keysPressed: new Set(),
    mousePos: vec2.create()
  };
  const { width, height } = canvas.getBoundingClientRect();
  const canvasSize = vec2.fromValues(width, height);
  const resizeObserver = new ResizeObserver(([entry]) => {
    vec2.set(canvasSize, entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(canvas);
  const stopInput = listenForInput(canvas, input);
  let previousTime: number | undefined;
  let accumulator = 0;
  let frameId: number;

  const frame = (now: number) => {
    const elapsedMs = now - (previousTime ?? now);
    accumulator += Math.min(elapsedMs, 50) / 1000;
    previousTime = now;

    // CSS determines the viewport. The bitmap also tracks zoom and display density.
    const [width, height] = canvasSize;
    const scale = window.devicePixelRatio;
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(
      width ? pixelWidth / width : 1,
      0,
      0,
      height ? pixelHeight / height : 1,
      0,
      0
    );

    while (accumulator >= stepSeconds) {
      level.update(input, stepSeconds);
      input.keysPressed.clear();
      accumulator -= stepSeconds;
    }
    ctx.fillStyle = "#112233";
    ctx.fillRect(0, 0, width, height);
    level.draw(ctx);

    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    stopInput();
  };
}

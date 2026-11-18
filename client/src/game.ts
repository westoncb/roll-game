import { vec2 } from "gl-matrix";

import { listenForInput, type InputState } from "./input";
import type { Level } from "./level";

const stepSeconds = 1 / 60;

function measureLevel(level: Level) {
  const { pos, radius } = level.player.body;
  const min = vec2.fromValues(pos[0] - radius, pos[1] - radius);
  const max = vec2.fromValues(pos[0] + radius, pos[1] + radius);
  for (const polygon of level.ground) {
    for (const vertex of polygon.vertices) {
      vec2.min(min, min, vertex);
      vec2.max(max, max, vertex);
    }
  }
  return { min, max, width: max[0] - min[0], height: max[1] - min[1] };
}

export function startGame(canvas: HTMLCanvasElement, level: Level): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const input: InputState = {
    keysDown: new Set(),
    keysPressed: new Set(),
    mousePos: vec2.create()
  };
  const bounds = measureLevel(level);
  const viewport = window.visualViewport;
  let width = 0;
  let height = 0;
  let viewportScale = 1;
  const fitViewport = () => {
    width = viewport?.width ?? window.innerWidth;
    height = viewport?.height ?? window.innerHeight;
    viewportScale = viewport?.scale ?? 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${viewport?.offsetLeft ?? 0}px`;
    canvas.style.top = `${viewport?.offsetTop ?? 0}px`;
    const zoom = Math.min(width / bounds.width, height / bounds.height);
    if (zoom > 0) {
      const extraX = (width / zoom - bounds.width) / 2;
      const extraY = (height / zoom - bounds.height) / 2;
      for (const polygon of level.ground) {
        polygon.fitExterior(bounds.min, bounds.max, extraX, extraY);
      }
    }
  };
  fitViewport();
  window.addEventListener("resize", fitViewport);
  viewport?.addEventListener("resize", fitViewport);
  viewport?.addEventListener("scroll", fitViewport);
  const stopInput = listenForInput(canvas, input);
  let previousTime: number | undefined;
  let accumulator = 0;
  let frameId: number;

  const frame = (now: number) => {
    const elapsedMs = now - (previousTime ?? now);
    accumulator += Math.min(elapsedMs, 50) / 1000;
    previousTime = now;

    const scale = window.devicePixelRatio * viewportScale;
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    while (accumulator >= stepSeconds) {
      level.update(input, stepSeconds);
      input.keysPressed.clear();
      accumulator -= stepSeconds;
    }
    ctx.resetTransform();
    ctx.fillStyle = "#112233";
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    const zoom = Math.min(pixelWidth / bounds.width, pixelHeight / bounds.height);
    const offsetX = (pixelWidth - zoom * bounds.width) / 2 - zoom * bounds.min[0];
    const offsetY = (pixelHeight - zoom * bounds.height) / 2 - zoom * bounds.min[1];
    ctx.setTransform(zoom, 0, 0, zoom, offsetX, offsetY);
    level.draw(ctx, accumulator / stepSeconds);

    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener("resize", fitViewport);
    viewport?.removeEventListener("resize", fitViewport);
    viewport?.removeEventListener("scroll", fitViewport);
    stopInput();
  };
}

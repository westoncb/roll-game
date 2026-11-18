import type { vec2 } from "gl-matrix";

import type { Camera } from "./camera";

export type InputState = {
  keysDown: Set<string>;
  keysPressed: Set<string>;
  mousePos: vec2;
};

export function listenForInput(
  canvas: HTMLCanvasElement,
  input: InputState,
  camera: Camera
): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const gameKeys = new Set(["ArrowLeft", "ArrowRight", "Space", "KeyF"]);

  canvas.addEventListener(
    "keydown",
    (event) => {
      if (!gameKeys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      event.preventDefault();
      if (!event.repeat && !input.keysDown.has(event.code))
        input.keysPressed.add(event.code);
      input.keysDown.add(event.code);
    },
    options
  );
  canvas.addEventListener("keyup", (event) => input.keysDown.delete(event.code), options);
  const releaseKeys = () => {
    input.keysDown.clear();
    input.keysPressed.clear();
  };
  canvas.addEventListener("blur", releaseKeys, options);
  window.addEventListener("blur", releaseKeys, options);
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) event.preventDefault();
    },
    { ...options, passive: false }
  );
  canvas.addEventListener(
    "mousemove",
    (event) => {
      const bounds = canvas.getBoundingClientRect();
      if (camera.zoom > 0) {
        input.mousePos = camera.screenToWorld([
          event.clientX - bounds.left,
          event.clientY - bounds.top
        ]);
      }
    },
    options
  );

  if (document.activeElement === document.body) canvas.focus({ preventScroll: true });
  return () => controller.abort();
}

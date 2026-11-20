import type { vec2 } from "gl-matrix";

import type { Camera } from "./camera";

export type InputState = {
  keysDown: Set<string>;
  /** Transitions since the last fixed tick, including taps between ticks. */
  keyChanges: { code: string; type: "press" | "release" }[];
  mousePos: vec2;
};

export function listenForInput(
  canvas: HTMLCanvasElement,
  input: InputState,
  camera: Camera,
  capturedKeys: ReadonlySet<string>
): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };

  canvas.addEventListener(
    "keydown",
    (event) => {
      if (!capturedKeys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      event.preventDefault();
      if (event.repeat || input.keysDown.has(event.code)) return;
      input.keysDown.add(event.code);
      input.keyChanges.push({ code: event.code, type: "press" });
    },
    options
  );
  canvas.addEventListener(
    "keyup",
    (event) => {
      if (input.keysDown.delete(event.code)) {
        input.keyChanges.push({ code: event.code, type: "release" });
      }
    },
    options
  );
  const releaseKeys = () => {
    input.keysDown.clear();
    input.keyChanges.length = 0;
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

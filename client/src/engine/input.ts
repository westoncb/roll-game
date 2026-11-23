import type { vec2 } from "gl-matrix";

import type { Camera } from "./camera";

type InputChange =
  | { type: "press" | "release"; code: string }
  | { type: "fire"; target: vec2 };

export type InputState = {
  keysDown: Set<string>;
  /** Transitions since the last fixed tick, including taps between ticks. */
  changes: InputChange[];
};

export function clientToWorld(canvas: HTMLCanvasElement, camera: Camera, point: vec2) {
  const { left, top } = canvas.getBoundingClientRect();
  return camera.screenToWorld([point[0] - left, point[1] - top]);
}

export function listenForInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  capturedKeys: ReadonlySet<string>,
  getPointerPosition: () => vec2 | null
) {
  const input: InputState = { keysDown: new Set(), changes: [] };
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const queueShot = (point: vec2 | null) => {
    if (point && camera.zoom > 0)
      input.changes.push({ type: "fire", target: clientToWorld(canvas, camera, point) });
  };

  canvas.addEventListener(
    "keydown",
    (event) => {
      if (!capturedKeys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      event.preventDefault();
      if (event.repeat || input.keysDown.has(event.code)) return;
      input.keysDown.add(event.code);
      input.changes.push({ code: event.code, type: "press" });
      if (event.code === "KeyF") queueShot(getPointerPosition());
    },
    options
  );
  canvas.addEventListener(
    "keyup",
    (event) => {
      if (input.keysDown.delete(event.code)) {
        input.changes.push({ code: event.code, type: "release" });
      }
    },
    options
  );
  const releaseKeys = () => {
    input.keysDown.clear();
    input.changes.length = 0;
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
    "click",
    (event) => {
      if (event.button === 0) queueShot([event.clientX, event.clientY]);
    },
    options
  );

  if (document.activeElement === document.body) canvas.focus({ preventScroll: true });
  return { input, stopInput: () => controller.abort() };
}

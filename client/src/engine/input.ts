import { vec2 } from "gl-matrix";

import type { Camera } from "./camera";

type InputChange = ({ type: "press" | "release"; code: string } | { type: "click" }) & {
  mousePos: vec2 | null;
};

export type InputState = {
  keysDown: Set<string>;
  readonly mousePos: vec2 | null;
  /** Transitions since the last fixed tick, including taps between ticks. */
  changes: InputChange[];
};

export function listenForInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  capturedKeys: ReadonlySet<string>
) {
  let clientPos: vec2 | null = null;
  const input: InputState = {
    keysDown: new Set(),
    changes: [],
    get mousePos() {
      if (!clientPos || camera.zoom <= 0) return null;
      const bounds = canvas.getBoundingClientRect();
      return camera.screenToWorld([clientPos[0] - bounds.left, clientPos[1] - bounds.top]);
    }
  };
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
      input.changes.push({ code: event.code, type: "press", mousePos: input.mousePos });
    },
    options
  );
  canvas.addEventListener(
    "keyup",
    (event) => {
      if (input.keysDown.delete(event.code)) {
        input.changes.push({ code: event.code, type: "release", mousePos: input.mousePos });
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
  const trackMouse = (event: MouseEvent) => {
    clientPos = vec2.fromValues(event.clientX, event.clientY);
  };
  window.addEventListener("mousemove", trackMouse, options);
  canvas.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0) return;
      trackMouse(event);
      input.changes.push({ type: "click", mousePos: input.mousePos });
    },
    options
  );

  if (document.activeElement === document.body) canvas.focus({ preventScroll: true });
  return { input, stopInput: () => controller.abort() };
}

import { vec2 } from "gl-matrix";

export function startGame(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const state = createGameState();
  const { width, height } = canvas.getBoundingClientRect();
  vec2.set(state.canvasSize, width, height);
  const resizeObserver = new ResizeObserver(([entry]) => {
    vec2.set(state.canvasSize, entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(canvas);
  const stopInput = listenForInput(canvas, state.input);
  let previousTime: number | undefined;
  let frameId: number;

  const frame = (now: number) => {
    const elapsedMs = now - (previousTime ?? now);
    const dt = Math.min(elapsedMs, 50) / 1000;
    previousTime = now;

    // CSS determines the viewport. The bitmap also tracks zoom and display density.
    const [width, height] = state.canvasSize;
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

    update(state, dt);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, state);

    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    stopInput();
  };
}

type Entity = { pos: vec2; vel: vec2; accel: vec2 };
type InputState = { keysDown: Set<string>; mousePos: vec2 };
type GameState = { canvasSize: vec2; entities: Entity[]; input: InputState };

function createGameState(): GameState {
  const player: Entity = { pos: vec2.create(), vel: vec2.create(), accel: vec2.create() };
  return {
    canvasSize: vec2.create(),
    entities: [player],
    input: { keysDown: new Set(), mousePos: vec2.create() }
  };
}

function listenForInput(canvas: HTMLCanvasElement, input: InputState): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const gameKeys = new Set(["ArrowLeft", "ArrowRight", "Space", "KeyF"]);

  canvas.addEventListener(
    "keydown",
    (event) => {
      if (!gameKeys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      event.preventDefault();
      input.keysDown.add(event.code);
    },
    options
  );
  canvas.addEventListener("keyup", (event) => input.keysDown.delete(event.code), options);
  const releaseKeys = () => input.keysDown.clear();
  canvas.addEventListener("blur", releaseKeys, options);
  window.addEventListener("blur", releaseKeys, options);
  canvas.addEventListener(
    "mousemove",
    (event) => {
      const bounds = canvas.getBoundingClientRect();
      vec2.set(input.mousePos, event.clientX - bounds.left, event.clientY - bounds.top);
    },
    options
  );

  if (document.activeElement === document.body) canvas.focus({ preventScroll: true });
  return () => controller.abort();
}

function update(state: GameState, dt: number) {}

function draw(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.fillStyle = "#112233";
  ctx.fillRect(0, 0, state.canvasSize[0], state.canvasSize[1]);
}

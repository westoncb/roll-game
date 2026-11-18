import { vec2, type ReadonlyVec2 } from "gl-matrix";

type Size = { width: number; height: number };

// Screen coordinates are CSS pixels relative to the fitted canvas.
export class Camera {
  zoom = 1;

  constructor(private readonly playfield: Size) {}

  fit(available: Size) {
    this.zoom = Math.min(
      available.width / this.playfield.width,
      available.height / this.playfield.height
    );
  }

  get width() {
    return this.playfield.width * this.zoom;
  }

  get height() {
    return this.playfield.height * this.zoom;
  }

  worldToScreen(point: ReadonlyVec2) {
    return vec2.scale(vec2.create(), point, this.zoom);
  }

  screenToWorld(point: ReadonlyVec2) {
    return vec2.scale(vec2.create(), point, 1 / this.zoom);
  }
}

import { vec2, type ReadonlyVec2 } from "gl-matrix";
import { applyMatrix, Transform2D } from "./transform";

type Size = { width: number; height: number };

// Screen coordinates are CSS pixels relative to the fitted canvas.
export class Camera {
  private readonly view = new Transform2D();

  constructor(private readonly playfield: Size) {}

  get zoom() {
    return this.view.scale[0];
  }

  set zoom(value: number) {
    vec2.set(this.view.scale, value, value);
  }

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

  shake(strength: number, time: number) {
    const amplitude = strength * Math.min(this.zoom, 1);
    vec2.set(
      this.view.position,
      amplitude * Math.sin(91 * time),
      amplitude * 0.7 * Math.sin(113 * time)
    );
  }

  worldToScreen(point: ReadonlyVec2) {
    return this.view.localToWorld(point);
  }

  screenToWorld(point: ReadonlyVec2) {
    return this.view.worldToLocal(point);
  }

  applyTo(ctx: CanvasRenderingContext2D) {
    applyMatrix(ctx, this.view.worldMatrix());
  }
}

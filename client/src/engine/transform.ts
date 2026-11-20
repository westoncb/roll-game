import { mat2d, vec2, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import { angleDifference } from "./math";

export class Transform2D {
  readonly position = vec2.create();
  /** Radians, including full turns. Use setOrientation for wrapped angles. */
  rotation = 0;
  readonly scale = vec2.fromValues(1, 1);

  constructor(readonly parent: Transform2D | null = null) {}

  setOrientation(angle: number) {
    this.rotation += angleDifference(this.rotation, angle);
  }

  /** Map local coordinates into world space at the current simulation pose. */
  worldMatrix(out = mat2d.create()): mat2d {
    if (this.parent) this.parent.worldMatrix(out);
    else mat2d.identity(out);
    return appendTransform(out, this.position, this.rotation, this.scale);
  }

  localToWorld(point: ReadonlyVec2, out = vec2.create()) {
    return vec2.transformMat2d(out, point, this.worldMatrix());
  }

  worldToLocal(point: ReadonlyVec2, out = vec2.create()) {
    const matrix = this.worldMatrix();
    if (!mat2d.invert(matrix, matrix))
      throw new RangeError("Cannot invert a singular transform.");
    return vec2.transformMat2d(out, point, matrix);
  }
}

export function appendTransform(
  matrix: mat2d,
  position: ReadonlyVec2,
  rotation: number,
  scale: ReadonlyVec2
) {
  mat2d.translate(matrix, matrix, position);
  mat2d.rotate(matrix, matrix, rotation);
  return mat2d.scale(matrix, matrix, scale);
}

export function applyMatrix(ctx: CanvasRenderingContext2D, matrix: ReadonlyMat2d) {
  const [a, b, c, d, x, y] = matrix;
  ctx.transform(a, b, c, d, x, y);
}

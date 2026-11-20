import { vec2 } from "gl-matrix";
import { nearestBoundary, sweepCircle } from "../engine/collision";
import type { GroundPolygon } from "../engine/ground";

/** The level rectangle minus its ground polygons, including the width of growing tissue. */
export class GrowthDomain {
  private readonly obstacles;
  constructor(
    private readonly width: number,
    private readonly height: number,
    ground: GroundPolygon[]
  ) {
    this.obstacles = ground.map((polygon) => {
      const min = vec2.fromValues(Infinity, Infinity),
        max = vec2.fromValues(-Infinity, -Infinity);
      for (const p of polygon.vertices) {
        vec2.min(min, min, p);
        vec2.max(max, max, p);
      }
      return { polygon, min, max };
    });
  }

  clear(a: vec2, b: vec2, r: number) {
    const x0 = Math.min(a[0], b[0]) - r,
      y0 = Math.min(a[1], b[1]) - r;
    const x1 = Math.max(a[0], b[0]) + r,
      y1 = Math.max(a[1], b[1]) + r;
    if (x0 < 0 || y0 < 0 || x1 > this.width || y1 > this.height) return false;
    for (const { polygon, min, max } of this.obstacles) {
      if (x0 > max[0] || y0 > max[1] || x1 < min[0] || y1 < min[1]) continue;
      if (nearestBoundary(a, polygon).distance <= r) return false;
      if (sweepCircle(a, r, vec2.subtract(vec2.create(), b, a), [polygon])) return false;
    }
    return true;
  }
}

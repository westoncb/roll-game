import type { ReadonlyVec2 } from "gl-matrix";
import type { Shape2D } from "../../engine/shape";

function borderVertices(shape: Shape2D): readonly ReadonlyVec2[] {
  if (shape.kind === "polygon") return shape.vertices;
  const left = Math.min(shape.x, shape.x + shape.width),
    right = left + Math.abs(shape.width);
  const top = Math.min(shape.y, shape.y + shape.height),
    bottom = top + Math.abs(shape.height);
  const r = Math.min(shape.cornerRadius ?? 0, (right - left) / 2, (bottom - top) / 2);
  if (!r)
    return [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom]
    ];
  const points: ReadonlyVec2[] = [];
  const centers = [
    [right - r, top + r],
    [right - r, bottom - r],
    [left + r, bottom - r],
    [left + r, top + r]
  ];
  for (const [corner, [x, y]] of centers.entries()) {
    for (let i = 0; i <= 4; i++) {
      const angle = ((corner - 1 + i / 4) * Math.PI) / 2;
      points.push([x + r * Math.cos(angle), y + r * Math.sin(angle)]);
    }
  }
  return points;
}

interface BoundaryEdge {
  length: number;
  /** Maps (distance along the edge, distance outward) into shape coordinates. */
  transform: DOMMatrix;
}

function boundaryEdges(points: readonly ReadonlyVec2[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  const edges: BoundaryEdge[] = [];
  if (!area) return edges;
  const ordered = area < 0 ? [...points].reverse() : points;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i],
      b = ordered[(i + 1) % ordered.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const tx = dx / length,
      ty = dy / length;
    edges.push({ length, transform: new DOMMatrix([tx, ty, ty, -tx, a[0], a[1]]) });
  }
  return edges;
}

/** Keep the paths for each drawable seed until the underlying shape changes. */
export function boundaryArtwork<T>(
  build: (edges: readonly BoundaryEdge[], seed: number, shape: Shape2D) => T
) {
  const cache = new WeakMap<
    Shape2D,
    {
      points: readonly ReadonlyVec2[];
      edges: BoundaryEdge[];
      variants: Map<number, T>;
    }
  >();
  return (shape: Shape2D, seed: number) => {
    const points = borderVertices(shape);
    let saved = cache.get(shape);
    if (
      !saved ||
      saved.points.length !== points.length ||
      !saved.points.every(([x, y], i) => x === points[i][0] && y === points[i][1])
    ) {
      saved = {
        points: points.map(([x, y]) => [x, y]),
        edges: boundaryEdges(points),
        variants: new Map()
      };
      cache.set(shape, saved);
    }
    let art = saved.variants.get(seed);
    if (art === undefined) {
      art = build(saved.edges, seed, shape);
      saved.variants.set(seed, art);
    }
    return art;
  };
}

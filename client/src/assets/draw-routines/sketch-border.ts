import type { ReadonlyVec2 } from "gl-matrix";
import { defineDrawRoutine, shapePath } from "../../engine/draw-routines";
import { lerp } from "../../engine/math";
import type { Shape2D } from "../../engine/shape";
import { checkFields, color, positive, seededRandom } from "./brush-settings";

function charcoalGrain(ctx: CanvasRenderingContext2D, pigment: string) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 64;
  const paper = tile.getContext("2d")!;
  const random = seededRandom(0x746f6f74);
  paper.fillStyle = pigment;
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      paper.globalAlpha = random() ** 0.8;
      paper.fillRect(x, y, 1, 1);
    }
  }
  return ctx.createPattern(tile, "repeat")!;
}

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

function sketch(
  points: readonly ReadonlyVec2[],
  width: number,
  reach: number,
  seed: number
) {
  const charcoal = new Path2D(),
    rub = new Path2D(),
    tooth = new Path2D(),
    scratches = new Path2D();
  const random = seededRandom(Math.imul(seed + 1, 0x9e3779b1));
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  if (points.length < 3 || !area) return { charcoal, rub, tooth, scratches };

  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!length) continue;
    const tx = (b[0] - a[0]) / length,
      ty = (b[1] - a[1]) / length;
    const nx = ty * Math.sign(area),
      ny = -tx * Math.sign(area);
    // Work in the edge's own axes. A chisel breaks contact, crosses the edge,
    // or runs past a corner according to the two offsets and the stroke length.
    function mark(
      path: Path2D,
      start: number,
      run: number,
      from: number,
      to: number,
      weight: number
    ) {
      const x = a[0] + start * tx,
        y = a[1] + start * ty;
      const middle = 0.32 + random() * 0.33;
      const offset = lerp(from, to, middle) + weight * (random() - 0.5);
      path.moveTo(x + nx * from, y + ny * from);
      path.lineTo(
        x + tx * run * middle + nx * (offset + weight),
        y + ty * run * middle + ny * (offset + weight)
      );
      path.lineTo(x + tx * run + nx * to, y + ty * run + ny * to);
      path.lineTo(
        x + tx * run * 0.35 + nx * (lerp(from, to, 0.35) - weight * 0.6),
        y + ty * run * 0.35 + ny * (lerp(from, to, 0.35) - weight * 0.6)
      );
      path.closePath();
    }

    const spacing = Math.max(width * 2.6, length / 768);
    let start = -Math.min(reach * random(), length * 0.12);
    while (start < length) {
      const run = Math.min(
        spacing * (0.7 + 2.8 * random()),
        length - start + reach * random()
      );
      const from = width * (random() * 2.6 - 1.9);
      const to = (random() ** 2 * 1.5 - 0.45) * reach;
      const weight = width * (0.38 + random() * 0.72);
      if (random() < 0.5) mark(charcoal, start, run, from, to, weight);
      else mark(charcoal, start, run, to, from, weight);
      // Broken, lighter facets make the contact surface readable against the sky.
      if (random() < 0.52 - ny * 0.24) {
        mark(
          rub,
          start - width,
          run * (0.5 + random() * 0.65),
          from - width * 0.24,
          to - width * 0.1,
          width * (0.15 + random() * 0.3)
        );
      }
      // Clusters of dry parallel slivers leave strips of bare rock between them.
      if (random() < 0.32) {
        const inset = -width * (0.8 + random() * 1.8);
        for (let j = 0; j < 3; j++) {
          const drift = j * width * 0.4;
          mark(
            tooth,
            start + random() * width,
            run * (0.28 + random() * 0.6),
            inset + drift,
            to + drift,
            width * (0.04 + random() * 0.08)
          );
        }
        // A longer scratch cuts across the shorter rubbings and overshoots its end.
        const drag = Math.min(run * (1.2 + random()), length - start + reach);
        const tip = to + (random() - 0.45) * reach;
        scratches.moveTo(a[0] + tx * start + nx * inset, a[1] + ty * start + ny * inset);
        scratches.lineTo(
          a[0] + tx * (start + drag * 0.42) + nx * from,
          a[1] + ty * (start + drag * 0.42) + ny * from
        );
        scratches.lineTo(
          a[0] + tx * (start + drag) + nx * tip,
          a[1] + ty * (start + drag) + ny * tip
        );
      }
      start += spacing * (0.55 + random());
    }
  }
  return { charcoal, rub, tooth, scratches };
}

export const sketchBorder = defineDrawRoutine(
  (call, source) => {
    checkFields(call, ["width", "reach", "ink", "highlight"], source);
    const width = positive(call, "width", source),
      reach = positive(call, "reach", source);
    const ink = color(call, "ink", source),
      highlight = color(call, "highlight", source);
    const cache = new WeakMap<
      Shape2D,
      {
        points: readonly ReadonlyVec2[];
        contour: Path2D;
        variants: Map<number, ReturnType<typeof sketch>>;
      }
    >();
    let graphite: CanvasPattern | undefined, chalk: CanvasPattern | undefined;
    return {
      width,
      ink,
      graphite(ctx: CanvasRenderingContext2D) {
        return (graphite ??= charcoalGrain(ctx, ink));
      },
      chalk(ctx: CanvasRenderingContext2D) {
        return (chalk ??= charcoalGrain(ctx, highlight));
      },
      drawing(shape: Shape2D, seed: number) {
        const points = borderVertices(shape);
        let saved = cache.get(shape);
        if (
          !saved ||
          saved.points.length !== points.length ||
          !saved.points.every(([x, y], i) => x === points[i][0] && y === points[i][1])
        ) {
          saved = {
            points: points.map(([x, y]) => [x, y]),
            contour: shapePath(shape),
            variants: new Map()
          };
          cache.set(shape, saved);
        }
        let paths = saved.variants.get(seed);
        if (!paths) {
          paths = sketch(points, width, reach, seed);
          saved.variants.set(seed, paths);
        }
        return { contour: saved.contour, ...paths };
      }
    };
  },
  (ctx, shape, settings, frame) => {
    const { contour, charcoal, rub, tooth, scratches } = settings.drawing(
      shape,
      frame.seed
    );
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // A solid closed core joins every corner; only the outer rubbings are broken.
    ctx.lineWidth = settings.width * 0.65;
    ctx.strokeStyle = settings.ink;
    ctx.stroke(contour);
    ctx.lineWidth = settings.width * 1.55;
    ctx.strokeStyle = settings.graphite(ctx);
    ctx.stroke(contour);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill(charcoal);
    ctx.fillStyle = settings.chalk(ctx);
    ctx.fill(rub);
    ctx.globalAlpha *= 0.63;
    ctx.fill(tooth);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = settings.width * 0.19;
    ctx.stroke(scratches);
  }
);

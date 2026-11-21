import type { DrawRoutine, RoutineSettings } from "../../engine/draw-routines";
import { lerp, tau } from "../../utils/math";
import { boundaryArtwork, deformFromEdge } from "./boundary";
import {
  checkFields,
  color,
  fraction,
  positive,
  positiveRange,
  seededRandom
} from "./brush-settings";

interface FungalColony {
  edge: DOMMatrix;
  phase: number;
  rate: number;
  roots: Path2D;
  threads: Path2D;
  sacs: Path2D;
  glints: Path2D;
}

export function fungalStrands(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(
    settings,
    [
      "width",
      "height",
      "spacing",
      "pixelSize",
      "shadow",
      "filament",
      "leaf",
      "spore",
      "highlight",
      "pulse",
      "sway"
    ],
    source
  );
  const [minWidth, maxWidth] =
    settings.width === undefined ? [64, 64] : positiveRange(settings, "width", source);
  const [minHeight, maxHeight] = positiveRange(settings, "height", source);
  const spacing = positive(settings, "spacing", source);
  // Maximum change in a colony's depth as a fraction of its resting depth.
  const pulse = settings.pulse === undefined ? 0 : fraction(settings, "pulse", source);
  // Sideways travel along the ledge, also measured as a fraction of depth.
  const sway = settings.sway === undefined ? 0 : fraction(settings, "sway", source);
  const pixel =
    settings.pixelSize === undefined ? 2 : positive(settings, "pixelSize", source);
  const shadow = color(settings, "shadow", source);
  const filament = color(
    settings,
    settings.filament === undefined && "leaf" in settings ? "leaf" : "filament",
    source
  );
  const highlight = color(settings, "highlight", source);
  const spore = settings.spore === undefined ? highlight : color(settings, "spore", source);

  const artwork = boundaryArtwork((edges, seed) => {
    // Build in whole pixels in shape space so even the growth on sloping rock has square steps.
    const colonies: FungalColony[] = [];
    const random = seededRandom(Math.imul(seed + 1, 0x85ebca6b));
    const rhythm = seededRandom(Math.imul(seed + 1, 0x9e3779b1));

    for (const { length, transform } of edges) {
      const onTop = transform.d < -0.45;
      const side = onTop ? -1 : 1;
      const interval = Math.max(spacing * (onTop ? 2.1 : 1), length / 256);
      const maxSpread = Math.min(maxWidth / 2, length / 4);
      if (maxSpread < 3 * pixel) continue;

      // Across a floor lip the growth folds down onto the rock. Elsewhere it creeps outside.
      function cell(along: number, depth: number) {
        return [
          Math.round(
            (transform.e + along * transform.a + side * depth * transform.c) / pixel
          ),
          Math.round(
            (transform.f + along * transform.b + side * depth * transform.d) / pixel
          )
        ] as const;
      }

      function thread(
        from: number,
        to: number,
        rootDepth: number,
        bow: number,
        tipDepth: number,
        pigment: Path2D
      ) {
        const travel =
          Math.abs(to - from) + Math.abs(bow - rootDepth) + Math.abs(tipDepth - bow);
        const steps = Math.max(1, Math.min(256, Math.ceil((2 * travel) / pixel)));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps,
            u = 1 - t;
          const [x, y] = cell(
            from + (to - from) * t,
            u * u * rootDepth + 2 * u * t * bow + t * t * tipDepth
          );
          pigment.rect(x, y, 1, 1);
        }
      }

      for (
        let patchStart = random() * interval * 0.75;
        patchStart < length;
        patchStart += interval * (0.65 + random() * 0.95)
      ) {
        const spread = Math.min(lerp(minWidth, maxWidth, random()) / 2, maxSpread);
        if (spread < 3 * pixel || patchStart + 2 * spread > length) continue;
        // A still style can paint every colony in one pass.
        if (pulse || sway || !colonies.length) {
          colonies.push({
            edge: transform,
            phase: rhythm() * tau,
            rate: tau / (3.9 + 1.6 * rhythm()),
            roots: new Path2D(),
            threads: new Path2D(),
            sacs: new Path2D(),
            glints: new Path2D()
          });
        }
        const { roots, threads, sacs, glints } = colonies[colonies.length - 1];
        const center = patchStart + spread;
        const height = lerp(minHeight, maxHeight, random());
        // The sampled height includes the square pixels and spore sacs at the tips.
        const depth = Math.max(0, height - 3 * pixel) * (onTop ? 0.65 : 1);
        const rootVariation = Math.min(2 * pixel, depth * 0.35);
        const sections = Math.max(2, Math.min(9, Math.round((2 * spread) / (6 * pixel))));
        let start = patchStart;
        let rootDepth = 0;
        for (let i = 1; i <= sections; i++) {
          const t = i === sections ? 1 : (i - 0.25 + random() * 0.5) / sections;
          const end = center + (2 * t - 1) * spread;
          const nextDepth = i === sections ? 0 : (random() - 0.25) * rootVariation;
          const ridge = Math.min(pixel, depth) * random();
          thread(start, end, rootDepth + ridge, ridge, nextDepth + ridge, roots);
          thread(start, end, rootDepth, ridge, nextDepth, threads);

          // A filament runs along the ledge, either rooting again or ending in a small sac.
          const [from, to, fromDepth, toDepth] =
            random() < 0.5
              ? [start, end, rootDepth, nextDepth]
              : [end, start, nextDepth, rootDepth];
          const rooted = random() < 0.45;
          const tip = rooted ? to : from + (to - from) * (0.45 + 0.5 * random());
          const tipDepth = rooted ? toDepth : depth * (0.45 + random() * 0.55);
          thread(
            from,
            tip,
            fromDepth,
            depth * (0.6 + random() * 0.4),
            tipDepth,
            random() < 0.35 ? roots : threads
          );
          if (!rooted) {
            const [x, y] = cell(tip, tipDepth);
            roots.rect(x - 1, y, 3, 2);
            sacs.rect(x - 1, y, 2, 1);
            if (random() < 0.65) glints.rect(x - 1, y, 1, 1);
          }
          start = end;
          rootDepth = nextDepth;
        }
      }
    }
    return colonies;
  });

  return (ctx, shape, frame) => {
    for (const colony of artwork(shape, frame.seed)) {
      ctx.save();
      const phase = frame.time * colony.rate + colony.phase;
      const breath = Math.sin(phase);
      if (pulse || sway) {
        // A quarter-cycle offset makes the tips trace a small oval.
        const { a, b, c, d } = colony.edge;
        const swing = sway * Math.cos(phase);
        const stretch = pulse * breath;
        deformFromEdge(ctx, colony.edge, swing * a + stretch * c, swing * b + stretch * d);
      }
      ctx.scale(pixel, pixel);
      ctx.fillStyle = shadow;
      ctx.fill(colony.roots);
      ctx.fillStyle = filament;
      ctx.fill(colony.threads);
      ctx.fillStyle = spore;
      ctx.fill(colony.sacs);
      if (pulse) {
        // At full extension, filaments take on the spore color and sacs catch the light.
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha *= (Math.min(1, 3 * pulse) * (1 + breath)) / 2;
        ctx.fill(colony.threads);
        ctx.fillStyle = highlight;
        ctx.fill(colony.sacs);
        ctx.globalAlpha = alpha;
      }
      ctx.fillStyle = highlight;
      ctx.fill(colony.glints);
      ctx.restore();
    }
  };
}

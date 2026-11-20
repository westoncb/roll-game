import type { DrawRoutine, RoutineSettings } from "../../engine/draw-routines";
import { boundaryArtwork } from "./boundary";
import { checkFields, color, positive, seededRandom } from "./brush-settings";

export function fungalStrands(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(
    settings,
    ["height", "spacing", "pixelSize", "shadow", "filament", "leaf", "spore", "highlight"],
    source
  );
  const height = positive(settings, "height", source);
  const spacing = positive(settings, "spacing", source);
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
    const roots = new Path2D(),
      threads = new Path2D(),
      sacs = new Path2D(),
      glints = new Path2D();
    const random = seededRandom(Math.imul(seed + 1, 0x85ebca6b));

    function sporeSac(x: number, y: number, size: number) {
      roots.rect(x - 1, y, 3, size + 3);
      roots.rect(x - size, y + 1, 2 * size + 1, size + 1);
      sacs.rect(x - size, y + 1, 2 * size, size + 1);
      sacs.rect(x, y, 1, 1);
      if (random() < 0.72) glints.rect(x - size, y + 1, 1, 1);
    }

    function strand(x: number, y: number, rows: number, lean: number) {
      const bend = (random() - 0.5) * rows * 0.42;
      const shaded = random() < 0.35;
      const fork =
        rows >= 10 && random() < 0.45 ? Math.floor(rows * (0.35 + random() * 0.25)) : -1;
      let previous = x;
      for (let row = 0; row < rows; row++) {
        const t = (row + 1) / rows;
        const column = x + Math.round(lean * t * (2 - t) + 4 * bend * t * (1 - t));
        const left = Math.min(previous, column);
        const width = Math.abs(previous - column) + 1;
        roots.rect(left, y + row, width + (t < 0.45 ? 1 : 0), 1);
        if (!shaded || row > rows * 0.7) threads.rect(left, y + row, width, 1);
        if (row === fork) {
          const side = random() < 0.5 ? -1 : 1;
          const branch = 3 + Math.floor(random() * 4);
          for (let j = 0; j < branch; j++)
            threads.rect(column + side * Math.ceil(j / 2), y + row + j, 1, 1);
          sporeSac(column + side * Math.ceil((branch - 1) / 2), y + row + branch, 1);
        }
        previous = column;
      }
      if (random() < 0.63) sporeSac(previous, y + rows - 1, random() < 0.28 ? 2 : 1);
    }

    for (const { length, transform } of edges) {
      const onTop = transform.d < -0.45;
      const interval = Math.max(spacing * (onTop ? 2.1 : 1), length / 256);
      const halfPatch = Math.min(height * 0.42, length * 0.25);
      let center = halfPatch + random() * interval * 0.75;
      while (center < length - halfPatch) {
        const spread = halfPatch * (0.5 + random() * 0.5);
        const drop = (height / pixel) * (onTop ? 0.42 : 1) * (0.6 + random() * 0.7);
        const count = 3 + Math.floor(random() * 3);
        const longest = Math.floor(random() * count);
        // A stepped shelf of tissue ties the filaments to one patch of rock.
        const steps = Math.min(64, Math.max(1, Math.ceil((2 * spread) / pixel)));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const distance = center + (2 * t - 1) * spread;
          const lip = pixel * 1.6 * 4 * t * (1 - t);
          const x = Math.round(
            (transform.e + distance * transform.a + lip * transform.c) / pixel
          );
          const y = Math.round(
            (transform.f + distance * transform.b + lip * transform.d) / pixel
          );
          roots.rect(x - 1, y, 3, 2);
          threads.rect(x, y, 2, 1);
        }
        for (let j = 0; j < count; j++) {
          const fan = (2 * (j + random() * 0.6)) / count - 1;
          const distance = center + fan * spread;
          const x = Math.round((transform.e + distance * transform.a) / pixel);
          const y = Math.round((transform.f + distance * transform.b) / pixel);
          const rows = Math.min(
            96,
            Math.max(2, Math.round(drop * (j === longest ? 1.35 : 0.28 + random() * 0.64)))
          );
          // Filaments leave walls sideways near the root and turn down under their own weight.
          const lean = rows * (transform.c * 0.42 + fan * 0.15 + (random() - 0.5) * 0.25);
          strand(x, y, rows, lean);
        }
        center += interval * (0.65 + random() * 0.95);
      }
    }
    return { roots, threads, sacs, glints };
  });

  return (ctx, shape, frame) => {
    const { roots, threads, sacs, glints } = artwork(shape, frame.seed);
    ctx.scale(pixel, pixel);
    ctx.fillStyle = shadow;
    ctx.fill(roots);
    ctx.fillStyle = filament;
    ctx.fill(threads);
    ctx.fillStyle = spore;
    ctx.fill(sacs);
    ctx.fillStyle = highlight;
    ctx.fill(glints);
  };
}

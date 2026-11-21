import type { DrawRoutine, RoutineSettings } from "../../engine/draw-routines";
import { lerp } from "../../utils/math";
import { boundaryArtwork } from "./boundary";
import {
  checkFields,
  color,
  positive,
  positiveRange,
  seededRandom
} from "./brush-settings";
import {
  drawTerrainStamps,
  mushrooms,
  pebbles,
  terrainStamp,
  type TerrainStamp
} from "./terrain-sprites";

export function surfaceDetails(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(
    settings,
    ["spacing", "size", "shadow", "stone", "light", "cap", "stem"],
    source
  );
  const spacing = positive(settings, "spacing", source);
  const [minSize, maxSize] = positiveRange(settings, "size", source);
  const shadow = color(settings, "shadow", source);
  const stone = color(settings, "stone", source);
  const stamp = terrainStamp(
    {
      a: shadow,
      d: shadow,
      s: stone,
      h: color(settings, "light", source),
      c: color(settings, "cap", source),
      t: color(settings, "stem", source),
      p: stone
    },
    0.9
  );

  const artwork = boundaryArtwork((edges, seed) => {
    const random = seededRandom(Math.imul(seed + 1, 0xc2b2ae35));
    const stamps: TerrainStamp[] = [];
    for (const { length, transform } of edges) {
      if (transform.d > -0.65) continue;
      const interval = Math.max(spacing, length / 256);
      let left = random() * interval * 0.7;
      while (left < length) {
        const size = lerp(minSize, maxSize, random());
        if (left + size > length) break;
        const at = left + size / 2;
        const isMushroom = random() < 0.46;
        const variants = isMushroom ? mushrooms : pebbles;
        const sprite = variants[Math.floor(random() * variants.length)];
        const slope = (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
        const x = transform.e + at * transform.a,
          y = transform.f + at * transform.b;
        stamps.push(
          stamp(sprite, x, y, size, slope * (isMushroom ? 0.25 : 1), random() < 0.5)
        );
        left += Math.max(size + 2, interval * (0.7 + random() * 0.8));
      }
    }
    return stamps;
  });

  return (ctx, shape, frame) => drawTerrainStamps(ctx, artwork(shape, frame.seed));
}

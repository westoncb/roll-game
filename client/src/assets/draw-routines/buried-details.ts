import {
  shapePath,
  type DrawRoutine,
  type RoutineSettings
} from "../../engine/draw-routines";
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
  bones,
  buriedRocks,
  drawTerrainStamps,
  terrainStamp,
  type TerrainStamp
} from "./terrain-sprites";

export function buriedDetails(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(settings, ["spacing", "size", "shadow", "stone", "light", "bone"], source);
  const spacing = positive(settings, "spacing", source);
  const [minSize, maxSize] = positiveRange(settings, "size", source);
  const shadow = color(settings, "shadow", source);
  const stamp = terrainStamp(
    {
      a: shadow,
      d: shadow,
      s: color(settings, "stone", source),
      h: color(settings, "light", source),
      b: color(settings, "bone", source)
    },
    0.5
  );

  // Test centres in shape coordinates, independent of the drawable's canvas transform.
  let probe: CanvasRenderingContext2D | undefined;
  const artwork = boundaryArtwork((edges, seed, shape) => {
    const contour = shapePath(shape);
    const stamps: TerrainStamp[] = [];
    if (!edges.length) return { contour, stamps };
    probe ??= document.createElement("canvas").getContext("2d")!;
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const { transform } of edges) {
      left = Math.min(left, transform.e);
      right = Math.max(right, transform.e);
      top = Math.min(top, transform.f);
      bottom = Math.max(bottom, transform.f);
    }
    const random = seededRandom(Math.imul(seed + 1, 0x94d049bb));
    const columns = Math.max(1, Math.min(64, Math.round((right - left) / spacing)));
    const rows = Math.max(1, Math.min(64, Math.round((bottom - top) / spacing)));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const x = left + ((col + 0.1 + random() * 0.8) * (right - left)) / columns;
        const y = top + ((row + 0.1 + random() * 0.8) * (bottom - top)) / rows;
        if (!probe.isPointInPath(contour, x, y)) continue;
        const isBone = random() < 0.27;
        const variants = isBone ? bones : buriedRocks;
        const sprite = variants[Math.floor(random() * variants.length)];
        const size = lerp(minSize, maxSize, random());
        const tilt = (random() - 0.5) * (isBone ? 70 : 46);
        stamps.push(stamp(sprite, x, y, size, tilt, random() < 0.5));
      }
    }
    return { contour, stamps };
  });

  return (ctx, shape, frame) => {
    const { contour, stamps } = artwork(shape, frame.seed);
    if (!stamps.length) return;
    ctx.clip(contour);
    ctx.globalAlpha *= 0.76;
    drawTerrainStamps(ctx, stamps);
  };
}

import { defineDrawRoutine, shapePath } from "../../engine/draw-routines";
import { lerp, tau } from "../../engine/math";
import { checkFields, color, positive, seededRandom } from "./brush-settings";

const tileSize = 384;

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

/** Periodic value noise. Different lattice proportions give broad pockets and thin beds. */
function noise(columns: number, rows: number, random: () => number, faceted = false) {
  const values = Float32Array.from({ length: columns * rows }, random);
  return (u: number, v: number) => {
    const x = (u - Math.floor(u)) * columns;
    const y = (v - Math.floor(v)) * rows;
    const col = Math.floor(x),
      row = Math.floor(y);
    const next = (col + 1) % columns;
    const top = row * columns,
      bottom = ((row + 1) % rows) * columns;
    const dx = x - col,
      dy = y - row;
    if (faceted) {
      // Planar interpolation across each triangular face gives the ore angular breaks.
      const a = values[top + col],
        b = values[top + next];
      const c = values[bottom + col],
        d = values[bottom + next];
      return dx + dy < 1
        ? a + dx * (b - a) + dy * (c - a)
        : d + (1 - dx) * (c - d) + (1 - dy) * (b - d);
    }
    const sx = dx * dx * (3 - 2 * dx),
      sy = dy * dy * (3 - 2 * dy);
    return lerp(
      lerp(values[top + col], values[top + next], sx),
      lerp(values[bottom + col], values[bottom + next], sx),
      sy
    );
  };
}

function bakeDirt(shadow: string, soil: string, oxide: string, mineral: string) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = tileSize;
  const ctx = tile.getContext("2d")!;
  const pixels = ctx.createImageData(tileSize, tileSize);
  const random = seededRandom(0x91f3d2);
  const pockets = noise(5, 5, random);
  const shale = noise(12, 32, random);
  const fracture = noise(13, 19, random, true);
  const grit = noise(84, 95, random);
  const dark = rgb(shadow),
    light = rgb(soil),
    rust = rgb(oxide),
    ore = rgb(mineral);
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const u = x / tileSize,
        v = y / tileSize;
      const pocket = pockets(u, v);
      const bed = shale(u, v + 0.11 * pocket);
      const grain = grit(u, v);
      const bands = Math.sin(tau * (3 * u + 13 * v + 1.45 * pocket + 0.26 * bed));
      const tone =
        0.13 +
        0.38 * pocket +
        0.28 * bed +
        0.12 * bands +
        0.32 * (grain - 0.5) +
        0.23 * (random() - 0.5);
      const oxidation =
        Math.min(0.62, Math.max(0, (0.52 - pocket) * 1.6 + 0.18 * bands)) * bed;
      // Mineral collects in narrow, broken veins within the brighter beds.
      const fault = fracture(u + bed * 0.012, v + pocket * 0.04) + (grain - 0.5) * 0.024;
      const vein =
        Math.max(0, 1 - 52 * Math.abs(fault - 0.52)) *
        Math.min(1, Math.max(0, (bed + grain * 0.35 - 0.5) * 2.6));
      const index = 4 * (y * tileSize + x);
      for (let c = 0; c < 3; c++) {
        const base = lerp(dark[c], light[c], tone);
        pixels.data[index + c] = lerp(lerp(base, rust[c], oxidation), ore[c], vein * 0.93);
      }
      pixels.data[index + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);

  // Flat, split-faced inclusions catch the light. Wrap their tips across tile edges.
  for (let i = 0; i < 380; i++) {
    const x = random() * tileSize,
      y = random() * tileSize;
    const length = 1.3 + random() ** 3 * 12,
      height = 0.6 + random() * 1.7;
    const tilt = (random() - 0.72) * length * 0.65;
    const face = random() < 0.2 ? mineral : random() < 0.35 ? oxide : soil;
    for (const ox of [0, -tileSize]) {
      if (ox && x + length < tileSize) continue;
      for (const oy of [0, tileSize, -tileSize]) {
        if (oy > 0 && y + Math.min(0, tilt) - height > 0) continue;
        if (oy < 0 && y + Math.max(0, tilt) + height < tileSize) continue;
        const px = x + ox,
          py = y + oy;
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + length * 0.6, py + tilt * 0.6 - height);
        ctx.lineTo(px + length, py + tilt);
        ctx.lineTo(px + length * 0.28, py + tilt * 0.28 + height);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + length * 0.6, py + tilt * 0.6 - height);
        ctx.lineTo(px + length, py + tilt);
        ctx.fill();
      }
    }
  }
  return tile;
}

export const sciFiDirt = defineDrawRoutine(
  (call, source) => {
    checkFields(call, ["shadow", "soil", "oxide", "mineral", "scale"], source);
    const shadow = color(call, "shadow", source);
    const soil = color(call, "soil", source);
    const oxide = color(call, "oxide", source);
    const mineral = color(call, "mineral", source);
    const scale = positive(call, "scale", source);
    let pattern: CanvasPattern | null = null;
    return {
      scale,
      pattern(ctx: CanvasRenderingContext2D) {
        return (pattern ??= ctx.createPattern(
          bakeDirt(shadow, soil, oxide, mineral),
          "repeat"
        )!);
      }
    };
  },
  (ctx, shape, settings, frame) => {
    const pattern = settings.pattern(ctx);
    const scale = settings.scale;
    const angle = 0.12 + 0.24 * Math.sin(frame.seed * 1.83);
    const a = scale * Math.cos(angle),
      b = scale * Math.sin(angle);
    // Sample different parts of the same seamless rock bed on each drawable.
    pattern.setTransform({
      a,
      b,
      c: -b,
      d: a,
      e: (Math.imul(frame.seed, 137) % tileSize) * scale,
      f: (Math.imul(frame.seed, 83) % tileSize) * scale
    });
    ctx.fillStyle = pattern;
    ctx.fill(shapePath(shape));
  }
);

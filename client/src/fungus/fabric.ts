import { vec2 } from "gl-matrix";
import { fiberColorSteps, type ColonyTuning } from "./config";
import { type Stretch, type FiberSegment, type Strand } from "./network";
import type { ColonyPalette } from "./palette";

const tileSize = 48;
const tileScale = 2;
type Damage = { left: number; top: number; right: number; bottom: number };
type Tile = {
  x: number;
  y: number;
  ctx: CanvasRenderingContext2D;
  segments: Set<FiberSegment>; // Deposition order, including ash until it crumbles.
  main: Set<FiberSegment>;
  mainDensity: number;
  minorDensity: number;
  damage?: Damage;
};

function tileSurface() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = tileSize * tileScale;
  const ctx = canvas.getContext("2d")!;
  ctx.lineCap = "round";
  return ctx;
}

function tileKey(x: number, y: number) {
  return x + "," + y;
}

// Snap damage outwards and include the antialias fringe of both old and new strokes.
// Coordinates stay in world space, including on tiles whose origin is nonzero.
function invalidate(tile: Tile, s: FiberSegment) {
  const x = tile.x * tileSize,
    y = tile.y * tileSize;
  const pad = s.radius + 1;
  const left = Math.max(x, Math.floor(Math.min(s.a[0], s.b[0]) - pad));
  const top = Math.max(y, Math.floor(Math.min(s.a[1], s.b[1]) - pad));
  const right = Math.min(x + tileSize, Math.ceil(Math.max(s.a[0], s.b[0]) + pad));
  const bottom = Math.min(y + tileSize, Math.ceil(Math.max(s.a[1], s.b[1]) + pad));
  const d = tile.damage;
  if (d) {
    d.left = Math.min(d.left, left);
    d.top = Math.min(d.top, top);
    d.right = Math.max(d.right, right);
    d.bottom = Math.max(d.bottom, bottom);
  } else tile.damage = { left, top, right, bottom };
}

function overlapsDamage(s: FiberSegment, d: Damage) {
  const pad = s.radius + 1;
  return (
    Math.min(s.a[0], s.b[0]) - pad < d.right &&
    Math.max(s.a[0], s.b[0]) + pad > d.left &&
    Math.min(s.a[1], s.b[1]) - pad < d.bottom &&
    Math.max(s.a[1], s.b[1]) + pad > d.top
  );
}

function stroke(
  ctx: CanvasRenderingContext2D,
  s: FiberSegment,
  color: string,
  width: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(s.a[0], s.a[1]);
  ctx.lineTo(s.b[0], s.b[1]);
  ctx.stroke();
}

export class FungalFabric {
  readonly bounds = {
    min: vec2.fromValues(Infinity, Infinity),
    max: vec2.fromValues(-Infinity, -Infinity)
  };
  private patchSurface?: CanvasRenderingContext2D;
  private readonly tiles = new Map<string, Tile>();
  constructor(
    private readonly palette: ColonyPalette,
    private readonly tuning: Readonly<ColonyTuning>,
    private readonly releaseAsh?: (position: vec2, amount: number) => void
  ) {}

  enclose(p: vec2, r: number) {
    const { min, max } = this.bounds;
    min[0] = Math.min(min[0], p[0] - r);
    min[1] = Math.min(min[1], p[1] - r);
    max[0] = Math.max(max[0], p[0] + r);
    max[1] = Math.max(max[1], p[1] + r);
  }

  private tile(x: number, y: number) {
    const key = tileKey(x, y);
    let tile = this.tiles.get(key);
    if (!tile) {
      const ctx = tileSurface();
      ctx.setTransform(
        tileScale,
        0,
        0,
        tileScale,
        -tileScale * x * tileSize,
        -tileScale * y * tileSize
      );
      tile = {
        x,
        y,
        ctx,
        segments: new Set(),
        main: new Set(),
        mainDensity: 0,
        minorDensity: 0
      };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  density(p: vec2, kind: Strand["kind"]) {
    const tile = this.tiles.get(
      tileKey(Math.floor(p[0] / tileSize), Math.floor(p[1] / tileSize))
    );
    return kind === "main" ? (tile?.mainDensity ?? 0) : (tile?.minorDensity ?? 0);
  }

  crowded(p: vec2, kind: Strand["kind"]) {
    const limit =
      kind === "main" ? this.tuning.mainSegmentsPerTile : this.tuning.minorSegmentsPerTile;
    return this.density(p, kind) >= limit;
  }

  private *segmentTiles(s: FiberSegment) {
    // Index the widest possible healthy silhouette. Growth checks this same clearance.
    const { a, b, radius: r } = s;
    for (
      let y = Math.floor((Math.min(a[1], b[1]) - r) / tileSize);
      y <= Math.floor((Math.max(a[1], b[1]) + r) / tileSize);
      y++
    )
      for (
        let x = Math.floor((Math.min(a[0], b[0]) - r) / tileSize);
        x <= Math.floor((Math.max(a[0], b[0]) + r) / tileSize);
        x++
      )
        yield this.tile(x, y);
  }

  private color(s: FiberSegment) {
    if (s.owner.dead) return this.palette.ash;
    if (this.tuning.showNutrientSupply) return this.palette.supply[s.owner.supplyBand];
    return this.palette.tissue[s.strand.kind][s.owner.healthBand];
  }

  deposit(
    a: vec2,
    b: vec2,
    strand: Strand,
    tick: number,
    owner: Stretch,
    densityWeight = 1
  ) {
    const radius =
      strand.kind === "main" ? this.tuning.mainRadius : this.tuning.minorRadius;
    const s: FiberSegment = {
      a,
      b,
      strand,
      tick,
      owner,
      radius,
      densityWeight,
      length: vec2.distance(a, b)
    };
    owner.strokes.push(s);
    this.enclose(s.a, s.radius);
    this.enclose(s.b, s.radius);
    for (const tile of this.segmentTiles(s)) {
      tile.segments.add(s);
      if (s.strand.kind === "main") {
        tile.main.add(s);
        tile.mainDensity += s.densityWeight;
      } else tile.minorDensity += s.densityWeight;
      if (s.length) stroke(tile.ctx, s, this.color(s), 2 * s.radius);
    }
  }

  becomeAsh(stretch: Stretch) {
    for (const s of stretch.strokes) {
      for (const tile of this.segmentTiles(s)) {
        if (s.strand.kind === "main") {
          tile.main.delete(s);
          tile.mainDensity = Math.max(0, tile.mainDensity - s.densityWeight);
        } else tile.minorDensity = Math.max(0, tile.minorDensity - s.densityWeight);
        invalidate(tile, s);
      }
    }
  }

  updateAppearance(s: Stretch, supply: number) {
    const healthBand = Math.round(s.health * fiberColorSteps),
      supplyBand = Math.round(supply * fiberColorSteps);
    if (
      healthBand !== s.healthBand ||
      (this.tuning.showNutrientSupply && supplyBand !== s.supplyBand)
    )
      for (const stroke of s.strokes)
        for (const tile of this.segmentTiles(stroke)) invalidate(tile, stroke);
    s.healthBand = healthBand;
    s.supplyBand = supplyBand;
  }

  crumble(stretches: Iterable<Stretch>) {
    // Batch simultaneous shedding locally, while keeping the flakes on real fiber positions.
    const spacing = this.tuning.ashBurstSpacing;
    const bursts = new Map<string, { position: vec2; amount: number }>();
    for (const stretch of stretches) {
      for (const s of stretch.strokes) {
        for (const tile of this.segmentTiles(s)) {
          tile.segments.delete(s);
          invalidate(tile, s);
          if (!tile.segments.size) this.tiles.delete(tileKey(tile.x, tile.y));
        }
        if (!this.releaseAsh || !s.length) continue;
        const x = (s.a[0] + s.b[0]) / 2,
          y = (s.a[1] + s.b[1]) / 2;
        const key = tileKey(Math.floor(x / spacing), Math.floor(y / spacing));
        const burst = bursts.get(key);
        if (burst) burst.amount += s.length;
        else bursts.set(key, { position: vec2.fromValues(x, y), amount: s.length });
      }
    }
    for (const { position, amount } of bursts.values())
      this.releaseAsh?.(position, Math.min(1, amount / spacing));
  }

  nearby(a: vec2, b: vec2, r: number, includeMinor: boolean) {
    const x0 = Math.max(Math.min(a[0], b[0]) - r, this.bounds.min[0]),
      x1 = Math.min(Math.max(a[0], b[0]) + r, this.bounds.max[0]);
    const y0 = Math.max(Math.min(a[1], b[1]) - r, this.bounds.min[1]),
      y1 = Math.min(Math.max(a[1], b[1]) + r, this.bounds.max[1]);
    const result = new Set<FiberSegment>();
    for (let y = Math.floor(y0 / tileSize); y <= Math.floor(y1 / tileSize); y++)
      for (let x = Math.floor(x0 / tileSize); x <= Math.floor(x1 / tileSize); x++) {
        const tile = this.tiles.get(tileKey(x, y));
        if (tile)
          for (const s of includeMinor ? tile.segments : tile.main)
            if (!s.owner.dead && s.length) result.add(s);
      }
    return result;
  }

  draw(ctx: CanvasRenderingContext2D, time: number, wounded: ReadonlySet<Stretch>) {
    for (const tile of this.tiles.values()) {
      const x = tile.x * tileSize,
        y = tile.y * tileSize;
      const d = tile.damage;
      if (d) {
        const width = d.right - d.left,
          height = d.bottom - d.top;
        const full = width * height >= (tileSize * tileSize) / 2;
        // Rasterize intersecting strokes with the same canvas boundaries as a full
        // repaint. Clipping the strokes themselves can change antialias coverage.
        const surface = full ? tile.ctx : (this.patchSurface ??= tileSurface());
        if (!full)
          surface.setTransform(tileScale, 0, 0, tileScale, -tileScale * x, -tileScale * y);
        if (full) surface.clearRect(x, y, tileSize, tileSize);
        else surface.clearRect(d.left, d.top, width, height);
        for (const s of tile.segments)
          if (s.length && (full || overlapsDamage(s, d)))
            stroke(surface, s, this.color(s), 2 * s.radius);
        if (!full) {
          tile.ctx.clearRect(d.left, d.top, width, height);
          tile.ctx.drawImage(
            surface.canvas,
            (d.left - x) * tileScale,
            (d.top - y) * tileScale,
            width * tileScale,
            height * tileScale,
            d.left,
            d.top,
            width,
            height
          );
        }
        tile.damage = undefined;
      }
      ctx.drawImage(tile.ctx.canvas, x, y, tileSize, tileSize);
    }
    const alpha = ctx.globalAlpha;
    ctx.lineCap = "round";
    for (const s of wounded) {
      const wound = s.wound!;
      const flash =
        wound.strength *
        Math.max(0, 1 - (time - wound.start) / this.tuning.woundFlashSeconds);
      if (flash > 0) {
        ctx.globalAlpha = alpha * flash;
        for (const segment of s.strokes)
          stroke(ctx, segment, this.palette.wound, 2 * segment.radius + 2 * flash);
      }
    }
    ctx.globalAlpha = alpha;
  }
}

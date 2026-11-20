import { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import type { FungalNode } from "./gem";
import type { ColonyPalette } from "./palette";

export type Junction = {
  position: vec2;
  strands: MainStrand[];
  arrivals: number;
  node?: FungalNode;
};
export type MainStrand = { kind: "main"; from: Junction; to?: Junction; trailId: symbol };
export type MinorStrand = { kind: "minor"; parent: MainStrand | MinorStrand; root: vec2 };
type Strand = MainStrand | MinorStrand;
export type FiberSegment = {
  a: vec2;
  b: vec2;
  radius: number;
  strand: Strand;
  tick: number;
  buds?: vec2[]; // Minor strands attach at these points inside a main segment.
  dead?: boolean;
};

type Reaction = {
  started: number;
  strength: number;
  lethal: boolean;
  opacity: number;
  flash: number;
};

const tileSize = 48;
const maxWoundSegmentLength = 8;
type Tile = {
  x: number;
  y: number;
  ctx: CanvasRenderingContext2D;
  segments: Set<FiberSegment>;
  main: Set<FiberSegment>;
  dirty: boolean;
};
function tileKey(x: number, y: number) {
  return x + "," + y;
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

// Healthy tissue stays cached. Only tiles touched by a reaction need repainting.
export class FungalFabric {
  readonly bounds = {
    min: vec2.fromValues(Infinity, Infinity),
    max: vec2.fromValues(-Infinity, -Infinity)
  };
  private readonly tiles = new Map<string, Tile>();
  private readonly reacting = new Map<FiberSegment, Reaction>();

  constructor(
    private readonly palette: ColonyPalette,
    private readonly tuning: Readonly<ColonyTuning>
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
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = tileSize * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(2, 0, 0, 2, -2 * x * tileSize, -2 * y * tileSize);
      ctx.lineCap = "round";
      tile = { x, y, ctx, segments: new Set(), main: new Set(), dirty: false };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  crowded(p: vec2, kind: Strand["kind"]) {
    const tile = this.tiles.get(
      tileKey(Math.floor(p[0] / tileSize), Math.floor(p[1] / tileSize))
    );
    // Local saturation retires a growing tip while the frontier can keep exploring.
    const capacity =
      kind === "main" ? this.tuning.mainSegmentsPerTile : this.tuning.minorSegmentsPerTile;
    const mainCount = tile?.main.size ?? 0;
    return (
      (kind === "main" ? mainCount : (tile?.segments.size ?? 0) - mainCount) >= capacity
    );
  }

  private *segmentTiles({ a, b, radius: r }: FiberSegment) {
    for (
      let y = Math.floor((Math.min(a[1], b[1]) - r) / tileSize);
      y <= Math.floor((Math.max(a[1], b[1]) + r) / tileSize);
      y++
    ) {
      for (
        let x = Math.floor((Math.min(a[0], b[0]) - r) / tileSize);
        x <= Math.floor((Math.max(a[0], b[0]) + r) / tileSize);
        x++
      ) {
        yield this.tile(x, y);
      }
    }
  }

  private color(s: FiberSegment) {
    return s.strand.kind === "main" ? this.palette.primary : this.palette.minor;
  }

  deposit(a: vec2, b: vec2, strand: Strand, tick: number, buds?: vec2[]) {
    if (vec2.exactEquals(a, b)) return;
    const radius =
      strand.kind === "main" ? this.tuning.mainRadius : this.tuning.minorRadius;
    this.enclose(a, radius);
    this.enclose(b, radius);
    this.index({ a, b, strand, radius, tick, buds });
  }

  private index(s: FiberSegment) {
    for (const tile of this.segmentTiles(s)) {
      tile.segments.add(s);
      if (s.strand.kind === "main") tile.main.add(s);
      if (!tile.dirty) stroke(tile.ctx, s, this.color(s), 2 * s.radius);
    }
  }

  // Only subdivide unusually long deposits (e.g. a large configured growth step)
  // when the wave actually reaches them, so the undisturbed colony grows as authored.
  private subdivide(s: FiberSegment, length: number) {
    const { a, b, buds } = s;
    const count = Math.ceil(length / maxWoundSegmentLength);
    this.remove(s, true);
    let start = a,
      budIndex = 0;
    for (let i = 1; i <= count; i++) {
      const end = i === count ? b : vec2.lerp(vec2.create(), a, b, i / count);
      const piece: FiberSegment = {
        a: start,
        b: end,
        strand: s.strand,
        radius: s.radius,
        tick: s.tick
      };
      if (buds) {
        const first = budIndex;
        while (
          budIndex < buds.length &&
          (i === count || vec2.distance(a, buds[budIndex]) <= (length * i) / count)
        )
          budIndex++;
        if (budIndex > first) piece.buds = buds.slice(first, budIndex);
      }
      this.index(piece);
      start = end;
    }
  }

  private remove(s: FiberSegment, invalidateCache: boolean) {
    s.dead = true;
    for (const tile of this.segmentTiles(s)) {
      tile.segments.delete(s);
      tile.main.delete(s);
      if (invalidateCache) tile.dirty = true;
    }
  }

  *connected(point: vec2) {
    const tile = this.tiles.get(
      tileKey(Math.floor(point[0] / tileSize), Math.floor(point[1] / tileSize))
    );
    if (!tile) return;
    for (const s of tile.segments) {
      if (s.a !== point && s.b !== point && !s.buds?.includes(point)) continue;
      // Set iteration also visits the newly indexed pieces.
      const length = vec2.distance(s.a, s.b);
      if (length > maxWoundSegmentLength) this.subdivide(s, length);
      else yield s;
    }
  }

  expose(s: FiberSegment, started: number, strength: number) {
    const lethal = strength >= this.tuning.woundKillStrength;
    const previous = this.reacting.get(s);
    if (s.dead || previous?.lethal || (previous && !lethal && previous.started > started))
      return;
    if (!previous) for (const tile of this.segmentTiles(s)) tile.dirty = true;
    this.reacting.set(s, { started, strength, lethal, flash: strength, opacity: 1 });
  }

  updateReactions(time: number) {
    const { woundFlashSeconds, woundWitherSeconds, woundRecoverSeconds } = this.tuning;
    for (const [s, r] of this.reacting) {
      const age = Math.max(0, time - r.started);
      r.flash = r.strength * Math.max(0, 1 - age / woundFlashSeconds);
      const duration = r.lethal ? woundWitherSeconds : woundRecoverSeconds;
      const t = Math.max(0, (age - woundFlashSeconds) / duration);
      if (t < 1) {
        r.opacity = r.lethal ? 1 - t : 1 - 0.7 * (1 - t);
        continue;
      }
      this.reacting.delete(s);
      if (r.lethal)
        this.remove(s, false); // Already omitted from the static tile.
      else for (const tile of this.segmentTiles(s)) tile.dirty = true;
    }
  }

  nearby(a: vec2, b: vec2, r: number, includeMinor: boolean) {
    const x0 = Math.max(Math.min(a[0], b[0]) - r, this.bounds.min[0]),
      x1 = Math.min(Math.max(a[0], b[0]) + r, this.bounds.max[0]);
    const y0 = Math.max(Math.min(a[1], b[1]) - r, this.bounds.min[1]),
      y1 = Math.min(Math.max(a[1], b[1]) + r, this.bounds.max[1]);
    const result = new Set<FiberSegment>();
    if (x0 > x1 || y0 > y1) return result;
    for (let y = Math.floor(y0 / tileSize); y <= Math.floor(y1 / tileSize); y++) {
      for (let x = Math.floor(x0 / tileSize); x <= Math.floor(x1 / tileSize); x++) {
        const tile = this.tiles.get(tileKey(x, y));
        if (!tile) continue;
        for (const s of includeMinor ? tile.segments : tile.main) result.add(s);
      }
    }
    return result;
  }

  draw(ctx: CanvasRenderingContext2D, brightness = 1) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * brightness;
    for (const tile of this.tiles.values()) {
      const x = tile.x * tileSize,
        y = tile.y * tileSize;
      if (tile.dirty) {
        tile.ctx.clearRect(x, y, tileSize, tileSize);
        for (const s of tile.segments)
          if (!this.reacting.has(s)) stroke(tile.ctx, s, this.color(s), 2 * s.radius);
        tile.dirty = false;
      }
      ctx.drawImage(tile.ctx.canvas, x, y, tileSize, tileSize);
    }
    ctx.lineCap = "round";
    for (const [s, r] of this.reacting) {
      ctx.globalAlpha = alpha * brightness * r.opacity;
      stroke(ctx, s, this.color(s), 2 * s.radius);
      if (r.flash > 0) {
        ctx.globalAlpha = alpha * r.flash;
        stroke(ctx, s, this.palette.wound, 2 * s.radius + 2 * r.flash);
      }
    }
    ctx.globalAlpha = alpha;
  }
}

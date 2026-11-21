import { vec2 } from "gl-matrix";
import { fiberColorSteps, type ColonyTuning } from "./config";
import type { GrowthDomain } from "./domain";
import type { ColonyPalette } from "./palette";

export type FiberKind = "main" | "minor";
export type Stroke = {
  a: vec2;
  b: vec2;
  radius: number;
  kind: FiberKind;
  trail?: symbol;
  tick: number;
  fibers: Fibers;
};

// Geometry survives its stretch briefly as ash. It holds no links into the living graph.
export class Fibers {
  readonly strokes: Stroke[] = [];
  readonly tiles = new Map<Tile, { main: number; minor: number }>();
  shade = fiberColorSteps;
}

const tileSize = 48;
const scale = 2;
function* tileKeys(a: vec2, b: vec2, radius: number, domain: GrowthDomain) {
  const x0 = Math.floor(Math.max(0, Math.min(a[0], b[0]) - radius) / tileSize);
  const y0 = Math.floor(Math.max(0, Math.min(a[1], b[1]) - radius) / tileSize);
  const x1 = Math.floor(Math.min(domain.width, Math.max(a[0], b[0]) + radius) / tileSize);
  const y1 = Math.floor(Math.min(domain.height, Math.max(a[1], b[1]) + radius) / tileSize);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) yield { key: x + "," + y, x, y };
}

function stroke(ctx: CanvasRenderingContext2D, s: Stroke, color: string, extraRadius = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * (s.radius + extraRadius);
  ctx.beginPath();
  ctx.moveTo(s.a[0], s.a[1]);
  ctx.lineTo(s.b[0], s.b[1]);
  ctx.stroke();
}

class Tile {
  ctx?: CanvasRenderingContext2D;
  readonly visible = new Set<Stroke>(); // Includes ash, in original drawing order.
  readonly main = new Set<Stroke>();
  readonly density = { main: 0, minor: 0 };
  dirty = true;

  constructor(
    readonly x: number,
    readonly y: number
  ) {}

  surface() {
    if (this.ctx) return this.ctx;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = tileSize * scale;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.setTransform(scale, 0, 0, scale, -this.x * scale, -this.y * scale);
    this.ctx.lineCap = "round";
    return this.ctx;
  }
}

export class FungalFabric {
  private readonly tiles = new Map<string, Tile>();
  private readonly ash = new Map<Fibers, number>();

  constructor(
    private readonly palette: ColonyPalette,
    private readonly tuning: Readonly<ColonyTuning>,
    private readonly domain: GrowthDomain,
    private readonly releaseAsh?: (position: vec2, amount: number) => void
  ) {}

  density(p: vec2, kind: FiberKind) {
    const key = Math.floor(p[0] / tileSize) + "," + Math.floor(p[1] / tileSize);
    return this.tiles.get(key)?.density[kind] ?? 0;
  }

  crowded(p: vec2, kind: FiberKind) {
    const { mainSegmentsPerTile, minorSegmentsPerTile } = this.tuning;
    return (
      this.density(p, kind) >=
      (kind === "main" ? mainSegmentsPerTile : minorSegmentsPerTile)
    );
  }

  private color(s: Stroke) {
    if (this.ash.has(s.fibers)) return this.palette.ash;
    const ramp = this.tuning.showNutrientSupply
      ? this.palette.supply
      : this.palette.tissue[s.kind];
    return ramp[s.fibers.shade];
  }

  deposit(fibers: Fibers, a: vec2, b: vec2, tick: number, trail?: symbol, weight = 1) {
    const kind = trail === undefined ? "minor" : "main";
    const radius = trail === undefined ? this.tuning.minorRadius : this.tuning.mainRadius;
    const s: Stroke = { fibers, a, b, tick, trail, kind, radius };
    fibers.strokes.push(s);
    for (const { key, x, y } of tileKeys(a, b, radius, this.domain)) {
      let tile = this.tiles.get(key);
      if (!tile) {
        tile = new Tile(x * tileSize, y * tileSize);
        this.tiles.set(key, tile);
      }
      let coverage = fibers.tiles.get(tile);
      if (!coverage) {
        coverage = { main: 0, minor: 0 };
        fibers.tiles.set(tile, coverage);
      }
      coverage[kind] += weight;
      tile.visible.add(s);
      if (trail !== undefined) tile.main.add(s);
      tile.density[kind] += weight;
      if (tile.ctx && !tile.dirty) stroke(tile.ctx, s, this.color(s));
    }
  }

  shade(fibers: Fibers, health: number, power: number) {
    const shade = Math.round(
      fiberColorSteps * (this.tuning.showNutrientSupply ? power : health)
    );
    if (fibers.shade === shade) return;
    fibers.shade = shade;
    for (const tile of fibers.tiles.keys()) tile.dirty = true;
  }

  // Occupancy ends immediately. The same strokes stay visible until the ash expires.
  release(fibers: Fibers, time: number) {
    this.ash.set(fibers, time + this.tuning.ashHoldSeconds);
    for (const [tile, coverage] of fibers.tiles) {
      tile.density.main = Math.max(0, tile.density.main - coverage.main);
      tile.density.minor = Math.max(0, tile.density.minor - coverage.minor);
      tile.dirty = true;
    }
    fibers.tiles.clear();
  }

  crumble(time: number) {
    if (!this.ash.size) return;
    const spacing = this.tuning.ashBurstSpacing;
    const bursts = new Map<string, { position: vec2; amount: number }>();
    for (const [fibers, until] of this.ash) {
      if (time < until) continue;
      this.ash.delete(fibers);
      for (const s of fibers.strokes) {
        for (const { key } of tileKeys(s.a, s.b, s.radius, this.domain)) {
          const tile = this.tiles.get(key)!;
          tile.visible.delete(s);
          tile.main.delete(s);
          tile.dirty = true;
          if (!tile.visible.size) this.tiles.delete(key);
        }
        if (!this.releaseAsh) continue;
        const x = (s.a[0] + s.b[0]) / 2,
          y = (s.a[1] + s.b[1]) / 2;
        const key = Math.floor(x / spacing) + "," + Math.floor(y / spacing);
        const amount = vec2.distance(s.a, s.b);
        const burst = bursts.get(key);
        if (burst) burst.amount += amount;
        else bursts.set(key, { position: vec2.fromValues(x, y), amount });
      }
    }
    for (const { position, amount } of bursts.values())
      this.releaseAsh?.(position, Math.min(1, amount / spacing));
  }

  nearby(a: vec2, b: vec2, radius: number, includeMinor: boolean) {
    const found = new Set<Stroke>();
    for (const { key } of tileKeys(a, b, radius, this.domain)) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      for (const s of includeMinor ? tile.visible : tile.main)
        if (!this.ash.has(s.fibers)) found.add(s);
    }
    return found;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const tile of this.tiles.values()) {
      const surface = tile.surface();
      if (tile.dirty) {
        surface.clearRect(tile.x, tile.y, tileSize, tileSize);
        for (const s of tile.visible) stroke(surface, s, this.color(s));
        tile.dirty = false;
      }
      ctx.drawImage(surface.canvas, tile.x, tile.y, tileSize, tileSize);
    }
  }

  flash(ctx: CanvasRenderingContext2D, fibers: Fibers, strength: number) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha *= strength;
    for (const s of fibers.strokes) stroke(ctx, s, this.palette.wound, strength);
    ctx.restore();
  }
}

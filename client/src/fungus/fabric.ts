import { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import { FiberNetwork, type FiberSegment, type Strand } from "./network";
import type { ColonyPalette } from "./palette";

const tileSize = 48;
const maxSegmentLength = 8;
type Tile = {
  x: number;
  y: number;
  ctx: CanvasRenderingContext2D;
  segments: Set<FiberSegment>;
  main: Set<FiberSegment>;
  ash: Set<FiberSegment>;
  mainDensity: number;
  minorDensity: number;
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

// Integral of unit wound pressure. Each pulse holds, then releases linearly.
// Integrating between tissue ticks keeps the dose independent of frame/tick frequency.
function woundDose(age: number, tuning: Readonly<ColonyTuning>) {
  const t = Math.max(0, age - tuning.woundFlashSeconds);
  const hold = tuning.woundWitherSeconds,
    release = tuning.woundRecoverSeconds;
  const tail = Math.min(release, Math.max(0, t - hold));
  return t >= hold + release
    ? 1
    : (Math.min(t, hold) + tail * (1 - tail / (2 * release))) / (hold + release / 2);
}

function woundDamage(strength: number, tuning: Readonly<ColonyTuning>) {
  // Even a saturated wound takes the configured wither time to consume healthy tissue.
  return Math.min(
    strength / tuning.woundKillStrength,
    1 + tuning.woundRecoverSeconds / (2 * tuning.woundWitherSeconds)
  );
}

export class FungalFabric {
  readonly network: FiberNetwork;
  readonly bounds = {
    min: vec2.fromValues(Infinity, Infinity),
    max: vec2.fromValues(-Infinity, -Infinity)
  };
  private readonly tiles = new Map<string, Tile>();
  private readonly wounded = new Set<FiberSegment>();
  private readonly ash = new Map<FiberSegment, number>();
  private time = 0;

  constructor(
    private readonly palette: ColonyPalette,
    private readonly tuning: Readonly<ColonyTuning>,
    private readonly releaseAsh?: (position: vec2, amount: number) => void
  ) {
    this.network = new FiberNetwork(tuning, {
      added: (s) => this.index(s),
      removed: (s) => this.becomeAsh(s)
    });
  }

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
      tile = {
        x,
        y,
        ctx,
        segments: new Set(),
        main: new Set(),
        ash: new Set(),
        mainDensity: 0,
        minorDensity: 0,
        dirty: false
      };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  crowded(p: vec2, kind: Strand["kind"]) {
    const tile = this.tiles.get(
      tileKey(Math.floor(p[0] / tileSize), Math.floor(p[1] / tileSize))
    );
    return kind === "main"
      ? (tile?.mainDensity ?? 0) >= this.tuning.mainSegmentsPerTile
      : (tile?.minorDensity ?? 0) >= this.tuning.minorSegmentsPerTile;
  }

  private *segmentTiles(s: FiberSegment) {
    // Index the widest possible healthy silhouette. Growth checks this same clearance.
    const { a, b, maxRadius: r } = s;
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
    if (this.tuning.showNutrientSupply) return this.palette.supply[s.supplyBand];
    return this.palette.tissue[s.strand.kind][s.healthBand];
  }

  private index(s: FiberSegment) {
    this.enclose(s.a, s.maxRadius);
    this.enclose(s.b, s.maxRadius);
    for (const tile of this.segmentTiles(s)) {
      tile.segments.add(s);
      if (s.strand.kind === "main") {
        tile.main.add(s);
        tile.mainDensity += s.densityWeight;
      } else tile.minorDensity += s.densityWeight;
      if (!tile.dirty && s.length) stroke(tile.ctx, s, this.color(s), 2 * s.radius);
    }
  }

  deposit(a: vec2, b: vec2, strand: Strand, tick: number, buds?: vec2[]) {
    if (a === b) return;
    const length = vec2.distance(a, b);
    // The ordered samples on this deposit are its actual graph edges. Bud roots are
    // shared endpoints, and long steps retain a finite spatial resolution for decay.
    let start = a;
    for (const stop of buds ? [...buds, b] : [b]) {
      const from = start;
      const pieces = Math.max(1, Math.ceil(vec2.distance(from, stop) / maxSegmentLength));
      for (let i = 1; i <= pieces; i++) {
        const end = i === pieces ? stop : vec2.lerp(vec2.create(), from, stop, i / pieces);
        if (start !== end) {
          const weight = length ? vec2.distance(start, end) / length : 0;
          this.network.connect(start, end, strand, tick, weight);
        }
        start = end;
      }
    }
  }

  expose(s: FiberSegment, start: number, strength: number) {
    if (s.dead) return;
    // Combine overlapping wounds, bounded by the strength at an extraction site.
    const old = s.wound;
    let pendingDose = 0;
    if (old) {
      start = Math.max(old.start, start);
      const spent = woundDose(start - old.start, this.tuning);
      pendingDose =
        old.pendingDose +
        (spent - woundDose(this.time - old.start, this.tuning)) *
          woundDamage(old.strength, this.tuning);
      strength = Math.min(1, strength + old.strength * (1 - spent));
    }
    s.wound = { start, strength, pendingDose };
    this.wounded.add(s);
  }

  private becomeAsh(s: FiberSegment) {
    this.wounded.delete(s);
    this.ash.set(s, this.time + this.tuning.ashHoldSeconds);
    for (const tile of this.segmentTiles(s)) {
      tile.segments.delete(s);
      if (s.strand.kind === "main") {
        tile.main.delete(s);
        tile.mainDensity = Math.max(0, tile.mainDensity - s.densityWeight);
      } else tile.minorDensity = Math.max(0, tile.minorDensity - s.densityWeight);
      tile.ash.add(s);
      tile.dirty = true;
    }
  }

  updateTissue(time: number) {
    if (time <= this.time) return;
    this.network.solve();
    const dt = time - this.time;
    this.time = time;
    const t = this.tuning;
    const widthBlend = -Math.expm1(-dt / t.widthResponseSeconds);
    let severed = false;
    for (const s of this.network.segments) {
      const supply = s.supply;
      let change = (dt * (supply / t.maintenanceSupply - 1)) / t.starvationSeconds;
      if (s.wound) {
        const age = time - s.wound.start;
        const dose = woundDose(age, t);
        change -=
          s.wound.pendingDose +
          (dose - woundDose(age - dt, t)) * woundDamage(s.wound.strength, t);
        s.wound.pendingDose = 0;
        if (dose >= 1) {
          s.wound = undefined;
          this.wounded.delete(s);
        }
      }
      s.health = Math.max(0, Math.min(1, s.health + change));
      if (s.health === 0) {
        this.network.sever(s);
        severed = true;
        continue;
      }
      const width = t.minWidthFraction + (1 - t.minWidthFraction) * supply;
      s.widthFraction += widthBlend * (width - s.widthFraction);
      const radius =
        s.maxRadius * Math.max(t.minWidthFraction, Math.round(s.widthFraction * 32) / 32);
      const healthBand = Math.round(s.health * 16),
        supplyBand = Math.round(supply * 16);
      if (
        radius !== s.radius ||
        healthBand !== s.healthBand ||
        (t.showNutrientSupply && supplyBand !== s.supplyBand)
      )
        for (const tile of this.segmentTiles(s)) tile.dirty = true;
      s.radius = radius;
      s.healthBand = healthBand;
      s.supplyBand = supplyBand;
    }
    if (severed) this.network.solve();
    this.crumble(time);
  }

  private crumble(time: number) {
    if (!this.ash.size) return;
    // Batch simultaneous shedding locally, while keeping the flakes on real fiber positions.
    const spacing = this.tuning.ashBurstSpacing;
    const bursts = new Map<string, { position: vec2; amount: number }>();
    for (const [s, expiry] of this.ash) {
      if (time < expiry) continue;
      this.ash.delete(s);
      for (const tile of this.segmentTiles(s)) {
        tile.ash.delete(s);
        tile.dirty = true;
        if (!tile.ash.size && !tile.segments.size)
          this.tiles.delete(tileKey(tile.x, tile.y));
      }
      if (!this.releaseAsh || !s.length) continue;
      const x = (s.a[0] + s.b[0]) / 2,
        y = (s.a[1] + s.b[1]) / 2;
      const key = tileKey(Math.floor(x / spacing), Math.floor(y / spacing));
      const burst = bursts.get(key);
      if (burst) burst.amount += s.length;
      else bursts.set(key, { position: vec2.fromValues(x, y), amount: s.length });
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
            if (s.length) result.add(s);
      }
    return result;
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    for (const tile of this.tiles.values()) {
      const x = tile.x * tileSize,
        y = tile.y * tileSize;
      if (tile.dirty) {
        tile.ctx.clearRect(x, y, tileSize, tileSize);
        for (const s of tile.segments)
          if (s.length) stroke(tile.ctx, s, this.color(s), 2 * s.radius);
        for (const s of tile.ash)
          if (s.length) stroke(tile.ctx, s, this.palette.ash, 2 * s.radius);
        tile.dirty = false;
      }
      ctx.drawImage(tile.ctx.canvas, x, y, tileSize, tileSize);
    }
    const alpha = ctx.globalAlpha;
    ctx.lineCap = "round";
    for (const s of this.wounded) {
      const wound = s.wound!;
      const flash =
        wound.strength *
        Math.max(0, 1 - (time - wound.start) / this.tuning.woundFlashSeconds);
      if (flash > 0 && s.length) {
        ctx.globalAlpha = alpha * flash;
        stroke(ctx, s, this.palette.wound, 2 * s.radius + 2 * flash);
      }
    }
    ctx.globalAlpha = alpha;
  }
}

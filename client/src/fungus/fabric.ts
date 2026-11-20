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
type Segment = { a: vec2; b: vec2; radius: number; strand: Strand; tick: number };

const tileSize = 48;
type Tile = {
  x: number;
  y: number;
  ctx: CanvasRenderingContext2D;
  main: Segment[];
  minor: Segment[];
};
function tileKey(x: number, y: number) {
  return x + "," + y;
}

// Each deposit is indexed and painted once. Long-lived colonies draw one cached image per occupied tile.
export class FungalFabric {
  readonly bounds = {
    min: vec2.fromValues(Infinity, Infinity),
    max: vec2.fromValues(-Infinity, -Infinity)
  };
  private readonly tiles = new Map<string, Tile>();

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
      tile = { x, y, ctx, main: [], minor: [] };
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
    return (tile?.[kind].length ?? 0) >= capacity;
  }

  deposit(a: vec2, b: vec2, strand: Strand, tick: number) {
    if (vec2.exactEquals(a, b)) return;
    const main = strand.kind === "main";
    const r = main ? this.tuning.mainRadius : this.tuning.minorRadius;
    const segment: Segment = { a, b, strand, radius: r, tick };
    this.enclose(a, r);
    this.enclose(b, r);
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
        const tile = this.tile(x, y);
        tile[strand.kind].push(segment);
        const ctx = tile.ctx;
        ctx.strokeStyle = main ? this.palette.primary : this.palette.minor;
        ctx.lineWidth = 2 * r;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }
  }

  nearby(a: vec2, b: vec2, r: number, includeMinor: boolean) {
    const x0 = Math.max(Math.min(a[0], b[0]) - r, this.bounds.min[0]),
      x1 = Math.min(Math.max(a[0], b[0]) + r, this.bounds.max[0]);
    const y0 = Math.max(Math.min(a[1], b[1]) - r, this.bounds.min[1]),
      y1 = Math.min(Math.max(a[1], b[1]) + r, this.bounds.max[1]);
    const result = new Set<Segment>();
    if (x0 > x1 || y0 > y1) return result;
    for (let y = Math.floor(y0 / tileSize); y <= Math.floor(y1 / tileSize); y++) {
      for (let x = Math.floor(x0 / tileSize); x <= Math.floor(x1 / tileSize); x++) {
        const tile = this.tiles.get(tileKey(x, y));
        if (!tile) continue;
        for (const s of tile.main) result.add(s);
        if (includeMinor) for (const s of tile.minor) result.add(s);
      }
    }
    return result;
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const { ctx: tile, x, y } of this.tiles.values())
      ctx.drawImage(tile.canvas, x * tileSize, y * tileSize, tileSize, tileSize);
  }
}

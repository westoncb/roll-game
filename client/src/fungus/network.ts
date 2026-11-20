import { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import { NutrientSolver } from "./nutrients";

export type Strand = { kind: "main"; trailId: symbol } | { kind: "minor" };

export class FiberPoint {
  readonly incident: FiberSegment[] = [];
  source = false;
  row = -1; // After a solve, only gem-connected points have rows.
  constructor(
    readonly position: vec2,
    public supply: number
  ) {}
}

export class FiberSegment {
  health = 1;
  dead = false;
  healthBand = 16;
  supplyBand = 16;
  widthFraction: number;
  radius: number;
  wound?: { start: number; strength: number; pendingDose: number };
  readonly conductance: number;
  readonly demand: number;

  constructor(
    readonly from: FiberPoint,
    readonly to: FiberPoint,
    readonly strand: Strand,
    readonly tick: number,
    readonly length: number,
    readonly maxRadius: number,
    readonly densityWeight: number,
    tuning: Readonly<ColonyTuning>
  ) {
    const main = strand.kind === "main";
    this.conductance =
      (tuning.nutrientLength ** 2 * (main ? 1 : tuning.minorConductance)) /
      Math.max(length, 1e-5);
    this.demand = length * (main ? 1 : tuning.minorUptake);
    this.widthFraction =
      tuning.minWidthFraction + (1 - tuning.minWidthFraction) * this.supply;
    this.radius = maxRadius * this.widthFraction;
    this.supplyBand = Math.round(16 * this.supply);
  }

  get a() {
    return this.from.position;
  }
  get b() {
    return this.to.position;
  }
  get supply() {
    return (this.from.supply + this.to.supply) / 2;
  }
}

// Positions are immutable identities. Independent fibers can occupy the same coordinates.
export class FiberNetwork {
  readonly points = new Map<vec2, FiberPoint>();
  readonly segments = new Set<FiberSegment>();
  private readonly sources = new Set<FiberPoint>();
  private readonly solver = new NutrientSolver();
  private connectedPointCount = 0;
  private dirty = false;

  constructor(
    private readonly tuning: Readonly<ColonyTuning>,
    private readonly changes?: {
      added(s: FiberSegment): void;
      removed(s: FiberSegment): void;
    }
  ) {}

  private point(position: vec2, initialSupply: number) {
    let point = this.points.get(position);
    if (!point) {
      point = new FiberPoint(position, initialSupply);
      this.points.set(position, point);
    }
    return point;
  }

  setSource(position: vec2, attached: boolean) {
    const p = attached ? this.point(position, 1) : this.points.get(position);
    if (!p || p.source === attached) return;
    p.source = attached;
    if (attached) this.sources.add(p);
    else {
      this.sources.delete(p);
      if (!p.incident.length) this.points.delete(position);
    }
    this.dirty = true;
  }

  connect(a: vec2, b: vec2, strand: Strand, tick: number, densityWeight: number) {
    const from = this.point(a, this.points.get(b)?.supply ?? 0);
    const to = this.point(b, from.supply);
    const radius =
      strand.kind === "main" ? this.tuning.mainRadius : this.tuning.minorRadius;
    const segment = new FiberSegment(
      from,
      to,
      strand,
      tick,
      vec2.distance(a, b),
      radius,
      densityWeight,
      this.tuning
    );
    this.segments.add(segment);
    from.incident.push(segment);
    to.incident.push(segment);
    this.dirty = true;
    this.changes?.added(segment);
    return segment;
  }

  sever(s: FiberSegment) {
    if (!this.segments.delete(s)) return;
    s.dead = true;
    s.health = 0;
    for (const p of [s.from, s.to]) {
      p.incident.splice(p.incident.indexOf(s), 1);
      if (!p.source && !p.incident.length) this.points.delete(p.position);
    }
    this.dirty = true;
    this.changes?.removed(s);
  }

  solve() {
    if (!this.dirty) return;
    this.connectedPointCount = this.solver.solve(
      this.points.values(),
      this.sources,
      this.tuning.gemOutput
    );
    this.dirty = false;
  }

  shedDisconnected() {
    this.solve();
    if (this.connectedPointCount === this.points.size) return;
    // Both ends of each edge belong to the same component. Removing whole unsourced
    // components leaves the solved supply on every surviving point valid.
    for (const s of this.segments) if (s.from.row < 0) this.sever(s);
    this.dirty = false;
  }

  growthFactor(p: FiberPoint) {
    const maintenance = this.tuning.maintenanceSupply;
    const available = Math.max(0, (p.supply - maintenance) / (1 - maintenance));
    if (p.source) return available;
    let health = 0;
    for (const s of p.incident) health = Math.max(health, s.health);
    return available * health;
  }
}

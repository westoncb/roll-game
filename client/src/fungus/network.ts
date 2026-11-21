import type { vec2 } from "gl-matrix";
import { fiberColorSteps, type ColonyTuning } from "./config";
import { DistanceQueue } from "./distance-queue";

export type Strand = { kind: "main"; trailId: symbol } | { kind: "minor" };

// Geometry is kept at drawing and collision resolution. All biological state
// belongs to the stretch of main strand that produced the stroke.
export type FiberSegment = {
  a: vec2;
  b: vec2;
  length: number;
  radius: number;
  strand: Strand;
  tick: number;
  densityWeight: number;
  owner: Stretch;
};

export class FiberPoint {
  readonly incident = new Set<Stretch>();
  source = false;
  distance = Infinity;
  constructor(public position: vec2) {}
}

export class Stretch {
  readonly strokes: FiberSegment[] = [];
  health = 1;
  dead = false;
  healthBand = fiberColorSteps;
  supplyBand = fiberColorSteps;
  wound?: { start: number; strength: number; pendingDose: number };
  // Once a wound starts traveling along this stretch its endpoint must stay put.
  sealed = false;

  constructor(
    readonly from: FiberPoint,
    readonly to: FiberPoint,
    readonly trailId: symbol,
    public length: number
  ) {}

  other(point: FiberPoint) {
    return point === this.from ? this.to : this.from;
  }

  get midpointDistance() {
    return Math.min(this.from.distance, this.to.distance) + this.length / 2;
  }
}

export class FiberNetwork {
  readonly points = new Map<vec2, FiberPoint>();
  readonly stretches = new Set<Stretch>();
  private dirty = false;

  constructor(private readonly tuning: Readonly<ColonyTuning>) {}

  private point(position: vec2) {
    let point = this.points.get(position);
    if (!point) {
      point = new FiberPoint(position);
      this.points.set(position, point);
    }
    return point;
  }

  setSource(position: vec2, attached: boolean) {
    const point = attached ? this.point(position) : this.points.get(position);
    if (!point || point.source === attached) return;
    point.source = attached;
    if (attached) point.distance = 0;
    else if (!point.incident.size) this.points.delete(position);
    this.dirty = true;
  }

  // A free tip extends its own route. Only a connection to an existing point
  // can shorten a route elsewhere. Coordinate equality alone is not a fusion.
  extend(a: vec2, b: vec2, trailId: symbol, length: number) {
    const from = this.points.get(a)!;
    const existing = this.points.get(b);
    const tail = from.incident.size === 1 ? from.incident.values().next().value : undefined;
    if (
      !existing &&
      !from.source &&
      tail &&
      tail.to === from &&
      tail.trailId === trailId &&
      !tail.sealed &&
      tail.length + length <= this.tuning.stretchLength
    ) {
      this.points.delete(a);
      from.position = b;
      this.points.set(b, from);
      from.distance += length;
      tail.length += length;
      return tail;
    }

    const to = existing ?? this.point(b);
    const stretch = new Stretch(from, to, trailId, length);
    from.incident.add(stretch);
    to.incident.add(stretch);
    this.stretches.add(stretch);
    if (existing) this.dirty = true;
    else to.distance = from.distance + length;
    return stretch;
  }

  refreshDistances() {
    if (!this.dirty) return;
    this.dirty = false;
    const queue = new DistanceQueue<FiberPoint>();
    for (const point of this.points.values()) {
      point.distance = point.source ? 0 : Infinity;
      if (point.source) queue.add(point, 0);
    }
    for (let next; (next = queue.take()); ) {
      const { value: point, distance } = next;
      if (distance !== point.distance) continue;
      for (const stretch of point.incident) {
        const neighbor = stretch.other(point);
        const via = distance + stretch.length;
        if (via >= neighbor.distance) continue;
        neighbor.distance = via;
        queue.add(neighbor, via);
      }
    }
  }

  sever(stretch: Stretch) {
    stretch.dead = true;
    stretch.health = 0;
    this.stretches.delete(stretch);
    for (const point of [stretch.from, stretch.to]) {
      point.incident.delete(stretch);
      if (!point.source && !point.incident.size) this.points.delete(point.position);
    }
    // Removing an already unreachable edge cannot change a surviving route.
    if (Number.isFinite(stretch.from.distance)) this.dirty = true;
  }

  supply(distance: number) {
    return Math.exp(-distance / this.tuning.nutrientLength);
  }

  growthFactor(distance: number, health: number) {
    const maintenance = this.tuning.maintenanceSupply;
    return health * Math.max(0, (this.supply(distance) - maintenance) / (1 - maintenance));
  }
}

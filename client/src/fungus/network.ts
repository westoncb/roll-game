import { vec2 } from "gl-matrix";
import { fiberColorSteps } from "./config";
import { DistanceQueue } from "./distance-queue";
import type { FungalGem } from "./gem";

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

export class Vertex {
  readonly incident = new Set<Stretch>();
  gem?: FungalGem;
  distance = Infinity;
  constructor(public position: vec2) {}

  get health() {
    if (this.gem) return 1;
    let health = 0;
    for (const stretch of this.incident) health = Math.max(health, stretch.health);
    return health;
  }
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
    readonly from: Vertex,
    readonly to: Vertex,
    readonly trailId: symbol,
    public length: number
  ) {}

  other(point: Vertex) {
    return point === this.from ? this.to : this.from;
  }

  get midpointDistance() {
    return Math.min(this.from.distance, this.to.distance) + this.length / 2;
  }
}

export class FiberNetwork {
  readonly vertices = new Set<Vertex>();
  readonly stretches = new Set<Stretch>();
  private dirty = false;

  constructor(private readonly maxStretchLength: number) {}

  createVertex(position: vec2) {
    const vertex = new Vertex(position);
    this.vertices.add(vertex);
    return vertex;
  }

  setGem(vertex: Vertex, gem: FungalGem | undefined) {
    vertex.gem = gem;
    if (gem) vertex.distance = 0;
    else if (!vertex.incident.size) this.vertices.delete(vertex);
    this.dirty = true;
  }

  extend(from: Vertex, position: vec2, trailId: symbol) {
    const length = vec2.distance(from.position, position);
    const tail = from.incident.size === 1 ? from.incident.values().next().value : undefined;
    if (
      !from.gem &&
      tail &&
      tail.to === from &&
      tail.trailId === trailId &&
      !tail.sealed &&
      tail.length + length <= this.maxStretchLength
    ) {
      from.position = position;
      from.distance += length;
      tail.length += length;
      return tail;
    }

    const to = this.createVertex(position);
    to.distance = from.distance + length;
    return this.connect(from, to, trailId, length);
  }

  join(from: Vertex, to: Vertex, trailId: symbol) {
    this.dirty = true;
    return this.connect(from, to, trailId, vec2.distance(from.position, to.position));
  }

  private connect(from: Vertex, to: Vertex, trailId: symbol, length: number) {
    const stretch = new Stretch(from, to, trailId, length);
    from.incident.add(stretch);
    to.incident.add(stretch);
    this.stretches.add(stretch);
    return stretch;
  }

  refreshDistances() {
    if (!this.dirty) return;
    this.dirty = false;
    const queue = new DistanceQueue<Vertex>();
    for (const point of this.vertices) {
      point.distance = point.gem ? 0 : Infinity;
      if (point.gem) queue.add(point, 0);
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
    this.stretches.delete(stretch);
    for (const point of [stretch.from, stretch.to]) {
      point.incident.delete(stretch);
      if (!point.gem && !point.incident.size) this.vertices.delete(point);
    }
    // Removing an already unreachable edge cannot change a surviving route.
    if (Number.isFinite(stretch.from.distance)) this.dirty = true;
  }
}

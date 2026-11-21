import { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import { MinQueue } from "./min-queue";
import { Fibers, type FungalFabric } from "./fabric";
import type { GrowthDomain } from "./domain";
import { Filaments, type Buds } from "./filaments";
import { Wounds } from "./wound";

// The graph only needs an attachment site. The game supplies its drawable gem.
type GemSite = { readonly id: string; readonly vertex: Vertex };

export class Vertex {
  readonly incident = new Set<Stretch>();
  gem?: GemSite;
  distance = Infinity;
  constructor(public position: vec2) {}

  get alive() {
    return this.gem !== undefined || this.incident.size > 0;
  }

  get health() {
    if (this.gem) return 1;
    let health = 0;
    for (const s of this.incident) health = Math.max(health, s.health);
    return health;
  }
}

export class Stretch {
  readonly fibers = new Fibers();
  health = 1;
  sealed = false; // A wound in flight fixes the route it is traveling.
  constructor(
    readonly from: Vertex,
    readonly to: Vertex,
    public length: number
  ) {}

  get distance() {
    return Math.min(this.from.distance, this.to.distance) + this.length / 2;
  }

  other(vertex: Vertex) {
    return vertex === this.from ? this.to : this.from;
  }
}

// Only a growing trail can lengthen its last stretch. Forks start fresh trails.
export type Trail = { vertex: Vertex; readonly id: symbol; buds: Buds; last?: Stretch };

export class Mycelium<Gem extends GemSite = GemSite> {
  readonly stretches = new Set<Stretch>();
  readonly gems = new Map<string, Gem>();
  readonly wounds: Wounds;
  private readonly filaments: Filaments;
  private time = 0;
  private routesChanged = false;

  constructor(
    readonly tuning: Readonly<ColonyTuning>,
    readonly fabric: FungalFabric,
    private readonly domain: GrowthDomain,
    seed: number
  ) {
    this.wounds = new Wounds(tuning);
    this.filaments = new Filaments(seed ^ 6035, tuning);
  }

  attach(gem: Gem) {
    this.gems.set(gem.id, gem);
    gem.vertex.gem = gem;
    gem.vertex.distance = 0;
    this.routesChanged = true;
  }

  extract(gem: Gem, time: number) {
    this.update(time);
    this.gems.delete(gem.id);
    gem.vertex.gem = undefined;
    gem.vertex.distance = Infinity;
    this.routesChanged = true;
    this.refreshRoutes();
    if (gem.vertex.alive) this.wounds.start(gem.vertex, time);
  }

  advanceWounds(time: number) {
    this.wounds.advance(time, this.time, this.stretches);
  }

  trail(vertex: Vertex): Trail {
    return { vertex, id: Symbol(), buds: this.filaments.newBuds() };
  }

  // A position extends the trail freely. A vertex explicitly joins the two routes.
  grow(trail: Trail, destination: vec2 | Vertex, tick: number) {
    if (destination === trail.vertex) return;
    const a = trail.vertex.position;
    const b = destination instanceof Vertex ? destination.position : destination;
    const length = vec2.distance(a, b);
    const pieces = Math.max(1, Math.ceil(length / this.tuning.stretchLength));
    for (let i = 1; i <= pieces; i++) {
      const start = trail.vertex.position;
      const end = i === pieces ? b : vec2.lerp(vec2.create(), a, b, i / pieces);
      const owner = this.extend(trail, i === pieces ? destination : end);
      const pieceLength = vec2.distance(start, end);
      if (pieceLength) {
        this.fabric.deposit(owner.fibers, start, end, tick, trail.id, pieceLength / length);
        this.filaments.budAlong(start, end, pieceLength, trail.buds, owner, tick);
      }
    }
  }

  private extend(trail: Trail, destination: Vertex | vec2) {
    const from = trail.vertex;
    const join = destination instanceof Vertex;
    const position = join ? destination.position : destination;
    const length = vec2.distance(from.position, position);
    const last = trail.last;
    if (
      !join &&
      last &&
      !last.sealed &&
      !from.gem &&
      from.incident.size === 1 &&
      from.incident.has(last) &&
      last.length + length <= this.tuning.stretchLength
    ) {
      from.position = position;
      from.distance += length;
      last.length += length;
      return last;
    }
    const to = join ? destination : new Vertex(position);
    const s = new Stretch(from, to, length);
    from.incident.add(s);
    to.incident.add(s);
    this.stretches.add(s);
    trail.vertex = to;
    trail.last = s;
    if (join) this.routesChanged = true;
    else to.distance = from.distance + length;
    return s;
  }

  finishGrowth(tick: number) {
    this.refreshRoutes();
    this.filaments.grow(tick, this.domain, this);
  }

  refreshRoutes() {
    if (!this.routesChanged) return;
    this.routesChanged = false;
    const queue = new MinQueue<Vertex>();
    for (const s of this.stretches) s.from.distance = s.to.distance = Infinity;
    for (const { vertex } of this.gems.values()) {
      vertex.distance = 0;
      queue.add(vertex, 0);
    }
    for (let visit; (visit = queue.take()); ) {
      const { value: vertex, priority: distance } = visit;
      if (vertex.distance !== distance) continue;
      for (const s of vertex.incident) {
        const neighbor = s.other(vertex);
        const via = distance + s.length;
        if (via < neighbor.distance) {
          neighbor.distance = via;
          queue.add(neighbor, via);
        }
      }
    }
    for (const s of this.stretches) if (!Number.isFinite(s.distance)) this.remove(s);
    this.filaments.prune(this.stretches);
  }

  private remove(s: Stretch) {
    this.stretches.delete(s);
    s.from.incident.delete(s);
    s.to.incident.delete(s);
    this.wounds.active.delete(s);
    this.fabric.release(s.fibers, this.time);
  }

  growthAt(site: Vertex | Stretch) {
    const { nutrientLength, maintenanceSupply } = this.tuning;
    const power = Math.exp(-site.distance / nutrientLength);
    return site.health * Math.max(0, (power - maintenanceSupply) / (1 - maintenanceSupply));
  }

  update(time: number) {
    const dt = time - this.time;
    if (dt <= 0) return;
    const { nutrientLength, maintenanceSupply, starvationSeconds, lowSupplyDecayBoost } =
      this.tuning;
    const previous = this.time;
    this.time = time;
    // Distances stay fixed through this pass. Resolve all severed routes together.
    for (const s of this.stretches) {
      const power = Math.exp(-s.distance / nutrientLength);
      const balance = power / maintenanceSupply - 1;
      const rate =
        balance < 0 ? balance * (1 + lowSupplyDecayBoost * balance ** 2) : balance;
      const damage = this.wounds.damage(s, previous, time);
      s.health = Math.max(
        0,
        Math.min(1, s.health + (dt * rate) / starvationSeconds - damage)
      );
      if (s.health === 0) {
        this.remove(s);
        this.routesChanged = true;
      } else {
        this.fabric.shade(s.fibers, s.health, power);
      }
    }
    this.refreshRoutes();
    this.fabric.crumble(time);
  }
}

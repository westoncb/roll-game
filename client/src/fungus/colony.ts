import { vec2 } from "gl-matrix";
import { castCapsule } from "../engine/collision";
import { Drawable2D } from "../engine/drawable";
import type { Entity } from "../engine/entity";
import { closestPointOnSegment, seededRandom, tau } from "../engine/math";
import {
  defaultColonySeed,
  resolveColonyTuning,
  type ColonyData,
  type ColonyTuning
} from "./config";
import { GrowthDomain } from "./domain";
import { FungalNode } from "./gem";
import { colonyPalette, type ColonyPalette } from "./palette";
import { FungalFabric } from "./fabric";
import type { Strand, Stretch } from "./network";
import { WoundPulse } from "./wound";

export type Junction = { position: vec2; arrivals: number; node?: FungalNode };
type MainStrand = Extract<Strand, { kind: "main" }>;
type Tip = {
  p: vec2;
  angle: number;
  bend: number;
  age: number;
  weight: number;
  credit: number;
  strand: MainStrand;
  origin: Junction;
  launchExit?: vec2;
  buds: Buds;
};
type Buds = { next: number; left: number; side: number; fan: number; length: number };
type Filament = {
  owner: Stretch;
  p: vec2;
  angle: number;
  guide: number;
  bend: number;
  phase: number;
  speed: number;
  length: number;
  budget: number;
  credit: number;
  forkAt: number;
  born: number;
  strand: Extract<Strand, { kind: "minor" }>;
};
type Proposal = { tip: Tip; p: vec2; angle: number; bend: number };
type Fusion = { a: Proposal; target: Proposal | Junction; gap: number };

function junction(position: vec2, arrivals = 0): Junction {
  return { position, arrivals };
}
function mainStrand(): MainStrand {
  return { kind: "main", trailId: Symbol() };
}

export class FungalColony implements Entity {
  readonly id: string;
  readonly nodes = new Map<string, FungalNode>();
  readonly palette: ColonyPalette;
  readonly tuning: Readonly<ColonyTuning>;
  readonly fabric: FungalFabric;
  private readonly detached = new Set<FungalNode>();
  private pulses: WoundPulse[] = [];
  readonly visual = new Drawable2D((ctx) => {
    this.fabric.draw(ctx, this.time);
    ctx.fillStyle = this.palette.tip;
    ctx.beginPath();
    for (const tip of this.tips) {
      ctx.moveTo(tip.p[0] + 1.6, tip.p[1]);
      ctx.arc(tip.p[0], tip.p[1], 1.6, 0, tau);
    }
    ctx.fill();
  });
  private tips: Tip[] = [];
  private filaments: Filament[] = [];
  private sites: Junction[] = [];
  private readonly random;
  private readonly minorRandom;
  private time = 0;
  private tick = 0;
  private tissueTick = 0;
  private nextNode = 1;
  private readonly authoredIds: Set<string>;

  constructor(
    data: ColonyData,
    private readonly domain: GrowthDomain,
    releaseAsh?: (position: vec2, amount: number) => void
  ) {
    this.id = data.id;
    this.tuning = resolveColonyTuning(data.tuning, data.id);
    this.authoredIds = new Set(data.nodes.map((node) => node.id));
    this.palette = colonyPalette(data.primaryColor);
    this.fabric = new FungalFabric(this.palette, this.tuning, releaseAsh);
    const seed = data.seed ?? defaultColonySeed;
    this.random = seededRandom(seed);
    this.minorRandom = seededRandom(seed ^ 6035);
    for (const n of data.nodes) {
      const p = vec2.fromValues(...n.position);
      if (!domain.clear(p, p, this.tuning.nodeRadius))
        throw new Error(
          `Colony "${data.id}" node "${n.id}" overlaps terrain or the level boundary.`
        );
      const site = junction(p, this.tuning.fusionArrivals);
      this.sites.push(site);
      this.addNode(n.id, site, false);
    }
    for (const [from, to] of data.strands ?? []) {
      const a = this.nodes.get(from)!.junction,
        b = this.nodes.get(to)!.junction;
      if (!domain.clear(a.position, b.position, this.tuning.mainRadius))
        throw new Error(`Colony "${data.id}" strand "${from}" to "${to}" crosses terrain.`);
      const strand = mainStrand(),
        buds = this.newBuds();
      const count = Math.max(1, Math.ceil(vec2.distance(a.position, b.position) / 6));
      let previous = a.position;
      for (let i = 1; i <= count; i++) {
        const p =
          i === count
            ? b.position
            : vec2.lerp(vec2.create(), a.position, b.position, i / count);
        this.depositMain(previous, p, strand, buds);
        previous = p;
      }
    }
    this.fabric.network.refreshDistances();
    if (data.tips) {
      for (const { from, direction } of data.tips) {
        const site = this.nodes.get(from)!.junction;
        this.launchFrom(site, Math.atan2(direction[1], direction[0]));
      }
    } else {
      for (const site of this.sites) {
        const phase = this.random() * tau;
        for (let i = 0; i < 6; i++)
          this.launchFrom(site, phase + ((i + 0.3 * this.random()) * tau) / 6);
      }
    }
  }

  private addNode(id: string, site: Junction, growing: boolean) {
    site.node = new FungalNode(id, site, this, growing);
    this.nodes.set(id, site.node);
    this.fabric.network.setSource(site.position, true);
    this.fabric.enclose(site.position, site.node.radius);
  }

  private mature(site: Junction) {
    let id: string;
    do {
      id = "knot-" + this.nextNode++;
    } while (this.authoredIds.has(id));
    this.addNode(id, site, true);
  }

  detachNode(node: FungalNode) {
    if (!this.nodes.delete(node.id)) return;
    // Tissue lived on its previous supply until this instant.
    this.updateTissue(this.time);
    node.junction.node = undefined;
    this.fabric.network.setSource(node.junction.position, false);
    this.fabric.shedDisconnected();
    this.pruneGrowth();
    const point = this.fabric.network.points.get(node.junction.position);
    if (point) this.pulses.push(new WoundPulse(point, this.time, this.tuning));
    const index = this.sites.indexOf(node.junction);
    if (index >= 0) this.sites.splice(index, 1);
    this.detached.add(node);
    if (!this.nodes.size) {
      this.tips = [];
      this.filaments = [];
    }
  }

  private hasRoomForKnot(position: vec2, spacing: number) {
    if (this.fabric.network.points.get(position)?.source) return false;
    for (const node of this.nodes.values()) {
      if (vec2.squaredDistance(position, node.junction.position) < spacing ** 2)
        return false;
    }
    return this.domain.clear(position, position, this.tuning.nodeRadius);
  }

  private tryFusionKnot(site: Junction) {
    const { fusionArrivals, fusionKnotSpacingRadii, nodeRadius } = this.tuning;
    if (
      !site.node &&
      site.arrivals === fusionArrivals &&
      this.hasRoomForKnot(site.position, fusionKnotSpacingRadii * nodeRadius)
    )
      this.mature(site);
  }

  /** Target query for a grapple cast. Stable node IDs are local to this colony. */
  castNode(from: vec2, to: vec2, movingRadius = 0) {
    let first: (NonNullable<ReturnType<typeof castCapsule>> & { node: FungalNode }) | null =
      null;
    for (const node of this.nodes.values()) {
      const hit = node.cast(from, to, movingRadius);
      if (hit && (!first || hit.fraction < first.fraction)) first = { ...hit, node };
    }
    return first;
  }

  playerContact(from: vec2, to: vec2, radius: number) {
    if (!this.nodes.size) return null;
    const { min, max } = this.fabric.bounds;
    if (
      Math.min(from[0], to[0]) - radius > max[0] ||
      Math.max(from[0], to[0]) + radius < min[0] ||
      Math.min(from[1], to[1]) - radius > max[1] ||
      Math.max(from[1], to[1]) + radius < min[1]
    )
      return null;
    let first: ReturnType<typeof castCapsule> = this.castNode(from, to, radius);
    for (const s of this.fabric.nearby(from, to, radius, true)) {
      const hit = castCapsule(from, to, radius, s.a, s.b, s.radius);
      if (hit && (!first || hit.fraction < first.fraction)) first = hit;
    }
    return first && { ...first, colonyId: this.id };
  }

  private gap() {
    return (
      this.tuning.minBudGroupGap -
      this.tuning.meanExtraBudGroupGap * Math.log(1 - this.minorRandom())
    );
  }
  private newBuds(): Buds {
    return { next: this.gap(), left: 0, side: 1, fan: 0, length: 0 };
  }
  private newTip(site: Junction, angle: number, weight: number, origin = site): Tip {
    return {
      p: site.position,
      angle,
      weight,
      credit: 0,
      age: 0,
      bend: 0,
      origin,
      strand: mainStrand(),
      buds: this.newBuds()
    };
  }

  private launchFrom(site: Junction, preferredAngle?: number) {
    const { growthStep, gemLaunchReach, mainRadius, mainSegmentsPerTile } = this.tuning;
    if (!mainSegmentsPerTile) return;
    const phase = preferredAngle ?? this.random() * tau;
    const reach = Math.max(growthStep, gemLaunchReach);
    const sample = vec2.create();
    let best: { angle: number; exit: vec2; score: number } | undefined;
    for (let i = 0; i < 12; i++) {
      const angle = phase + (i * tau) / 12;
      // Also try shorter routes in pockets where the full probe would cross terrain.
      for (let d = reach; ; d = Math.max(growthStep, d / 2)) {
        vec2.set(
          sample,
          site.position[0] + d * Math.cos(angle),
          site.position[1] + d * Math.sin(angle)
        );
        const room = 1 - this.fabric.density(sample, "main") / mainSegmentsPerTile;
        if (room > 0 && this.domain.clear(site.position, sample, mainRadius)) {
          const score = room * d;
          if (!best || score > best.score)
            best = { angle, exit: vec2.clone(sample), score };
          break;
        }
        if (d === growthStep) break;
      }
      if (best && (preferredAngle !== undefined || best.score === reach)) break;
    }
    if (!best) return;
    const tip = this.newTip(site, best.angle, 1);
    if (this.fabric.crowded(site.position, "main")) tip.launchExit = best.exit;
    this.tips.push(tip);
  }

  private depositMain(a: vec2, b: vec2, strand: MainStrand, buds: Buds) {
    if (a === b) return false;
    const length = vec2.distance(a, b);
    const pieces = Math.max(1, Math.ceil(length / this.tuning.stretchLength));
    let startedBudGroup = false;
    let start = a;
    for (let i = 1; i <= pieces; i++) {
      const end = i === pieces ? b : vec2.lerp(vec2.create(), a, b, i / pieces);
      const pieceLength = vec2.distance(start, end);
      const owner = this.fabric.network.extend(start, end, strand.trailId, pieceLength);
      if (pieceLength) {
        this.fabric.deposit(start, end, strand, this.tick, owner, pieceLength / length);
        if (this.budAlong(start, end, pieceLength, buds, owner)) startedBudGroup = true;
      }
      start = end;
    }
    return startedBudGroup;
  }

  private budAlong(a: vec2, b: vec2, length: number, buds: Buds, owner: Stretch) {
    const tangent = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const rand = this.minorRandom;
    let startedBudGroup = false;
    while (buds.next <= length) {
      if (!buds.left) {
        startedBudGroup = true;
        buds.left = 2 + Math.floor(rand() * 5);
        buds.side = rand() < 0.5 ? -1 : 1;
        buds.fan = 0.22 + 0.6 * rand();
        buds.length = 10 + 43 * rand() ** 1.45;
      }
      const root = vec2.lerp(vec2.create(), a, b, buds.next / length);
      const bias = buds.fan + 0.55 * (2 * rand() - 1);
      const budget = buds.length * (0.6 + 0.95 * rand());
      this.filaments.push({
        p: root,
        owner,
        angle: tangent + buds.side * bias,
        guide: tangent + buds.side * (0.16 + 0.4 * bias),
        bend: 0,
        phase: rand() * tau,
        speed: 0.72 + 0.51 * rand(),
        length: 0,
        budget,
        credit: 0,
        forkAt:
          rand() < this.tuning.minorForkChance ? budget * (0.3 + 0.32 * rand()) : Infinity,
        born: this.tick + 2 + Math.floor(rand() * 8),
        strand: { kind: "minor" }
      });
      buds.left--;
      buds.next += buds.left ? 0.8 + 1.9 * rand() : this.gap();
    }
    buds.next -= length;
    return startedBudGroup;
  }

  private growFilaments() {
    const active: Filament[] = [];
    const rand = this.minorRandom;
    for (const f of this.filaments) {
      if (f.owner.dead) continue;
      if (this.tick < f.born) {
        active.push(f);
        continue;
      }
      f.credit += this.fabric.network.growthFactor(
        f.owner.midpointDistance,
        f.owner.health
      );
      if (f.credit < 1) {
        active.push(f);
        continue;
      }
      f.credit--;
      if (f.length + f.speed > f.budget || this.fabric.crowded(f.p, "minor")) continue;
      const [x, y] = f.p;
      const drift =
        0.49 * Math.sin(x / 24 + y / 36) +
        0.27 * Math.cos(y / 16 - x / 28) +
        0.26 * Math.sin(f.length / 12 + f.phase);
      f.bend = 0.87 * f.bend + 0.018 * (2 * rand() - 1);
      f.angle += f.speed * (0.05 * Math.sin(f.guide + drift - f.angle) + f.bend);
      const p = vec2.fromValues(
        x + f.speed * Math.cos(f.angle),
        y + f.speed * Math.sin(f.angle)
      );
      if (!this.domain.clear(f.p, p, this.tuning.minorRadius)) continue;
      this.fabric.deposit(f.p, p, f.strand, this.tick, f.owner);
      f.p = p;
      f.length += f.speed;
      active.push(f);
      if (f.length >= f.forkAt) {
        const offset = (rand() < 0.5 ? -1 : 1) * (0.38 + 0.48 * rand());
        active.push({
          ...f,
          angle: f.angle + offset,
          guide: f.guide + 0.55 * offset,
          length: 0,
          budget: f.budget * (0.21 + 0.31 * rand()),
          forkAt: Infinity,
          speed: f.speed * 0.84,
          credit: 0,
          strand: { kind: "minor" }
        });
        f.forkAt = Infinity;
      }
    }
    this.filaments = active;
  }

  private propose(tip: Tip): Proposal | null {
    const { followRadius, attractionRadius, matureTipTicks, growthStep, mainRadius } =
      this.tuning;
    // Cross a crowded gem tile one normal deposit at a time toward the clear exit.
    if (tip.launchExit && this.fabric.crowded(tip.p, "main")) {
      if (this.fabric.crowded(tip.launchExit, "main")) return null;
      const distance = vec2.distance(tip.p, tip.launchExit);
      const p = vec2.lerp(
        vec2.create(),
        tip.p,
        tip.launchExit,
        Math.min(1, growthStep / distance)
      );
      return this.domain.clear(tip.p, p, mainRadius)
        ? { tip, p, angle: tip.angle, bend: 0 }
        : null;
    }
    tip.launchExit = undefined;
    let follow = 0,
      attract = 0,
      nearest = followRadius;
    const sample = vec2.create();
    for (const s of this.fabric.nearby(tip.p, tip.p, followRadius, false)) {
      if (
        this.tick - s.tick < 7 ||
        (s.strand.kind === "main" && s.strand.trailId === tip.strand.trailId)
      )
        continue;
      closestPointOnSegment(sample, tip.p, s.a, s.b);
      const d = vec2.distance(tip.p, sample);
      if (d >= nearest || !this.domain.clear(tip.p, sample, 0)) continue;
      nearest = d;
      const tangent = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      follow = 0.08 * (1 - d / followRadius) * Math.sin(2 * (tangent - tip.angle));
    }
    nearest = attractionRadius;
    const sense = (p: vec2) => {
      const x = p[0] - tip.p[0],
        y = p[1] - tip.p[1],
        d = Math.hypot(x, y);
      if (
        d >= nearest ||
        x * Math.cos(tip.angle) + y * Math.sin(tip.angle) <= 0 ||
        !this.domain.clear(tip.p, p, 0)
      )
        return;
      nearest = d;
      attract = 0.27 * (1 - d / attractionRadius) * Math.sin(Math.atan2(y, x) - tip.angle);
    };
    if (tip.age >= matureTipTicks) {
      for (const other of this.tips)
        if (other !== tip && other.age >= matureTipTicks) sense(other.p);
      for (const site of this.sites) if (site !== tip.origin) sense(site.position);
    }
    const bend = 0.91 * tip.bend + 0.032 * (2 * this.random() - 1);
    const heading = tip.angle + Math.max(-0.25, Math.min(0.25, bend + follow + attract));
    // Try progressively wider turns on both sides of the preferred heading.
    for (let k = 0; k < 12; k++) {
      const sign = (k % 2 ? 1 : -1) * (bend < 0 ? -1 : 1);
      const angle = heading + (sign * Math.ceil(k / 2) * Math.PI) / 6;
      const p = vec2.fromValues(
        tip.p[0] + growthStep * Math.cos(angle),
        tip.p[1] + growthStep * Math.sin(angle)
      );
      if (!this.fabric.crowded(p, "main") && this.domain.clear(tip.p, p, mainRadius))
        return { tip, p, angle, bend };
    }
    return null;
  }

  private finishAt(proposal: Proposal, site: Junction) {
    const t = proposal.tip;
    this.depositMain(t.p, site.position, t.strand, t.buds);
  }

  private grow() {
    this.tick++;
    const {
      matureTipTicks,
      mergeRadius,
      nodeRadius,
      mainRadius,
      growthStep,
      meanSplitLength,
      minSplitWeight,
      branchKnotSpacing
    } = this.tuning;
    const proposals: Proposal[] = [],
      waiting: Proposal[] = [],
      next: Tip[] = [];
    const network = this.fabric.network;
    for (const node of this.nodes.values()) {
      if (node.readyToLaunch(this.tuning.tickSeconds)) this.launchFrom(node.junction);
    }
    for (const tip of this.tips) {
      const point = network.points.get(tip.p);
      if (!point) continue;
      // Fixed-length deposits keep branch probability, density and bud spacing per unit
      // of growth. A living, underfed tip can resume if another route supplies it.
      let health = point.source ? 1 : 0;
      for (const s of point.incident) health = Math.max(health, s.health);
      tip.credit += tip.weight * network.growthFactor(point.distance, health);
      if (tip.credit < 1) {
        waiting.push({ tip, p: tip.p, angle: tip.angle, bend: tip.bend });
        continue;
      }
      tip.credit--;
      const proposal = this.propose(tip);
      if (proposal) proposals.push(proposal);
    }
    const candidates: Fusion[] = [];
    const targets = proposals.concat(waiting);
    for (let i = 0; i < proposals.length; i++) {
      const a = proposals[i];
      if (a.tip.age + 1 < matureTipTicks) continue;
      for (const site of this.sites) {
        const gap = vec2.distance(a.p, site.position);
        if (site !== a.tip.origin && gap <= mergeRadius)
          candidates.push({ a, target: site, gap });
      }
      for (let j = i + 1; j < targets.length; j++) {
        const b = targets[j],
          gap = vec2.distance(a.p, b.p);
        if (
          b.tip.age + (j < proposals.length ? 1 : 0) >= matureTipTicks &&
          gap <= mergeRadius
        )
          candidates.push({ a, target: b, gap });
      }
    }
    candidates.sort((a, b) => a.gap - b.gap);
    const used = new Set<Proposal>();
    for (const { a, target } of candidates) {
      if (used.has(a)) continue;
      if ("tip" in target) {
        if (used.has(target)) continue;
        // A moving tip can reconnect a paused tip at its existing endpoint.
        const p =
          target.p === target.tip.p
            ? target.p
            : vec2.lerp(vec2.create(), a.p, target.p, 0.5);
        if (
          !this.domain.clear(p, p, nodeRadius) ||
          !this.domain.clear(a.tip.p, p, mainRadius) ||
          !this.domain.clear(target.tip.p, p, mainRadius)
        )
          continue;
        const site = junction(p, 2);
        this.sites.push(site);
        this.tryFusionKnot(site);
        this.finishAt(a, site);
        this.finishAt(target, site);
        used.add(target);
        const w = a.tip.weight,
          v = target.tip.weight;
        const x = w * Math.cos(a.angle) + v * Math.cos(target.angle),
          y = w * Math.sin(a.angle) + v * Math.sin(target.angle);
        next.push(
          this.newTip(
            site,
            Math.hypot(x, y) < 0.1 * (w + v) ? a.angle : Math.atan2(y, x),
            Math.min(1, w + v)
          )
        );
      } else {
        if (!this.domain.clear(a.tip.p, target.position, mainRadius)) continue;
        this.finishAt(a, target);
        target.arrivals++;
        this.tryFusionKnot(target);
      }
      used.add(a);
    }
    for (const p of waiting) if (!used.has(p)) next.push(p.tip);
    for (const p of proposals) {
      if (used.has(p)) continue;
      const t = p.tip;
      const startedBudGroup = this.depositMain(t.p, p.p, t.strand, t.buds);
      t.p = p.p;
      t.angle = p.angle;
      t.bend = p.bend;
      if (t.launchExit) {
        next.push(t);
        continue;
      }
      t.age++;
      const splits =
        t.age >= matureTipTicks &&
        t.weight >= minSplitWeight &&
        this.random() < -Math.expm1(-growthStep / meanSplitLength);
      const formsKnot =
        (splits || startedBudGroup) && this.hasRoomForKnot(t.p, branchKnotSpacing);
      if (!splits && !formsKnot) {
        next.push(t);
        continue;
      }
      const branch = junction(t.p, 1);
      // Branch knots launch heads too. Only authored knots and fusion sites attract fusions.
      if (formsKnot) this.mature(branch);
      if (splits) {
        const spread = 0.37 + 0.33 * this.random();
        for (const sign of [-1, 1])
          next.push(this.newTip(branch, t.angle + sign * spread, t.weight / 2, t.origin));
      } else {
        next.push(t);
      }
    }
    network.refreshDistances();
    this.tips = next;
    this.growFilaments();
  }

  private updateTissue(time: number) {
    this.fabric.updateTissue(time);
    this.pruneGrowth();
  }

  private pruneGrowth() {
    const points = this.fabric.network.points;
    this.sites = this.sites.filter((site) => points.has(site.position));
    this.tips = this.tips.filter((tip) => points.has(tip.p));
    this.filaments = this.filaments.filter((filament) => !filament.owner.dead);
  }

  update(dt: number) {
    const end = this.time + dt;
    const { tickSeconds, nutrientStepSeconds } = this.tuning;
    // Both clocks run in simulation time. Tissue keeps aging after the last extraction.
    while (this.time < end) {
      const growthAt = this.nodes.size ? (this.tick + 1) * tickSeconds : Infinity;
      const tissueAt = (this.tissueTick + 1) * nutrientStepSeconds;
      const until = Math.min(end, growthAt, tissueAt);
      for (const node of this.nodes.values()) node.growIn(until - this.time);
      this.time = until;
      if (this.pulses.length)
        this.pulses = this.pulses.filter((pulse) => pulse.advance(until, this.fabric));
      if (until === tissueAt) {
        this.tissueTick++;
        this.updateTissue(until);
      }
      if (until === growthAt) this.grow();
    }
  }

  afterPhysics(dt: number) {
    for (const node of this.detached) {
      if (node.advanceReturn(dt)) {
        node.visual.dispose();
        this.detached.delete(node);
      }
    }
  }
}

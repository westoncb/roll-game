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
import { FungalFabric, type Junction, type MainStrand, type MinorStrand } from "./fabric";

type Tip = {
  p: vec2;
  angle: number;
  bend: number;
  age: number;
  weight: number;
  strand: MainStrand;
  origin: Junction;
  buds: Buds;
};
type Buds = { next: number; left: number; side: number; fan: number; length: number };
type Filament = {
  p: vec2;
  angle: number;
  guide: number;
  bend: number;
  phase: number;
  speed: number;
  length: number;
  budget: number;
  forkAt: number;
  born: number;
  strand: MinorStrand;
};
type Proposal = { tip: Tip; p: vec2; angle: number; bend: number };
type Fusion = { a: Proposal; target: Proposal | Junction; gap: number };

function junction(position: vec2, arrivals = 0): Junction {
  return { position, arrivals, strands: [] };
}
function mainStrand(from: Junction, trailId = Symbol()): MainStrand {
  const strand: MainStrand = { kind: "main", from, trailId };
  from.strands.push(strand);
  return strand;
}
function closeStrand(strand: MainStrand, to: Junction) {
  strand.to = to;
  to.strands.push(strand);
}

export class FungalColony implements Entity {
  readonly id: string;
  readonly nodes = new Map<string, FungalNode>();
  readonly palette: ColonyPalette;
  readonly tuning: Readonly<ColonyTuning>;
  readonly fabric: FungalFabric;
  private readonly detached = new Set<FungalNode>();
  readonly visual = new Drawable2D((ctx) => {
    if (!this.nodes.size) ctx.globalAlpha *= 0.25;
    this.fabric.draw(ctx);
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
  private readonly sites: Junction[] = [];
  private readonly random;
  private readonly minorRandom;
  private time = 0;
  private tick = 0;
  private nextNode = 1;
  private readonly authoredIds: Set<string>;

  constructor(
    data: ColonyData,
    private readonly domain: GrowthDomain
  ) {
    this.id = data.id;
    this.tuning = resolveColonyTuning(data.tuning, data.id);
    this.authoredIds = new Set(data.nodes.map((node) => node.id));
    this.palette = colonyPalette(data.primaryColor);
    this.fabric = new FungalFabric(this.palette, this.tuning);
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
      const strand = mainStrand(a),
        buds = this.newBuds();
      closeStrand(strand, b);
      const count = Math.ceil(vec2.distance(a.position, b.position) / 6);
      let previous = a.position;
      for (let i = 1; i <= count; i++) {
        const p = vec2.lerp(vec2.create(), a.position, b.position, i / count);
        this.depositMain(previous, p, strand, buds);
        previous = p;
      }
    }
    if (data.tips) {
      for (const { from, direction } of data.tips) {
        const site = this.nodes.get(from)!.junction;
        this.tips.push(this.newTip(site, Math.atan2(direction[1], direction[0]), 1));
      }
    } else {
      for (const site of this.sites) {
        const phase = this.random() * tau;
        for (let i = 0; i < 6; i++)
          this.tips.push(
            this.newTip(site, phase + ((i + 0.3 * this.random()) * tau) / 6, 1)
          );
      }
    }
  }

  private addNode(id: string, site: Junction, growing: boolean) {
    site.node = new FungalNode(id, site, this, growing);
    this.nodes.set(id, site.node);
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
    this.nodes.delete(node.id);
    node.junction.node = undefined;
    const index = this.sites.indexOf(node.junction);
    if (index >= 0) this.sites.splice(index, 1);
    this.detached.add(node);
    if (!this.nodes.size) {
      this.tips = [];
      this.filaments = [];
    }
  }

  private hasRoomForKnot(position: vec2, spacing: number) {
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
      age: 0,
      bend: 0,
      origin,
      strand: mainStrand(site),
      buds: this.newBuds()
    };
  }

  private depositMain(a: vec2, b: vec2, strand: MainStrand, buds: Buds) {
    this.fabric.deposit(a, b, strand, this.tick);
    const length = vec2.distance(a, b);
    if (!length) return false;
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
        angle: tangent + buds.side * bias,
        guide: tangent + buds.side * (0.16 + 0.4 * bias),
        bend: 0,
        phase: rand() * tau,
        speed: 0.72 + 0.51 * rand(),
        length: 0,
        budget,
        forkAt:
          rand() < this.tuning.minorForkChance ? budget * (0.3 + 0.32 * rand()) : Infinity,
        born: this.tick + 2 + Math.floor(rand() * 8),
        strand: { kind: "minor", root, parent: strand }
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
      if (this.tick < f.born) {
        active.push(f);
        continue;
      }
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
      this.fabric.deposit(f.p, p, f.strand, this.tick);
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
          strand: { kind: "minor", root: p, parent: f.strand }
        });
        f.forkAt = Infinity;
      }
    }
    this.filaments = active;
  }

  private propose(tip: Tip): Proposal | null {
    if (this.fabric.crowded(tip.p, "main")) return null;
    const { followRadius, attractionRadius, matureTipTicks, growthStep, mainRadius } =
      this.tuning;
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
      if (this.domain.clear(tip.p, p, mainRadius)) return { tip, p, angle, bend };
    }
    return null;
  }

  private finishAt(proposal: Proposal, site: Junction) {
    const t = proposal.tip;
    this.depositMain(t.p, site.position, t.strand, t.buds);
    closeStrand(t.strand, site);
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
    const proposals = this.tips.map((t) => this.propose(t)).filter((p) => p !== null);
    const candidates: Fusion[] = [];
    for (let i = 0; i < proposals.length; i++) {
      const a = proposals[i];
      if (a.tip.age + 1 < matureTipTicks) continue;
      for (const site of this.sites) {
        const gap = vec2.distance(a.p, site.position);
        if (site !== a.tip.origin && gap <= mergeRadius)
          candidates.push({ a, target: site, gap });
      }
      for (let j = i + 1; j < proposals.length; j++) {
        const b = proposals[j],
          gap = vec2.distance(a.p, b.p);
        if (b.tip.age + 1 >= matureTipTicks && gap <= mergeRadius)
          candidates.push({ a, target: b, gap });
      }
    }
    candidates.sort((a, b) => a.gap - b.gap);
    const used = new Set<Proposal>(),
      next: Tip[] = [];
    for (const { a, target } of candidates) {
      if (used.has(a)) continue;
      if ("tip" in target) {
        if (used.has(target)) continue;
        const p = vec2.lerp(vec2.create(), a.p, target.p, 0.5);
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
            w + v
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
    for (const p of proposals) {
      if (used.has(p)) continue;
      const t = p.tip;
      const startedBudGroup = this.depositMain(t.p, p.p, t.strand, t.buds);
      t.p = p.p;
      t.angle = p.angle;
      t.bend = p.bend;
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
      closeStrand(t.strand, branch);
      // Branch knots support local growth. Authored knots and fusion sites recruit tips.
      if (formsKnot) this.mature(branch);
      if (splits) {
        const spread = 0.37 + 0.33 * this.random();
        for (const sign of [-1, 1])
          next.push(this.newTip(branch, t.angle + sign * spread, t.weight / 2, t.origin));
      } else {
        // The graph gains an edge, but the continuing tip still recognizes its own trail.
        t.strand = mainStrand(branch, t.strand.trailId);
        next.push(t);
      }
    }
    this.tips = next;
    this.growFilaments();
  }

  update(dt: number) {
    if (!this.nodes.size) return;
    for (const node of this.nodes.values()) node.growIn(dt);
    this.time += dt;
    const { tickSeconds } = this.tuning;
    while (this.time + 1e-10 >= tickSeconds) {
      this.time -= tickSeconds;
      this.grow();
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

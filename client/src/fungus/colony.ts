/**
 * The level runs one FungalColony entity per authored colony. It launches and steers
 * main tips, resolves competing fusion proposals before committing growth to the
 * mycelium, and decides where gems form. It also answers grapple and player-contact
 * queries and keeps extracted gems moving after they leave the graph.
 */
import { vec2 } from "gl-matrix";
import { castCapsule } from "../engine/collision";
import { Drawable2D } from "../engine/drawable";
import type { Entity } from "../engine/entity";
import { closestPointOnSegment, seededRandom, tau } from "../utils/math";
import {
  defaultColonySeed,
  resolveColonyTuning,
  type ColonyData,
  type ColonyTuning
} from "./config";
import { GrowthDomain } from "./domain";
import { FungalGem } from "./gem";
import { colonyPalette, type ColonyPalette } from "./palette";
import { FungalFabric } from "./fabric";
import { Mycelium, Vertex, type Trail } from "./mycelium";

type Tip = Trail & {
  angle: number;
  bend: number;
  age: number;
  weight: number;
  credit: number;
  origin: Vertex;
  distanceSinceGemCheck: number;
  launchExit?: vec2;
};
type Proposal = { moving: boolean; tip: Tip; p: vec2; angle: number; bend: number };
type Fusion = { a: Proposal; target: Proposal | Vertex; gap: number };

export class FungalColony implements Entity {
  readonly id: string;
  get gems() {
    return this.mycelium.gems;
  }
  get hasUncollectedGems() {
    if (this.gems.size) return true;
    for (const gem of this.detached) if (gem.reeling) return true;
    return false;
  }
  readonly palette: ColonyPalette;
  readonly tuning: Readonly<ColonyTuning>;
  readonly fabric: FungalFabric;
  private readonly detached = new Set<FungalGem>();
  private readonly mycelium: Mycelium<FungalGem>;
  readonly visual = new Drawable2D((ctx) => {
    this.fabric.draw(ctx);
    for (const [s, wound] of this.mycelium.wounds.active) {
      const flash =
        wound.strength * (1 - (this.time - wound.start) / this.tuning.woundFlashSeconds);
      if (flash > 0) this.fabric.flash(ctx, s.fibers, flash);
    }
    ctx.fillStyle = this.palette.tip;
    ctx.beginPath();
    for (const tip of this.tips) {
      ctx.moveTo(tip.vertex.position[0] + 1.6, tip.vertex.position[1]);
      ctx.arc(tip.vertex.position[0], tip.vertex.position[1], 1.6, 0, tau);
    }
    ctx.fill();
  });
  private tips: Tip[] = [];
  // Authored gem sites and tip fusions attract future growth. Count arrivals per site.
  private readonly fusionSites = new Map<Vertex, number>();
  private readonly random;
  private time = 0;
  private tick = 0;
  private tissueTick = 0;
  private nextGem = 1;
  private readonly authoredIds: Set<string>;

  constructor(
    data: ColonyData,
    private readonly domain: GrowthDomain,
    releaseAsh?: (position: vec2, amount: number) => void
  ) {
    this.id = data.id;
    this.tuning = resolveColonyTuning(data.tuning, data.id);
    this.authoredIds = new Set(data.nodes.map((gem) => gem.id));
    this.palette = colonyPalette(data.primaryColor);
    this.fabric = new FungalFabric(this.palette, this.tuning, domain, releaseAsh);
    const seed = data.seed ?? defaultColonySeed;
    this.random = seededRandom(seed);
    this.mycelium = new Mycelium<FungalGem>(this.tuning, this.fabric, domain, seed);
    for (const n of data.nodes) {
      const p = vec2.fromValues(...n.position);
      if (!domain.clear(p, p, this.tuning.gemRadius))
        throw new Error(
          `Colony "${data.id}" gem "${n.id}" overlaps terrain or the level boundary.`
        );
      const site = new Vertex(p);
      this.fusionSites.set(site, this.tuning.fusionArrivals);
      this.attachGem(n.id, site, false);
    }
    for (const [from, to] of data.strands ?? []) {
      const a = this.gems.get(from)!.vertex,
        b = this.gems.get(to)!.vertex;
      if (!domain.clear(a.position, b.position, this.tuning.mainRadius))
        throw new Error(`Colony "${data.id}" strand "${from}" to "${to}" crosses terrain.`);
      const trail = this.mycelium.trail(a);
      const count = Math.max(1, Math.ceil(vec2.distance(a.position, b.position) / 6));
      for (let i = 1; i <= count; i++) {
        const p =
          i === count ? b : vec2.lerp(vec2.create(), a.position, b.position, i / count);
        this.mycelium.grow(trail, p, this.tick);
      }
    }
    this.mycelium.refreshRoutes();
    if (data.tips) {
      for (const { from, direction } of data.tips) {
        const site = this.gems.get(from)!.vertex;
        this.launchFrom(site, Math.atan2(direction[1], direction[0]));
      }
    } else {
      for (const site of this.fusionSites.keys()) {
        const phase = this.random() * tau;
        for (let i = 0; i < 6; i++)
          this.launchFrom(site, phase + ((i + 0.3 * this.random()) * tau) / 6);
      }
    }
  }

  private attachGem(id: string, site: Vertex, growing: boolean) {
    const gem = new FungalGem(id, site, this, growing);
    this.mycelium.attach(gem);
  }

  private formGem(site: Vertex) {
    let id: string;
    do {
      id = "gem-" + this.nextGem++;
    } while (this.authoredIds.has(id));
    this.attachGem(id, site, true);
  }

  detachGem(gem: FungalGem) {
    if (gem.vertex.gem !== gem) return;
    this.mycelium.extract(gem, this.time);
    this.fusionSites.delete(gem.vertex);
    this.pruneGrowth();
    this.detached.add(gem);
  }

  private hasRoomForGem(vertex: Vertex, spacing: number) {
    const position = vertex.position;
    if (vertex.gem) return false;
    for (const gem of this.gems.values()) {
      if (vec2.squaredDistance(position, gem.vertex.position) < spacing ** 2) return false;
    }
    return this.domain.clear(position, position, this.tuning.gemRadius);
  }

  private recordFusion(site: Vertex) {
    const arrivals = (this.fusionSites.get(site) ?? 1) + 1;
    this.fusionSites.set(site, arrivals);
    const { fusionArrivals, fusionGemSpacingRadii, gemRadius } = this.tuning;
    if (
      arrivals === fusionArrivals &&
      this.hasRoomForGem(site, fusionGemSpacingRadii * gemRadius)
    )
      this.formGem(site);
  }

  /** Target query for a grapple cast. Stable gem IDs are local to this colony. */
  castGem(from: vec2, to: vec2, movingRadius = 0) {
    let first: (NonNullable<ReturnType<typeof castCapsule>> & { gem: FungalGem }) | null =
      null;
    for (const gem of this.gems.values()) {
      const hit = gem.cast(from, to, movingRadius);
      if (hit && (!first || hit.fraction < first.fraction)) first = { ...hit, gem };
    }
    return first;
  }

  playerContact(from: vec2, to: vec2, radius: number) {
    if (!this.gems.size) return null;
    let first: ReturnType<typeof castCapsule> = this.castGem(from, to, radius);
    for (const s of this.fabric.nearby(from, to, radius, true)) {
      const hit = castCapsule(from, to, radius, s.a, s.b, s.radius);
      if (hit && (!first || hit.fraction < first.fraction)) first = hit;
    }
    return first && { ...first, colonyId: this.id };
  }

  private newTip(site: Vertex, angle: number, weight: number, origin = site): Tip {
    return {
      ...this.mycelium.trail(site),
      angle,
      weight,
      credit: 0,
      distanceSinceGemCheck: 0,
      age: 0,
      bend: 0,
      origin
    };
  }

  private launchFrom(site: Vertex, preferredAngle?: number) {
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

  private propose(tip: Tip): Proposal | null {
    const { followRadius, attractionRadius, matureTipTicks, growthStep, mainRadius } =
      this.tuning;
    const position = tip.vertex.position;
    // Cross a crowded gem tile one normal deposit at a time toward the clear exit.
    if (tip.launchExit && this.fabric.crowded(position, "main")) {
      if (this.fabric.crowded(tip.launchExit, "main")) return null;
      const distance = vec2.distance(position, tip.launchExit);
      const p = vec2.lerp(
        vec2.create(),
        position,
        tip.launchExit,
        Math.min(1, growthStep / distance)
      );
      return this.domain.clear(position, p, mainRadius)
        ? { moving: true, tip, p, angle: tip.angle, bend: 0 }
        : null;
    }
    tip.launchExit = undefined;
    let follow = 0,
      attract = 0,
      nearest = followRadius;
    const sample = vec2.create();
    for (const s of this.fabric.nearby(position, position, followRadius, false)) {
      if (this.tick - s.tick < 7 || s.trail === tip.id) continue;
      closestPointOnSegment(sample, position, s.a, s.b);
      const d = vec2.distance(position, sample);
      if (d >= nearest || !this.domain.clear(position, sample, 0)) continue;
      nearest = d;
      const tangent = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      follow = 0.08 * (1 - d / followRadius) * Math.sin(2 * (tangent - tip.angle));
    }
    nearest = attractionRadius;
    const sense = (p: vec2) => {
      const x = p[0] - position[0],
        y = p[1] - position[1],
        d = Math.hypot(x, y);
      if (
        d >= nearest ||
        x * Math.cos(tip.angle) + y * Math.sin(tip.angle) <= 0 ||
        !this.domain.clear(position, p, 0)
      )
        return;
      nearest = d;
      attract = 0.27 * (1 - d / attractionRadius) * Math.sin(Math.atan2(y, x) - tip.angle);
    };
    if (tip.age >= matureTipTicks) {
      for (const other of this.tips)
        if (other !== tip && other.age >= matureTipTicks) sense(other.vertex.position);
      for (const site of this.fusionSites.keys())
        if (site !== tip.origin) sense(site.position);
    }
    const bend = 0.91 * tip.bend + 0.032 * (2 * this.random() - 1);
    const heading = tip.angle + Math.max(-0.25, Math.min(0.25, bend + follow + attract));
    // Try progressively wider turns on both sides of the preferred heading.
    for (let k = 0; k < 12; k++) {
      const sign = (k % 2 ? 1 : -1) * (bend < 0 ? -1 : 1);
      const angle = heading + (sign * Math.ceil(k / 2) * Math.PI) / 6;
      const p = vec2.fromValues(
        position[0] + growthStep * Math.cos(angle),
        position[1] + growthStep * Math.sin(angle)
      );
      if (!this.fabric.crowded(p, "main") && this.domain.clear(position, p, mainRadius))
        return { moving: true, tip, p, angle, bend };
    }
    return null;
  }

  private grow() {
    this.tick++;
    const proposals: Proposal[] = [],
      waiting: Proposal[] = [],
      next: Tip[] = [];
    for (const gem of this.gems.values()) {
      if (gem.readyToLaunch(this.tuning.tickSeconds)) this.launchFrom(gem.vertex);
    }
    for (const tip of this.tips) {
      const point = tip.vertex;
      // Fixed-length deposits keep branch probability, density and bud spacing per unit
      // of growth. A living, underfed tip can resume if another route supplies it.
      tip.credit += tip.weight * this.mycelium.growthAt(point);
      if (tip.credit < 1) {
        waiting.push({
          moving: false,
          tip,
          p: tip.vertex.position,
          angle: tip.angle,
          bend: tip.bend
        });
        continue;
      }
      tip.credit--;
      const proposal = this.propose(tip);
      if (proposal) proposals.push(proposal);
    }
    const used = this.fuse(proposals, waiting, next);
    for (const p of waiting) if (!used.has(p)) next.push(p.tip);
    for (const p of proposals) if (!used.has(p)) this.advanceTip(p, next);
    this.tips = next;
    this.mycelium.finishGrowth(this.tick);
  }

  private fusionCandidates(proposals: Proposal[], waiting: Proposal[]) {
    const { matureTipTicks, mergeRadius } = this.tuning;
    const candidates: Fusion[] = [];
    const targets = proposals.concat(waiting);
    for (let i = 0; i < proposals.length; i++) {
      const a = proposals[i];
      if (a.tip.age + 1 < matureTipTicks) continue;
      for (const site of this.fusionSites.keys()) {
        const gap = vec2.distance(a.p, site.position);
        if (site !== a.tip.origin && gap <= mergeRadius)
          candidates.push({ a, target: site, gap });
      }
      for (let j = i + 1; j < targets.length; j++) {
        const b = targets[j],
          gap = vec2.distance(a.p, b.p);
        if (b.tip.age + (b.moving ? 1 : 0) >= matureTipTicks && gap <= mergeRadius)
          candidates.push({ a, target: b, gap });
      }
    }
    candidates.sort((a, b) => a.gap - b.gap);
    return candidates;
  }

  private fuse(proposals: Proposal[], waiting: Proposal[], next: Tip[]) {
    const { mainRadius } = this.tuning;
    const used = new Set<Proposal>();
    for (const { a, target } of this.fusionCandidates(proposals, waiting)) {
      if (used.has(a)) continue;
      if ("tip" in target) {
        if (used.has(target)) continue;
        // A moving tip can reconnect a paused tip at its existing endpoint.
        const p = !target.moving ? target.p : vec2.lerp(vec2.create(), a.p, target.p, 0.5);
        if (
          !this.domain.clear(a.tip.vertex.position, p, mainRadius) ||
          !this.domain.clear(target.tip.vertex.position, p, mainRadius)
        )
          continue;
        if (target.moving) {
          this.mycelium.grow(a.tip, p, this.tick);
          this.mycelium.grow(target.tip, a.tip.vertex, this.tick);
        } else {
          this.mycelium.grow(a.tip, target.tip.vertex, this.tick);
        }
        const site = a.tip.vertex;
        this.recordFusion(site);
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
        if (!this.domain.clear(a.tip.vertex.position, target.position, mainRadius))
          continue;
        this.mycelium.grow(a.tip, target, this.tick);
        this.recordFusion(target);
      }
      used.add(a);
    }
    return used;
  }

  private advanceTip(proposal: Proposal, next: Tip[]) {
    const { tip, p, angle, bend } = proposal;
    const {
      matureTipTicks,
      minSplitWeight,
      meanSplitLength,
      gemCheckDistance,
      gemSpacing
    } = this.tuning;
    const traveled = vec2.distance(tip.vertex.position, p);
    this.mycelium.grow(tip, p, this.tick);
    tip.angle = angle;
    tip.bend = bend;
    if (tip.launchExit) {
      next.push(tip);
      return;
    }
    tip.age++;
    const splits =
      tip.age >= matureTipTicks &&
      tip.weight >= minSplitWeight &&
      this.random() < -Math.expm1(-traveled / meanSplitLength);
    tip.distanceSinceGemCheck += traveled;
    if (splits || tip.distanceSinceGemCheck >= gemCheckDistance) {
      tip.distanceSinceGemCheck %= gemCheckDistance;
      if (this.hasRoomForGem(tip.vertex, gemSpacing)) this.formGem(tip.vertex);
    }
    if (splits) {
      const spread = 0.37 + 0.33 * this.random();
      for (const sign of [-1, 1])
        next.push(
          this.newTip(tip.vertex, tip.angle + sign * spread, tip.weight / 2, tip.origin)
        );
    } else next.push(tip);
  }

  private pruneGrowth() {
    for (const site of this.fusionSites.keys())
      if (!site.alive) this.fusionSites.delete(site);
    this.tips = this.tips.filter((tip) => tip.vertex.alive);
  }

  update(dt: number) {
    const end = this.time + dt;
    const { tickSeconds, nutrientStepSeconds } = this.tuning;
    // Both clocks run in simulation time. Tissue keeps aging after the last extraction.
    while (this.time < end) {
      const growthAt = this.gems.size ? (this.tick + 1) * tickSeconds : Infinity;
      const tissueAt = (this.tissueTick + 1) * nutrientStepSeconds;
      const until = Math.min(end, growthAt, tissueAt);
      for (const gem of this.gems.values()) gem.growIn(until - this.time);
      this.time = until;
      this.mycelium.advanceWounds(until);
      if (until === tissueAt) {
        this.tissueTick++;
        this.mycelium.update(until);
        this.pruneGrowth();
      }
      if (until === growthAt) this.grow();
    }
  }

  afterPhysics(dt: number) {
    for (const gem of this.detached) {
      if (gem.advanceReturn(dt)) {
        gem.visual.dispose();
        this.detached.delete(gem);
      }
    }
  }
}

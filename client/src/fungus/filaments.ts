import { vec2 } from "gl-matrix";
import { seededRandom, tau } from "../engine/math";
import type { ColonyTuning } from "./config";
import type { GrowthDomain } from "./domain";
import type { FungalFabric } from "./fabric";
import type { Stretch } from "./network";
import type { ColonyTissue } from "./tissue";

const minorStrand = { kind: "minor" } as const;
export type Buds = {
  next: number;
  left: number;
  side: number;
  fan: number;
  length: number;
};
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
};

// Each growing filament, including each fork, belongs to its original main stretch.
export class Filaments {
  private active: Filament[] = [];
  private readonly random;

  constructor(
    seed: number,
    private readonly tuning: Readonly<ColonyTuning>,
    private readonly domain: GrowthDomain,
    private readonly fabric: FungalFabric,
    private readonly tissue: ColonyTissue
  ) {
    this.random = seededRandom(seed);
  }

  private gap() {
    return (
      this.tuning.minBudGroupGap -
      this.tuning.meanExtraBudGroupGap * Math.log(1 - this.random())
    );
  }

  newBuds(): Buds {
    return { next: this.gap(), left: 0, side: 1, fan: 0, length: 0 };
  }

  budAlong(a: vec2, b: vec2, length: number, buds: Buds, owner: Stretch, tick: number) {
    const tangent = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const rand = this.random;
    while (buds.next <= length) {
      if (!buds.left) {
        buds.left = 2 + Math.floor(rand() * 5);
        buds.side = rand() < 0.5 ? -1 : 1;
        buds.fan = 0.22 + 0.6 * rand();
        buds.length = 10 + 43 * rand() ** 1.45;
      }
      const root = vec2.lerp(vec2.create(), a, b, buds.next / length);
      const bias = buds.fan + 0.55 * (2 * rand() - 1);
      const budget = buds.length * (0.6 + 0.95 * rand());
      this.active.push({
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
        born: tick + 2 + Math.floor(rand() * 8)
      });
      buds.left--;
      buds.next += buds.left ? 0.8 + 1.9 * rand() : this.gap();
    }
    buds.next -= length;
  }

  grow(tick: number) {
    const active: Filament[] = [];
    const rand = this.random;
    for (const f of this.active) {
      if (f.owner.dead) continue;
      if (tick < f.born) {
        active.push(f);
        continue;
      }
      f.credit += this.tissue.growthFactor(f.owner.midpointDistance, f.owner.health);
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
      this.fabric.deposit(f.p, p, minorStrand, tick, f.owner);
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
          credit: 0
        });
        f.forkAt = Infinity;
      }
    }
    this.active = active;
  }

  prune() {
    this.active = this.active.filter((filament) => !filament.owner.dead);
  }
}

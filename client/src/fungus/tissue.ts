import type { ColonyTuning } from "./config";
import type { FungalFabric } from "./fabric";
import { FiberNetwork, type Stretch, type Vertex } from "./network";
import { WoundPulse } from "./wound";

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

// Owns gem support, wounds and the transition from live tissue to ash.
export class ColonyTissue {
  readonly wounded = new Set<Stretch>();
  private readonly ash = new Map<Stretch, number>();
  private pulses: WoundPulse[] = [];
  private time = 0;

  constructor(
    private readonly network: FiberNetwork,
    private readonly fabric: FungalFabric,
    private readonly tuning: Readonly<ColonyTuning>
  ) {}

  power(distance: number) {
    return Math.exp(-distance / this.tuning.nutrientLength);
  }

  growthFactor(distance: number, health: number) {
    const maintenance = this.tuning.maintenanceSupply;
    return health * Math.max(0, (this.power(distance) - maintenance) / (1 - maintenance));
  }

  removeGem(vertex: Vertex, time: number) {
    this.update(time);
    this.network.setGem(vertex, undefined);
    this.shedDisconnected();
    if (vertex.incident.size) this.pulses.push(new WoundPulse(vertex, time, this.tuning));
  }

  advanceWounds(time: number) {
    if (this.pulses.length)
      this.pulses = this.pulses.filter((pulse) => pulse.advance(time, this));
  }

  expose(s: Stretch, start: number, strength: number) {
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

  private shed(stretch: Stretch) {
    stretch.dead = true;
    stretch.health = 0;
    this.network.sever(stretch);
    this.wounded.delete(stretch);
    this.ash.set(stretch, this.time + this.tuning.ashHoldSeconds);
    this.fabric.becomeAsh(stretch);
  }

  private shedDisconnected() {
    this.network.refreshDistances();
    for (const stretch of this.network.stretches)
      if (!Number.isFinite(stretch.from.distance)) this.shed(stretch);
  }

  update(time: number) {
    if (time <= this.time) return;
    const dt = time - this.time;
    this.time = time;
    const dead: Stretch[] = [];
    for (const s of this.network.stretches) if (!this.updateStretch(s, dt)) dead.push(s);
    if (dead.length) {
      for (const s of dead) this.shed(s);
      this.shedDisconnected();
    }
    const crumbled: Stretch[] = [];
    for (const [stretch, expiry] of this.ash) {
      if (time < expiry) continue;
      this.ash.delete(stretch);
      crumbled.push(stretch);
    }
    if (crumbled.length) this.fabric.crumble(crumbled);
  }

  private updateStretch(s: Stretch, dt: number) {
    const t = this.tuning;
    const supply = this.power(s.midpointDistance);
    const balance = supply / t.maintenanceSupply - 1;
    let change = (dt * balance) / t.starvationSeconds;
    if (balance < 0) change *= 1 + t.lowSupplyDecayBoost * balance ** 2;
    if (s.wound) {
      const age = this.time - s.wound.start;
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
    if (s.health === 0) return false;
    this.fabric.updateAppearance(s, supply);
    return true;
  }
}

import type { ColonyTuning } from "./config";
import { MinQueue } from "./min-queue";
import { Stretch, type Vertex } from "./mycelium";

type Target = Vertex | Stretch;
type Wave = { started: number; reached: Set<Target> };
type Arrival = { target: Target; wave: Wave; distance: number; via?: Stretch };
type Exposure = { start: number; strength: number; pending: number };

// All pulses use the same simulation clock. A severed route stops an in-flight arrival.
export class Wounds {
  readonly active = new Map<Stretch, Exposure>();
  private readonly arrivals = new MinQueue<Arrival>();
  private readonly reach: number;
  constructor(private readonly tuning: Readonly<ColonyTuning>) {
    this.reach = -tuning.woundDecayLength * Math.log(tuning.woundMinStrength);
  }

  start(target: Vertex, time: number) {
    this.arrivals.add(
      { target, distance: 0, wave: { started: time, reached: new Set() } },
      time
    );
  }

  private schedule(wave: Wave, target: Target, via: Stretch, distance: number) {
    if (distance > this.reach || wave.reached.has(target)) return;
    via.sealed = true;
    this.arrivals.add(
      { wave, target, via, distance },
      wave.started + distance / this.tuning.woundSpeed
    );
  }

  advance(time: number, lastTissueUpdate: number, living: ReadonlySet<Stretch>) {
    for (let visit; (visit = this.arrivals.take(time)); ) {
      const { wave, target, via, distance } = visit.value;
      if ((via && !living.has(via)) || wave.reached.has(target)) continue;
      wave.reached.add(target);
      if (target instanceof Stretch) {
        this.expose(
          target,
          visit.priority,
          Math.exp(-distance / this.tuning.woundDecayLength),
          lastTissueUpdate
        );
      } else if (!target.gem) {
        for (const s of target.incident) {
          this.schedule(wave, s, s, distance + s.length / 2);
          this.schedule(wave, s.other(target), s, distance + s.length);
        }
      }
    }
  }

  private expose(s: Stretch, start: number, strength: number, lastUpdate: number) {
    const old = this.active.get(s);
    let pending = 0;
    if (old) {
      const spent = this.dose(start - old.start);
      pending =
        old.pending +
        (spent - this.dose(lastUpdate - old.start)) * this.damageScale(old.strength);
      strength = Math.min(1, strength + old.strength * (1 - spent));
    }
    this.active.set(s, { start, strength, pending });
  }

  damage(s: Stretch, from: number, to: number) {
    const wound = this.active.get(s);
    if (!wound) return 0;
    const spent = this.dose(to - wound.start);
    const damage =
      wound.pending +
      (spent - this.dose(from - wound.start)) * this.damageScale(wound.strength);
    wound.pending = 0;
    if (spent >= 1) this.active.delete(s);
    return damage;
  }

  private damageScale(strength: number) {
    const { woundKillStrength, woundRecoverSeconds, woundWitherSeconds } = this.tuning;
    return Math.min(
      strength / woundKillStrength,
      1 + woundRecoverSeconds / (2 * woundWitherSeconds)
    );
  }

  // Integral of the pressure envelope: flash, constant pressure, linear recovery.
  private dose(age: number) {
    const {
      woundFlashSeconds,
      woundWitherSeconds: hold,
      woundRecoverSeconds: release
    } = this.tuning;
    const t = Math.max(0, age - woundFlashSeconds);
    if (t >= hold + release) return 1;
    const tail = Math.max(0, t - hold);
    return (Math.min(t, hold) + tail * (1 - tail / (2 * release))) / (hold + release / 2);
  }
}

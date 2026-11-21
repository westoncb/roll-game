import type { ColonyTuning } from "./config";
import { DistanceQueue } from "./distance-queue";
import type { FungalFabric } from "./fabric";
import { Stretch, type FiberPoint } from "./network";

type Target = FiberPoint | Stretch;
type Arrival = { target: Target; via?: Stretch };

// Travel along the main graph; each midpoint reacts together with its minor fibers.
export class WoundPulse {
  private readonly arrivals = new DistanceQueue<Arrival>();
  private readonly reached = new Set<Target>();
  private readonly reach: number;

  constructor(
    source: FiberPoint,
    private readonly started: number,
    private readonly tuning: Readonly<ColonyTuning>
  ) {
    this.reach = -tuning.woundDecayLength * Math.log(tuning.woundMinStrength);
    this.arrivals.add({ target: source }, 0);
  }

  private schedule(target: Target, distance: number, via: Stretch) {
    if (distance > this.reach || this.reached.has(target)) return;
    via.sealed = true;
    this.arrivals.add({ target, via }, distance);
  }

  advance(time: number, fabric: FungalFabric) {
    const { woundSpeed, woundDecayLength } = this.tuning;
    const traveled = (time - this.started) * woundSpeed;
    for (let arrival; (arrival = this.arrivals.take(traveled)); ) {
      const {
        distance,
        value: { target, via }
      } = arrival;
      if (via?.dead || this.reached.has(target)) continue;
      this.reached.add(target);
      if (target instanceof Stretch) {
        fabric.expose(
          target,
          this.started + distance / woundSpeed,
          Math.exp(-distance / woundDecayLength)
        );
      } else if (!target.source) {
        for (const stretch of target.incident) {
          this.schedule(stretch, distance + stretch.length / 2, stretch);
          this.schedule(stretch.other(target), distance + stretch.length, stretch);
        }
      }
    }
    return this.arrivals.size > 0;
  }
}

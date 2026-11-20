import { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import type { FiberSegment, FungalFabric } from "./fabric";

type Target = vec2 | FiberSegment;
type Arrival = { target: Target; distance: number };

// A bounded shortest-path wave. Points conduct into their incident fibers; segment
// midpoints receive the visible reaction. A crossing has two distinct point identities.
export class WoundPulse {
  private readonly arrivals: Arrival[] = [];
  private readonly closest = new Map<Target, number>();
  private readonly reach: number;

  constructor(
    source: vec2,
    private readonly started: number,
    private readonly tuning: Readonly<ColonyTuning>
  ) {
    this.reach = -tuning.woundDecayLength * Math.log(tuning.woundMinStrength);
    this.schedule(source, 0);
  }

  private schedule(target: Target, distance: number) {
    if (distance > this.reach || distance >= (this.closest.get(target) ?? Infinity)) return;
    this.closest.set(target, distance);
    // Keep the nearest arrival at the end for cheap removal from this local frontier.
    let lo = 0,
      hi = this.arrivals.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.arrivals[mid].distance > distance) lo = mid + 1;
      else hi = mid;
    }
    this.arrivals.splice(lo, 0, { target, distance });
  }

  advance(time: number, fabric: FungalFabric, liveKnots: Set<vec2>, severed: Set<vec2>) {
    const { woundSpeed, woundDecayLength, woundKillStrength } = this.tuning;
    const traveled = (time - this.started) * woundSpeed;
    while (
      this.arrivals.length &&
      this.arrivals[this.arrivals.length - 1].distance <= traveled
    ) {
      const { target, distance } = this.arrivals.pop()!;
      if (this.closest.get(target) !== distance) continue;
      const strength = Math.exp(-distance / woundDecayLength);
      if ("strand" in target) {
        fabric.expose(target, this.started + distance / woundSpeed, strength);
        continue;
      }
      if (liveKnots.has(target)) continue;
      if (strength >= woundKillStrength) severed.add(target);
      for (const segment of fabric.connected(target)) {
        const { a, b, buds } = segment;
        const toMiddle = Math.hypot(
          (a[0] + b[0]) / 2 - target[0],
          (a[1] + b[1]) / 2 - target[1]
        );
        this.schedule(segment, distance + toMiddle);
        this.schedule(a, distance + vec2.distance(target, a));
        this.schedule(b, distance + vec2.distance(target, b));
        if (buds)
          for (const bud of buds) this.schedule(bud, distance + vec2.distance(target, bud));
      }
    }
    return this.arrivals.length > 0;
  }
}

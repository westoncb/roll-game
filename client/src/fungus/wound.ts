import type { vec2 } from "gl-matrix";
import type { ColonyTuning } from "./config";
import type { FungalFabric } from "./fabric";
import type { FiberSegment } from "./network";

type Target = vec2 | FiberSegment;
type Arrival = { target: Target; distance: number; via?: FiberSegment };

// A bounded shortest-path wave. Points conduct into their incident fibers; segment
// midpoints receive the visible reaction. A crossing has two distinct point identities.
export class WoundPulse {
  private readonly arrivals: Arrival[] = [];
  private readonly reached = new Set<Target>();
  private readonly reach: number;

  constructor(
    source: vec2,
    private readonly started: number,
    private readonly tuning: Readonly<ColonyTuning>
  ) {
    this.reach = -tuning.woundDecayLength * Math.log(tuning.woundMinStrength);
    this.schedule(source, 0);
  }

  private schedule(target: Target, distance: number, via?: FiberSegment) {
    if (distance > this.reach || this.reached.has(target)) return;
    // Keep the nearest arrival at the end for cheap removal from this local frontier.
    let lo = 0,
      hi = this.arrivals.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.arrivals[mid].distance > distance) lo = mid + 1;
      else hi = mid;
    }
    this.arrivals.splice(lo, 0, { target, distance, via });
  }

  advance(time: number, fabric: FungalFabric) {
    const { woundSpeed, woundDecayLength } = this.tuning;
    const traveled = (time - this.started) * woundSpeed;
    while (
      this.arrivals.length &&
      this.arrivals[this.arrivals.length - 1].distance <= traveled
    ) {
      const { target, distance, via } = this.arrivals.pop()!;
      // An in-flight route can crumble before arrival. A later arrival via an
      // intact alternate route still counts.
      if (via?.dead || this.reached.has(target)) continue;
      this.reached.add(target);
      const strength = Math.exp(-distance / woundDecayLength);
      if ("strand" in target) {
        fabric.expose(target, this.started + distance / woundSpeed, strength);
        continue;
      }
      const point = fabric.network.points.get(target);
      if (!point || point.source) continue;
      for (const segment of point.incident) {
        this.schedule(segment, distance + segment.length / 2, segment);
        this.schedule(
          segment.from === point ? segment.b : segment.a,
          distance + segment.length,
          segment
        );
      }
    }
    return this.arrivals.length > 0;
  }
}

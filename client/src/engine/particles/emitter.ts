import type { ReadonlyMat2d } from "gl-matrix";
import { lerp } from "../math.ts";
import type { Particle } from "./particle.ts";

/** A range is sampled uniformly once per particle at birth. */
export type SpawnValue = number | readonly [min: number, max: number];
type Point = readonly [x: number, y: number];
type StrengthScale = readonly [atZero: number, atOne: number];
type Key<T> = { readonly at: number; readonly value: T };
/** Keys are in increasing order over normalized lifetime, with constant end values. */
export type OverLife<T> = T | readonly [Key<T>, ...Key<T>[]];
export type ParticlePass = "behind" | "front";

/** Times are seconds, angles are radians, and distances are world units. */
export interface Emitter {
  readonly emission:
    | { readonly kind: "burst"; readonly count: number }
    | { readonly kind: "rate"; readonly perSecond: number; readonly duration?: number };
  readonly delay?: number;
  readonly space?: "world" | "local";
  readonly pass?: ParticlePass;
  /** Spawn at offset, or uniformly along the segment from offset to offset + segment. */
  readonly offset?: Point;
  readonly segment?: Point;
  readonly lifetime: SpawnValue;
  readonly direction?: SpawnValue;
  readonly speed?: SpawnValue;
  /** Expressed in the effect's axes. World particles keep these axes from birth. */
  readonly acceleration?: Point;
  /** Linear drag coefficient per second. */
  readonly drag?: number;
  readonly rotation?: SpawnValue;
  readonly angularSpeed?: SpawnValue;
  readonly radius?: SpawnValue;
  /** Multiply the radius along the particle's X axis to draw an ellipse. */
  readonly stretch?: number;
  readonly sizeOverLife?: OverLife<number>;
  readonly opacityOverLife?: OverLife<number>;
  readonly colorOverLife?: OverLife<string>;
  readonly blend?: "normal" | "additive";
  /** Multipliers at the two endpoints of playback strength. Omitted values scale by 1. */
  readonly strength?: {
    readonly amount?: StrengthScale;
    readonly speed?: StrengthScale;
    readonly size?: StrengthScale;
  };
}

/** Emitters played together share a start time, transform, and random sequence. */
export interface ParticleEffect {
  /** Reuse this unsigned 32-bit seed on each play. Omit for a fresh variation. */
  readonly fixedSeed?: number;
  readonly emitters: readonly Emitter[];
}

/** One emitter's schedule and particles during a single playback. */
export class EmitterState {
  readonly emitter: Emitter;
  readonly particles: Particle[] = [];
  private readonly sample: (value: SpawnValue) => number;
  private readonly amountScale: number;
  private readonly speedScale: number;
  private readonly sizeScale: number;
  private scheduled = 0;
  private emitting = true;

  constructor(emitter: Emitter, strength: number, sample: (value: SpawnValue) => number) {
    this.emitter = emitter;
    this.sample = sample;
    const scale = (range?: StrengthScale) =>
      range ? lerp(range[0], range[1], strength) : 1;
    this.amountScale = scale(emitter.strength?.amount);
    this.speedScale = scale(emitter.strength?.speed);
    this.sizeScale = scale(emitter.strength?.size);
  }

  stop() {
    this.emitting = false;
  }

  get finished() {
    return !this.emitting && this.particles.length === 0;
  }

  /** Keep particles that were alive anywhere in the interval still being rendered. */
  retire(before: number) {
    let kept = 0;
    for (const particle of this.particles) {
      if (particle.born + particle.lifetime > before) this.particles[kept++] = particle;
    }
    this.particles.length = kept;
  }

  emit(
    started: number,
    time: number,
    capacity: number,
    worldFrameAt: (born: number) => ReadonlyMat2d
  ) {
    const start = started + (this.emitter.delay ?? 0);
    if (!this.emitting || time < start) return 0;
    const schedule = this.emitter.emission;
    if (schedule.kind === "burst") {
      this.stop();
      const count = Math.min(capacity, Math.round(schedule.count * this.amountScale));
      this.spawn(start, count, worldFrameAt);
      return count;
    }

    const rate = schedule.perSecond * this.amountScale;
    const elapsed = time - start;
    const duration = schedule.duration ?? Infinity;
    if (elapsed >= duration || rate <= 0) this.stop();
    if (rate <= 0) return 0;

    // Derive the total from elapsed time so fractional births carry between ticks.
    const due = Math.floor(Math.min(elapsed, duration) * rate + 1e-9);
    const available = Math.min(due - this.scheduled, capacity);
    let count = 0;
    while (count < available) {
      count++;
      const born = Math.min(time, start + (this.scheduled + count) / rate);
      this.spawn(born, 1, worldFrameAt);
    }
    // Births beyond the budget are dropped, so advance past all that were due.
    this.scheduled = due;
    return count;
  }

  private spawn(
    born: number,
    count: number,
    worldFrameAt: (born: number) => ReadonlyMat2d
  ) {
    if (count === 0) return;
    const frame = this.emitter.space === "local" ? undefined : worldFrameAt(born);
    for (let i = 0; i < count; i++) this.particles.push(this.createParticle(born, frame));
  }

  private createParticle(born: number, frame?: ReadonlyMat2d): Particle {
    const emitter = this.emitter;
    const along = emitter.segment ? this.sample([0, 1]) : 0;
    let x = (emitter.offset?.[0] ?? 0) + along * (emitter.segment?.[0] ?? 0);
    let y = (emitter.offset?.[1] ?? 0) + along * (emitter.segment?.[1] ?? 0);
    let ax = emitter.acceleration?.[0] ?? 0;
    let ay = emitter.acceleration?.[1] ?? 0;
    let heading = 0;
    if (frame) {
      const [a, b, c, d, tx, ty] = frame;
      [x, y] = [a * x + c * y + tx, b * x + d * y + ty];
      [ax, ay] = [a * ax + c * ay, b * ax + d * ay];
      heading = Math.atan2(b, a);
    }
    const direction = heading + this.sample(emitter.direction ?? 0);
    const speed = this.sample(emitter.speed ?? 0) * this.speedScale;
    return {
      born,
      lifetime: this.sample(emitter.lifetime),
      x,
      y,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      ax,
      ay,
      rotation: heading + this.sample(emitter.rotation ?? 0),
      angularSpeed: this.sample(emitter.angularSpeed ?? 0),
      radius: this.sizeScale * this.sample(emitter.radius ?? 1)
    };
  }
}

/** A reusable description. Each play starts fresh playback for the nodes it reaches. */
export type Effect =
  | { readonly kind: "leaf"; readonly start: (time: number) => EffectPlayback }
  | { readonly kind: "sequence" | "parallel"; readonly children: readonly Effect[] };

export const sequence = (...children: Effect[]): Effect => ({ kind: "sequence", children });
export const parallel = (...children: Effect[]): Effect => ({ kind: "parallel", children });

/** The caller's handle to one scheduled play. Release active children and skip pending ones. */
export interface EffectHandle {
  release(time?: number): void;
}

/** All times are absolute simulation seconds. A release is delivered in its tick
 * and remains visible for the rest of playback. */
export interface EffectStep {
  /** Start of the fixed tick, for interpolating scene poses. */
  readonly tickStart: number;
  /** Start of this node's active portion of the tick. */
  readonly start: number;
  readonly end: number;
  readonly releasedAt?: number;
}

/** Execution of one effect node. Return its exact completion time, or undefined while
 * active. The scheduler disposes each finished playback after its last renderable tick. */
export interface EffectPlayback {
  advance(step: EffectStep): number | undefined;
  dispose?(): void;
}

export interface EffectTiming {
  /** Omit for an effect sustained until release. */
  readonly duration?: number;
  readonly releaseDuration?: number;
}

export interface EffectFrame {
  readonly time: number;
  readonly age: number;
  readonly duration?: number;
  /** Normalized progress through a finite duration. */
  readonly progress?: number;
  /** Seconds since release, including zero at the instant of release. */
  readonly releaseAge?: number;
  readonly releaseDuration: number;
}

/** A linear attack and fade for opacity, amplitude, or any other scalar. Releasing
 * during the attack fades from the level reached at the moment of release. */
export function linearEnvelope(frame: EffectFrame, attack = 0): number {
  const attackAge = frame.age - (frame.releaseAge ?? 0);
  const gain = attack > 0 ? Math.min(1, attackAge / attack) : 1;
  if (frame.releaseDuration === 0) return gain;
  const remaining = Math.min(
    (frame.duration ?? Infinity) - frame.age,
    frame.releaseDuration - (frame.releaseAge ?? 0)
  );
  return gain * Math.max(0, Math.min(1, remaining / frame.releaseDuration));
}

/** A timed leaf ends at its natural end or the end of its release, whichever comes first. */
export class EffectLifetime implements EffectPlayback {
  private releasedAt = Infinity;
  private readonly duration: number;
  private readonly releaseDuration: number;

  constructor(
    private readonly start: number,
    timing: EffectTiming
  ) {
    for (const seconds of [timing.duration, timing.releaseDuration]) {
      if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0))
        throw new RangeError("Effect durations must be finite and nonnegative.");
    }
    this.duration = timing.duration ?? Infinity;
    this.releaseDuration = timing.releaseDuration ?? 0;
  }

  private get end() {
    return Math.min(this.start + this.duration, this.releasedAt + this.releaseDuration);
  }

  advance(step: EffectStep) {
    this.releasedAt = step.releasedAt ?? Infinity;
    return this.end <= step.end ? this.end : undefined;
  }

  frameAt(time: number): EffectFrame | undefined {
    if (time < this.start || time >= this.end) return;
    const age = time - this.start;
    return {
      time,
      age,
      duration: this.duration === Infinity ? undefined : this.duration,
      progress: this.duration === Infinity ? undefined : age / this.duration,
      releaseAge: time < this.releasedAt ? undefined : time - this.releasedAt,
      releaseDuration: this.releaseDuration
    };
  }
}

export function wait(seconds: number): Effect {
  return { kind: "leaf", start: (time) => new EffectLifetime(time, { duration: seconds }) };
}

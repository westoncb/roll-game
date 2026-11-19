/** A range is sampled uniformly once per particle at birth. */
export type ParticleValue = number | readonly [min: number, max: number];
type Point = readonly [x: number, y: number];
type StrengthScale = readonly [atZero: number, atOne: number];
type Key<T> = { readonly at: number; readonly value: T };
/** Keys are in increasing order over normalized lifetime, with constant end values. */
export type OverLife<T> = T | readonly [Key<T>, ...Key<T>[]];
export type ParticlePass = "behind" | "front";

/** Times are seconds, angles are radians, and distances are world units. */
export interface EmitterDefinition {
  readonly emission:
    | { readonly kind: "burst"; readonly count: number }
    | { readonly kind: "rate"; readonly perSecond: number; readonly duration?: number };
  readonly delay?: number;
  readonly space?: "world" | "local";
  readonly pass?: ParticlePass;
  /** Spawn at offset, or uniformly along the segment from offset to offset + segment. */
  readonly offset?: Point;
  readonly segment?: Point;
  readonly lifetime: ParticleValue;
  readonly direction?: ParticleValue;
  readonly speed?: ParticleValue;
  /** Expressed in the effect's axes. World particles keep these axes from birth. */
  readonly acceleration?: Point;
  /** Linear drag coefficient per second. */
  readonly drag?: number;
  readonly rotation?: ParticleValue;
  readonly angularSpeed?: ParticleValue;
  readonly radius?: ParticleValue;
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

export interface ParticleEffectDefinition {
  /** Reuse this unsigned 32-bit seed on each play. Omit for a fresh variation. */
  readonly fixedSeed?: number;
  readonly emitters: readonly EmitterDefinition[];
}

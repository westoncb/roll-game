import type { Effect, EffectHandle, EffectPlayback, EffectStep } from "../effects/effect";
import { EffectPose, type EffectOrigin } from "../effects/pose";
import { EffectScheduler } from "../effects/scheduler";
import { lerp } from "../../utils/math";
import {
  EmitterState,
  type ParticleEffect,
  type ParticlePass,
  type SpawnValue
} from "./emitter";
import { drawEmitter } from "./render";

export type { EffectOrigin } from "../effects/pose";

export interface ParticleHandle extends EffectHandle {
  /** End emission. Existing particles finish their lifetimes. */
  stop(): void;
  /** Freeze the current world pose before removing an attached node. */
  detach(): void;
}

export interface EffectOptions {
  strength?: number;
}

export type EffectPlayer = Pick<ParticleSystem, "play">;

/** One play of an asset shares a pose and random sequence across its emitters. */
class ParticlePlayback {
  readonly emitters: EmitterState[];
  readonly pose: EffectPose;
  tick?: EffectStep;
  releaseAt = Infinity;

  constructor(asset: ParticleEffect, origin: EffectOrigin, options: EffectOptions) {
    this.pose = new EffectPose(origin);
    const strength = Math.max(0, Math.min(1, options.strength ?? 1));
    let seed = asset.fixedSeed ?? Math.floor(Math.random() * 0x100000000);
    const sample = (value: SpawnValue) => {
      if (typeof value === "number") return value;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return lerp(value[0], value[1], seed / 0x100000000);
    };
    this.emitters = asset.emitters.map(
      (emitter) => new EmitterState(emitter, strength, sample)
    );
  }

  draw(ctx: CanvasRenderingContext2D, pass: ParticlePass, alpha: number) {
    if (!this.tick) return;
    const time = lerp(this.tick.tickStart, this.tick.end, alpha);
    for (const state of this.emitters) {
      if ((state.emitter.pass ?? "front") !== pass || !state.particles.length) continue;
      const frame = state.emitter.space === "local" ? this.pose.renderFrame() : undefined;
      drawEmitter(ctx, state, time, frame);
    }
  }
}

export class ParticleSystem {
  private readonly playing = new Set<ParticlePlayback>();
  private budgetTick = -Infinity;
  private capacity = 0;

  /** Share a scheduler for composed and direct plays. A standalone pool owns its scheduler. */
  constructor(
    private readonly maxParticles = 4096,
    private readonly scheduler = new EffectScheduler()
  ) {
    if (!Number.isSafeInteger(maxParticles) || maxParticles < 0)
      throw new RangeError("Particle budget must be a nonnegative integer.");
  }

  get active() {
    return this.playing.size > 0;
  }

  /** A composable play of this asset, using this system's budget and drawing passes.
   * All plays sharing the pool use the same simulation tick boundaries. */
  effect(asset: ParticleEffect, origin: EffectOrigin, options: EffectOptions = {}): Effect {
    return {
      kind: "leaf",
      start: (time) => this.start(new ParticlePlayback(asset, origin, options), time)
    };
  }

  /** Direct plays begin at the next fixed-step boundary, after attachments have been posed. */
  play(
    asset: ParticleEffect,
    origin: EffectOrigin,
    options: EffectOptions = {}
  ): ParticleHandle {
    const playback = new ParticlePlayback(asset, origin, options);
    this.playing.add(playback);
    this.scheduler.play(
      { kind: "leaf", start: (time) => this.start(playback, time) },
      "nextTick"
    );
    const release = (time = this.scheduler.now) => {
      if (!Number.isFinite(time) || time < this.scheduler.now)
        throw new RangeError("Particle release must be at or after the current tick.");
      playback.releaseAt = Math.min(playback.releaseAt, time);
    };
    return {
      release,
      stop: release,
      detach: () => playback.pose.detach()
    };
  }

  /** Convenience for standalone use. With a shared scheduler, advance it once per tick. */
  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0)
      throw new RangeError("Particle step must be positive and finite.");
    this.scheduler.advanceTo(this.scheduler.now + dt);
  }

  private start(playback: ParticlePlayback, start: number): EffectPlayback {
    this.playing.add(playback);
    return {
      advance: (step) => {
        this.prepareBudget(step.tickStart);
        playback.tick = step;
        const release = Math.min(playback.releaseAt, step.releasedAt ?? Infinity);
        const through = Math.min(step.end, release);
        const frameAt = (born: number) =>
          playback.pose.frameAt((born - step.tickStart) / (step.end - step.tickStart));
        let end = start;
        for (const emitter of playback.emitters) {
          this.capacity -= emitter.emit(start, through, this.capacity, frameAt);
          if (release <= step.end) emitter.stop(release);
          end = Math.max(end, emitter.finishedAt);
        }
        return end <= step.end ? end : undefined;
      },
      dispose: () => {
        playback.pose.detach();
        this.playing.delete(playback);
      }
    };
  }

  /** Retain the particles visible anywhere in the latest interpolation interval. */
  private prepareBudget(tickStart: number) {
    if (tickStart === this.budgetTick) return;
    this.budgetTick = tickStart;
    this.capacity = this.maxParticles;
    for (const playback of this.playing) {
      for (const emitter of playback.emitters) {
        emitter.retire(tickStart);
        this.capacity -= emitter.particles.length;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, pass: ParticlePass, alpha = 1) {
    for (const playback of this.playing) playback.draw(ctx, pass, alpha);
  }
}

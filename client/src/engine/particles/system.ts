import { mat2d, type ReadonlyMat2d, type ReadonlyVec2 } from "gl-matrix";
import type { Drawable2D } from "../drawable";
import { lerp } from "../../utils/math";
import {
  EmitterState,
  type ParticleEffect,
  type ParticlePass,
  type SpawnValue
} from "./emitter";
import { drawEmitter } from "./render";

export type EffectOrigin =
  | { kind: "world"; position: ReadonlyVec2; angle?: number }
  | { kind: "attached"; node: Drawable2D; offset?: ReadonlyVec2; angle?: number };

export interface EffectHandle {
  /** End emission. Existing particles finish their lifetimes. */
  stop(): void;
  /** Freeze the current world pose before removing an attached node. */
  detach(): void;
}

export interface EffectOptions {
  strength?: number;
}

export type EffectPlayer = Pick<ParticleSystem, "play">;

/** State shared by the emitters started together in one play call. */
class Playback implements EffectHandle {
  readonly emitters: EmitterState[];
  started?: number;
  private node?: Drawable2D;
  private readonly local = mat2d.create();
  private readonly world = mat2d.create();
  private readonly nodePose = mat2d.create();

  constructor(effect: ParticleEffect, origin: EffectOrigin, strength: number) {
    const offset = origin.kind === "world" ? origin.position : origin.offset;
    mat2d.fromRotation(this.local, origin.angle ?? 0);
    this.local[4] = offset?.[0] ?? 0;
    this.local[5] = offset?.[1] ?? 0;
    if (origin.kind === "attached") this.node = origin.node;

    let seed = effect.fixedSeed ?? Math.floor(Math.random() * 0x100000000);
    const sample = (value: SpawnValue) => {
      if (typeof value === "number") return value;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return lerp(value[0], value[1], seed / 0x100000000);
    };
    this.emitters = effect.emitters.map(
      (emitter) => new EmitterState(emitter, strength, sample)
    );
  }

  stop() {
    for (const emitter of this.emitters) emitter.stop();
  }

  detach() {
    if (!this.node) return;
    mat2d.copy(this.local, this.worldFrame(this.node.worldMatrix(this.nodePose)));
    this.node = undefined;
  }

  frameAt(alpha: number): ReadonlyMat2d {
    return this.node
      ? this.worldFrame(this.node.worldMatrixAt(alpha, this.nodePose))
      : this.local;
  }

  renderFrame(): ReadonlyMat2d {
    return this.node ? this.worldFrame(this.node.renderWorldMatrix) : this.local;
  }

  /** Node scale positions the attachment without resizing its particles. */
  private worldFrame(parent: ReadonlyMat2d) {
    mat2d.multiply(this.world, parent, this.local);
    const angle = Math.atan2(this.world[1], this.world[0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return mat2d.set(this.world, c, s, -s, c, this.world[4], this.world[5]);
  }
}

export class ParticleSystem {
  private readonly playbacks = new Set<Playback>();
  private previousTime = 0;
  private time = 0;

  constructor(private readonly maxParticles = 4096) {
    if (!Number.isSafeInteger(maxParticles) || maxParticles < 0)
      throw new RangeError("Particle budget must be a nonnegative integer.");
  }

  get active() {
    return this.playbacks.size > 0;
  }

  /** Playback begins at the next fixed-step boundary, after attachments have been posed. */
  play(
    effect: ParticleEffect,
    origin: EffectOrigin,
    options: EffectOptions = {}
  ): EffectHandle {
    const strength = Math.max(0, Math.min(1, options.strength ?? 1));
    const playback = new Playback(effect, origin, strength);
    this.playbacks.add(playback);
    return playback;
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0)
      throw new RangeError("Particle step must be positive and finite.");
    this.previousTime = this.time;
    this.time += dt;

    let capacity = this.maxParticles;
    for (const playback of this.playbacks) {
      for (const emitter of playback.emitters) {
        emitter.retire(this.previousTime);
        capacity -= emitter.particles.length;
      }
    }
    for (const playback of this.playbacks) {
      const start = (playback.started ??= this.time);
      const frameAt = (born: number) =>
        playback.frameAt(Math.max(0, Math.min(1, (born - this.previousTime) / dt)));
      for (const emitter of playback.emitters) {
        capacity -= emitter.emit(start, this.time, capacity, frameAt);
      }
      if (playback.emitters.every((emitter) => emitter.finished)) {
        playback.detach();
        this.playbacks.delete(playback);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, pass: ParticlePass, alpha = 1) {
    const time = lerp(this.previousTime, this.time, alpha);
    for (const playback of this.playbacks) {
      for (const state of playback.emitters) {
        if ((state.emitter.pass ?? "front") !== pass || !state.particles.length) continue;
        const frame = state.emitter.space === "local" ? playback.renderFrame() : undefined;
        drawEmitter(ctx, state, time, frame);
      }
    }
  }
}

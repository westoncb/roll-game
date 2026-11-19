import type { ReadonlyMat2d } from "gl-matrix";
import { lerp } from "../util";
import type {
  EmitterDefinition,
  ParticleEffectDefinition,
  ParticlePass,
  ParticleValue
} from "./definition";
import { EffectAnchor, type EffectPlacement } from "./placement";
import { drawEmitter, type Particle } from "./render";

export interface EffectHandle {
  /** End emission. Existing particles finish their lifetimes. */
  stop(): void;
  /** Freeze the placement at its current world pose before removing an attached node. */
  detach(): void;
}

export interface EffectOptions {
  strength?: number;
  seed?: number;
}

export interface EffectPlayer {
  play(
    definition: ParticleEffectDefinition,
    placement: EffectPlacement,
    options?: EffectOptions
  ): EffectHandle;
}

class Emitter {
  readonly particles: Particle[] = [];
  readonly amountScale: number;
  readonly speedScale: number;
  readonly sizeScale: number;
  scheduled = 0;
  done = false;

  constructor(
    readonly def: EmitterDefinition,
    strength: number
  ) {
    const scale = (range?: readonly [number, number]) =>
      range ? lerp(range[0], range[1], strength) : 1;
    this.amountScale = scale(def.strength?.amount);
    this.speedScale = scale(def.strength?.speed);
    this.sizeScale = scale(def.strength?.size);
  }
}

class Effect implements EffectHandle {
  readonly emitters: Emitter[];
  readonly anchor: EffectAnchor;
  started?: number;
  private seed: number;

  constructor(
    def: ParticleEffectDefinition,
    placement: EffectPlacement,
    options: EffectOptions
  ) {
    this.anchor = new EffectAnchor(placement);
    this.seed = (options.seed ?? Math.random() * 0x100000000) >>> 0;
    const strength = Math.max(0, Math.min(1, options.strength ?? 1));
    this.emitters = def.emitters.map((emitter) => new Emitter(emitter, strength));
  }

  sample(value: ParticleValue) {
    if (typeof value === "number") return value;
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return lerp(value[0], value[1], this.seed / 0x100000000);
  }

  stop() {
    for (const emitter of this.emitters) emitter.done = true;
  }

  detach() {
    this.anchor.detach();
  }
}

function spawn(effect: Effect, emitter: Emitter, born: number, frame?: ReadonlyMat2d) {
  const def = emitter.def;
  const along = def.segment ? effect.sample([0, 1]) : 0;
  let x = (def.offset?.[0] ?? 0) + along * (def.segment?.[0] ?? 0);
  let y = (def.offset?.[1] ?? 0) + along * (def.segment?.[1] ?? 0);
  let ax = def.acceleration?.[0] ?? 0;
  let ay = def.acceleration?.[1] ?? 0;
  let heading = 0;
  if (frame) {
    const [a, b, c, d, tx, ty] = frame;
    [x, y] = [a * x + c * y + tx, b * x + d * y + ty];
    [ax, ay] = [a * ax + c * ay, b * ax + d * ay];
    heading = Math.atan2(b, a);
  }
  const direction = heading + effect.sample(def.direction ?? 0);
  const speed = effect.sample(def.speed ?? 0) * emitter.speedScale;
  emitter.particles.push({
    born,
    lifetime: effect.sample(def.lifetime),
    x,
    y,
    vx: Math.cos(direction) * speed,
    vy: Math.sin(direction) * speed,
    ax,
    ay,
    rotation: heading + effect.sample(def.rotation ?? 0),
    angularSpeed: effect.sample(def.angularSpeed ?? 0),
    radius: emitter.sizeScale * effect.sample(def.radius ?? 1)
  });
}

/** Keep particles that were alive anywhere in the interval still being rendered. */
function retire(particles: Particle[], before: number) {
  let kept = 0;
  for (const particle of particles) {
    if (particle.born + particle.lifetime > before) particles[kept++] = particle;
  }
  const removed = particles.length - kept;
  particles.length = kept;
  return removed;
}

export class ParticleSystem implements EffectPlayer {
  private readonly effects = new Set<Effect>();
  private previousTime = 0;
  private time = 0;
  private count = 0;

  constructor(private readonly maxParticles = 4096) {
    if (!Number.isSafeInteger(maxParticles) || maxParticles < 0)
      throw new RangeError("Particle budget must be a nonnegative integer.");
  }

  get active() {
    return this.effects.size > 0;
  }

  /** Playback begins at the next fixed-step boundary, after attachments have been posed. */
  play(
    def: ParticleEffectDefinition,
    placement: EffectPlacement,
    options: EffectOptions = {}
  ): EffectHandle {
    const effect = new Effect(def, placement, options);
    this.effects.add(effect);
    return effect;
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0)
      throw new RangeError("Particle step must be positive and finite.");
    this.previousTime = this.time;
    this.time += dt;
    for (const effect of this.effects) {
      for (const emitter of effect.emitters)
        this.count -= retire(emitter.particles, this.previousTime);
    }
    for (const effect of this.effects) {
      const start = (effect.started ??= this.time);
      for (const emitter of effect.emitters) {
        if (!emitter.done) this.emit(effect, emitter, start + (emitter.def.delay ?? 0), dt);
      }
      if (effect.emitters.every((e) => e.done && !e.particles.length)) {
        effect.detach();
        this.effects.delete(effect);
      }
    }
  }

  private emit(effect: Effect, emitter: Emitter, start: number, dt: number) {
    if (this.time < start) return;
    const schedule = emitter.def.emission;
    if (schedule.kind === "burst") {
      this.births(
        effect,
        emitter,
        start,
        Math.round(schedule.count * emitter.amountScale),
        dt
      );
      emitter.done = true;
      return;
    }
    const rate = schedule.perSecond * emitter.amountScale;
    const elapsed = this.time - start;
    const duration = schedule.duration ?? Infinity;
    emitter.done = elapsed >= duration || rate <= 0;
    if (rate <= 0) return;

    // Derive the total from elapsed time so fractional births carry between ticks.
    const due = Math.floor(Math.min(elapsed, duration) * rate + 1e-9);
    const available = Math.min(due - emitter.scheduled, this.maxParticles - this.count);
    for (let i = 1; i <= available; i++) {
      const born = Math.min(this.time, start + (emitter.scheduled + i) / rate);
      this.births(effect, emitter, born, 1, dt);
    }
    // A full budget drops excess births; they do not become a later burst.
    emitter.scheduled = due;
  }

  private births(
    effect: Effect,
    emitter: Emitter,
    born: number,
    requested: number,
    dt: number
  ) {
    const count = Math.min(requested, this.maxParticles - this.count);
    if (count <= 0) return;
    const alpha = Math.max(0, Math.min(1, (born - this.previousTime) / dt));
    const frame = emitter.def.space === "local" ? undefined : effect.anchor.at(alpha);
    for (let i = 0; i < count; i++) spawn(effect, emitter, born, frame);
    this.count += count;
  }

  draw(ctx: CanvasRenderingContext2D, pass: ParticlePass, alpha = 1) {
    const time = lerp(this.previousTime, this.time, alpha);
    for (const effect of this.effects) {
      for (const emitter of effect.emitters) {
        if ((emitter.def.pass ?? "front") !== pass || !emitter.particles.length) continue;
        const frame = emitter.def.space === "local" ? effect.anchor.forRender() : undefined;
        drawEmitter(ctx, emitter.def, emitter.particles, time, frame);
      }
    }
  }
}

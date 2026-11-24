import type { Effect, EffectHandle, EffectPlayback, EffectStep } from "./effect";

interface ScheduledEffect {
  readonly effect: Effect;
  start: number | "nextTick";
  releasedAt?: number;
  playback?: EffectPlayback;
}

/** Schedule effects at their event times before advancing to the end of each fixed tick.
 * Render through the owning drawable hierarchy, camera, and particle passes afterwards. */
export class EffectScheduler {
  private readonly playing = new Set<ScheduledEffect>();
  private readonly retired: EffectPlayback[] = [];
  private time: number;

  constructor(time = 0) {
    if (!Number.isFinite(time)) throw new RangeError("Effect time must be finite.");
    this.time = time;
  }

  get now() {
    return this.time;
  }

  get active() {
    return this.playing.size > 0 || this.retired.length > 0;
  }

  /** Use nextTick to begin at the end of the next completed simulation step. */
  play(effect: Effect, time: number | "nextTick" = this.time): EffectHandle {
    if (time !== "nextTick") this.checkTime(time);
    const run: ScheduledEffect = { effect, start: time };
    this.playing.add(run);
    return {
      release: (at = this.time) => {
        this.checkTime(at);
        run.releasedAt = Math.min(run.releasedAt ?? Infinity, at);
      }
    };
  }

  advanceTo(end: number) {
    this.checkTime(end);
    if (end === this.time) return;
    for (const playback of this.retired) playback.dispose?.();
    this.retired.length = 0;
    const tickStart = this.time;
    this.time = end;
    // Plays requested by a leaf take effect on the following advance.
    for (const run of [...this.playing]) {
      if (run.start === "nextTick") run.start = end;
      if (run.releasedAt !== undefined && run.releasedAt <= run.start && !run.playback) {
        this.playing.delete(run);
        continue;
      }
      if (run.start > end) continue;
      run.playback ??= this.start(run.effect, run.start);
      const releasedAt =
        run.releasedAt !== undefined && run.releasedAt <= end ? run.releasedAt : undefined;
      const step = { tickStart, start: Math.max(tickStart, run.start), end, releasedAt };
      if (this.advance(run.playback, step) !== undefined) this.playing.delete(run);
    }
  }

  private advance(playback: EffectPlayback, step: EffectStep) {
    const end = playback.advance(step);
    if (end !== undefined) {
      if (!Number.isFinite(end) || end < step.start || end > step.end)
        throw new RangeError("Effect completion must fall within its active step.");
      if (playback.dispose) this.retired.push(playback);
    }
    return end;
  }

  private start(effect: Effect, time: number): EffectPlayback {
    switch (effect.kind) {
      case "leaf":
        return effect.start(time);
      case "sequence": {
        let childStart = time;
        let index = 0;
        let child: EffectPlayback | undefined;
        return {
          advance: (step) => {
            while (index < effect.children.length) {
              if (!child) {
                if (step.releasedAt !== undefined && childStart >= step.releasedAt) break;
                child = this.start(effect.children[index], childStart);
              }
              const end = this.advance(child, {
                ...step,
                start: Math.max(step.start, childStart)
              });
              if (end === undefined) return;
              childStart = end;
              index++;
              child = undefined;
            }
            return childStart;
          }
        };
      }
      case "parallel": {
        let children = effect.children.map((child) => this.start(child, time));
        let last = time;
        return {
          advance: (step) => {
            children = children.filter((child) => {
              const end = this.advance(child, step);
              if (end === undefined) return true;
              last = Math.max(last, end);
              return false;
            });
            if (!children.length) return last;
          }
        };
      }
    }
  }

  private checkTime(time: number) {
    if (!Number.isFinite(time) || time < this.time)
      throw new RangeError("Effect time must be finite and at or after the current tick.");
  }
}

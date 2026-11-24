import { vec2, type ReadonlyVec2 } from "gl-matrix";
import { tau } from "../utils/math";
import { applyMatrix, Transform2D } from "./transform";
import type { Effect } from "./effects/effect";
import type { Curve } from "./effects/curve";

type Size = { width: number; height: number };

export type CameraShake = {
  /** Peak displacement in CSS pixels at 1x zoom. */
  amplitude: number;
  duration: number; // seconds
  frequency: number; // cycles per second
  /** A direction starts with a kick along that axis. Omit it for a rolling rumble. */
  direction?: ReadonlyVec2;
  /** Relative amplitude of the vibration perpendicular to the main axis. */
  crossAxis?: number;
  /** Amplitude multiplier over the normalized lifetime [0, 1]. */
  envelope?: Curve<number>;
};

type ShakePulse = Required<Omit<CameraShake, "direction">> & {
  start: number;
  axisX: number;
  axisY: number;
  phase: number;
  end: number;
  managed: boolean;
};

const maxShakePixels = 14;
const quadraticDecay = (progress: number) => (1 - progress) ** 2;

// Screen coordinates are CSS pixels relative to the fitted canvas.
export class Camera {
  private readonly screenOffset = new Transform2D();
  private readonly view = new Transform2D(this.screenOffset);
  private readonly pulses = new Set<ShakePulse>();

  constructor(private readonly playfield: Size) {}

  get zoom() {
    return this.view.scale[0];
  }

  set zoom(value: number) {
    vec2.set(this.view.scale, value, value);
  }

  fit(available: Size) {
    this.zoom = Math.min(
      available.width / this.playfield.width,
      available.height / this.playfield.height
    );
  }

  get width() {
    return this.playfield.width * this.zoom;
  }

  get height() {
    return this.playfield.height * this.zoom;
  }

  /** Start a pulse on the same simulation clock used by sampleShake. */
  shake(shake: CameraShake, time: number) {
    this.addPulse(shake, time, false);
  }

  /** Compose a shake with other effects. The camera mixes it with all other pulses. */
  shakeEffect(shake: CameraShake): Effect {
    return {
      kind: "leaf",
      start: (time) => {
        const pulse = this.addPulse(shake, time, true);
        return {
          advance: (step) => {
            if (!pulse) return time;
            pulse.end = Math.min(pulse.end, step.releasedAt ?? Infinity);
            return pulse.end <= step.end ? pulse.end : undefined;
          },
          dispose: () => {
            if (pulse) this.pulses.delete(pulse);
          }
        };
      }
    };
  }

  private addPulse(
    {
      amplitude,
      duration,
      frequency,
      direction,
      crossAxis = 0.25,
      envelope = quadraticDecay
    }: CameraShake,
    time: number,
    managed: boolean
  ) {
    if (!(amplitude > 0 && duration > 0 && frequency > 0)) return;
    const directed = direction && (direction[0] !== 0 || direction[1] !== 0);
    const angle = directed ? Math.atan2(direction[1], direction[0]) : Math.random() * tau;
    const pulse = {
      amplitude,
      duration,
      frequency,
      crossAxis,
      envelope,
      start: time,
      axisX: Math.cos(angle),
      axisY: Math.sin(angle),
      phase: directed ? Math.PI / 2 : 0,
      end: time + duration,
      managed
    };
    this.pulses.add(pulse);
    return pulse;
  }

  sampleShake(
    time: number,
    reducedMotion = false,
    rumble?: Pick<CameraShake, "amplitude" | "frequency" | "crossAxis">
  ) {
    let x = 0,
      y = 0;
    // A sustained rumble shares the simulation clock and mixes with one-shot impacts.
    if (rumble && !reducedMotion) {
      const cycle = tau * rumble.frequency * time;
      x = rumble.amplitude * Math.sin(cycle);
      y = rumble.amplitude * (rumble.crossAxis ?? 0.75) * Math.sin(cycle * 1.37);
    }
    for (const pulse of this.pulses) {
      const age = time - pulse.start;
      if (time >= pulse.end) {
        if (!pulse.managed) this.pulses.delete(pulse);
        continue;
      }
      if (age < 0 || reducedMotion) continue;
      const amplitude = pulse.amplitude * pulse.envelope(age / pulse.duration);
      const cycle = tau * pulse.frequency * age;
      const along = Math.sin(cycle + pulse.phase);
      const across = pulse.crossAxis * Math.sin(cycle * 1.37);
      x += amplitude * (along * pulse.axisX - across * pulse.axisY);
      y += amplitude * (along * pulse.axisY + across * pulse.axisX);
    }
    // Bound combined hits before scaling them to a smaller viewport.
    const scale =
      (Math.min(this.zoom, 1) * maxShakePixels) /
      Math.max(maxShakePixels, Math.hypot(x, y));
    vec2.set(this.screenOffset.position, x * scale, y * scale);
  }

  worldToScreen(point: ReadonlyVec2) {
    return this.view.localToWorld(point);
  }

  screenToWorld(point: ReadonlyVec2) {
    return this.view.worldToLocal(point);
  }

  applyTo(ctx: CanvasRenderingContext2D) {
    applyMatrix(ctx, this.view.worldMatrix());
  }
}

import type { ReadonlyMat2d } from "gl-matrix";
import { applyMatrix } from "../transform";
import { lerp, tau } from "../util";
import type { EmitterDefinition, OverLife } from "./definition";

/** Birth state in the emitter's chosen simulation space. */
export interface Particle {
  born: number;
  lifetime: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  rotation: number;
  angularSpeed: number;
  radius: number;
}

function sampleTrack<T extends number | string>(
  track: OverLife<T>,
  t: number,
  mix: (a: T, b: T, fraction: number) => T
): T {
  if (typeof track !== "object") return track;
  let left = track[0];
  if (t <= left.at) return left.value;
  for (let i = 1; i < track.length; i++) {
    const right = track[i];
    if (t < right.at)
      return mix(left.value, right.value, (t - left.at) / (right.at - left.at));
    left = right;
  }
  return left.value;
}

function mixColor(a: string, b: string, fraction: number) {
  return `color-mix(in srgb, ${a}, ${b} ${fraction * 100}%)`;
}

export function drawEmitter(
  ctx: CanvasRenderingContext2D,
  def: EmitterDefinition,
  particles: readonly Particle[],
  time: number,
  localFrame?: ReadonlyMat2d
) {
  ctx.save();
  if (localFrame) applyMatrix(ctx, localFrame);
  ctx.globalCompositeOperation = def.blend === "additive" ? "lighter" : "source-over";
  const opacity = ctx.globalAlpha;
  const drag = def.drag ?? 0;
  for (const p of particles) {
    const age = time - p.born;
    if (age < 0 || age >= p.lifetime) continue;
    const t = age / p.lifetime;
    const radius = p.radius * sampleTrack(def.sizeOverLife ?? 1, t, lerp);
    const radiusX = radius * (def.stretch ?? 1);
    if (radius <= 0 || radiusX <= 0) continue;
    // Exact displacement under constant acceleration and linear drag at render time.
    let velocityTime = age;
    let accelerationTime = (age * age) / 2;
    if (drag * age > 1e-6) {
      velocityTime = -Math.expm1(-drag * age) / drag;
      accelerationTime = (age - velocityTime) / drag;
    }
    const x = p.x + p.vx * velocityTime + p.ax * accelerationTime;
    const y = p.y + p.vy * velocityTime + p.ay * accelerationTime;
    const alpha = sampleTrack(def.opacityOverLife ?? 1, t, lerp);
    ctx.globalAlpha = opacity * Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = sampleTrack(def.colorOverLife ?? "#fff", t, mixColor);
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radius, p.rotation + p.angularSpeed * age, 0, tau);
    ctx.fill();
  }
  ctx.restore();
}

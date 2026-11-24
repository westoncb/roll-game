import type { ReadonlyMat2d } from "gl-matrix";
import { applyMatrix } from "../transform";
import { sampleKeyframes } from "../effects/curve";
import { lerp, tau } from "../../utils/math";
import type { EmitterState, OverLife } from "./emitter";
import { particlePoseAt } from "./particle";

function mixColor(a: string, b: string, fraction: number) {
  return `color-mix(in srgb, ${a}, ${b} ${fraction * 100}%)`;
}

function sampleOverLife<T extends string | number>(
  value: OverLife<T>,
  progress: number,
  mix: (a: T, b: T, fraction: number) => T
): T {
  return typeof value === "object" ? sampleKeyframes(value, progress, mix) : value;
}

export function drawEmitter(
  ctx: CanvasRenderingContext2D,
  { emitter, particles }: EmitterState,
  time: number,
  localFrame?: ReadonlyMat2d
) {
  ctx.save();
  if (localFrame) applyMatrix(ctx, localFrame);
  ctx.globalCompositeOperation = emitter.blend === "additive" ? "lighter" : "source-over";
  const opacity = ctx.globalAlpha;
  const drag = emitter.drag ?? 0;
  const pose = { x: 0, y: 0, rotation: 0 };
  for (const p of particles) {
    const age = time - p.born;
    if (age < 0 || age >= p.lifetime) continue;
    const t = age / p.lifetime;
    const radius = p.radius * sampleOverLife(emitter.sizeOverLife ?? 1, t, lerp);
    const radiusX = radius * (emitter.stretch ?? 1);
    if (radius <= 0 || radiusX <= 0) continue;
    particlePoseAt(p, age, drag, pose);
    const alpha = sampleOverLife(emitter.opacityOverLife ?? 1, t, lerp);
    ctx.globalAlpha = opacity * Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = sampleOverLife(emitter.colorOverLife ?? "#fff", t, mixColor);
    ctx.beginPath();
    ctx.ellipse(pose.x, pose.y, radiusX, radius, pose.rotation, 0, tau);
    ctx.fill();
  }
  ctx.restore();
}

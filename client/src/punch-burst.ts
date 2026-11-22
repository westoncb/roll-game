import { vec2 } from "gl-matrix";
import { Drawable2D } from "./engine/drawable";
import { lerp, tau } from "./utils/math";

const echoAngles = [0, 0.22];
const knockoutFadeSeconds = 0.08;

// Each echo is a short patch of the struck face, in coordinates where +X points
// out of the robot. The vibration dies away as the marks separate into wisps.
function ripple(
  radius: number,
  halfAngle: number,
  amplitude: number,
  phase: number,
  tilt: number
) {
  const path = new Path2D();
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    const angle = tilt + (2 * u - 1) * halfAngle;
    const envelope = Math.sin(Math.PI * u);
    const wobble = Math.sin(u * tau * 2.65 + phase) + 0.22 * Math.sin(u * tau * 3 - phase);
    const r = radius + amplitude * envelope * wobble;
    path.lineTo(r * Math.cos(angle), r * Math.sin(angle));
  }
  return path;
}

export class PunchBurst {
  readonly visual: Drawable2D;
  expiresAt: number;

  constructor(
    at: vec2,
    direction: vec2,
    strength: number,
    born: number,
    readonly target: Drawable2D,
    radius: number
  ) {
    const duration = lerp(0.5, 0.76, strength);
    this.expiresAt = born + duration;
    const angle = Math.atan2(-direction[1], -direction[0]);
    const centerAtHit = vec2.scaleAndAdd(vec2.create(), at, direction, radius);
    const count = strength > 0.55 ? 2 : 1;
    const phaseAtHit = Math.random() * tau;

    this.visual = new Drawable2D((ctx, { time }) => {
      const age = time - born;
      if (age < 0 || time >= this.expiresAt) return;
      const t = age / duration;
      const diffuse = Math.max(0, (t - 0.48) / 0.52);
      const spread = 1 - (1 - t) ** 2;
      const follow = Math.min(1, age / 0.06);
      ctx.translate(
        lerp(centerAtHit[0], target.renderPosition[0], follow),
        lerp(centerAtHit[1], target.renderPosition[1], follow)
      );
      ctx.rotate(angle);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.globalAlpha *= Math.min(
        1 - diffuse,
        (this.expiresAt - time) / knockoutFadeSeconds
      );
      ctx.setLineDash(diffuse > 0 ? [lerp(24, 4, diffuse), diffuse * 13] : []);

      for (let i = count - 1; i >= 0; i--) {
        const r = radius + 2 + i * 14 + spread * (9 + strength * 14);
        const span = (0.68 + strength * 0.39) * (1 - 0.16 * i) * (1 - 0.24 * diffuse);
        const amplitude = (4 + strength * 4) * lerp(1, 0.18, diffuse);
        const path = ripple(
          r,
          span,
          amplitude,
          phaseAtHit + age * tau * 6.5 - i * 1.3,
          echoAngles[i]
        );
        const width = lerp(3.48, 5.64, strength) * (1 - 0.12 * i) * (1 - 0.55 * diffuse);

        ctx.strokeStyle = i === 0 ? "#fff4c7" : "#ffc368";
        ctx.lineWidth = width;
        ctx.stroke(path);
      }
    });
  }

  fadeOnKnockout(time: number) {
    this.expiresAt = Math.min(this.expiresAt, time + knockoutFadeSeconds);
  }
}

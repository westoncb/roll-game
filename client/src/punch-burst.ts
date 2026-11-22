import { vec2 } from "gl-matrix";
import { Drawable2D } from "./engine/drawable";
import { lerp, tau } from "./utils/math";

// A short inked flash at the contact, followed by slivers peeling away from its tips.
export class PunchBurst {
  readonly visual: Drawable2D;
  readonly expiresAt: number;

  constructor(at: vec2, direction: vec2, strength: number, born: number) {
    const duration = lerp(0.15, 0.29, strength);
    this.expiresAt = born + duration;
    const radius = lerp(9, 43, strength);
    const count = 5 + Math.round(4 * strength);
    const flash = new Path2D();
    const tips: { angle: number; length: number }[] = [];
    for (let i = 0; i < count; i++) {
      const angle = ((i + 0.35 * Math.random()) * tau) / count;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      // Compress the flash against the struck face. Longer points flare back and sideways.
      const length = radius * (0.72 + 0.36 * Math.random()) * (1 - 0.38 * dx);
      const notch = angle + tau / (2 * count);
      const x = dx * length,
        y = dy * length;
      if (i === 0) flash.moveTo(x, y);
      else flash.lineTo(x, y);
      flash.lineTo(Math.cos(notch) * radius * 0.22, Math.sin(notch) * radius * 0.27);
      if (i % 2 === 0) tips.push({ angle, length });
    }
    flash.closePath();
    this.visual = new Drawable2D((ctx, { time }) => {
      const t = (time - born) / duration;
      if (t < 0 || t >= 1) return;
      if (t < 0.58) {
        const pop =
          t < 0.14 ? lerp(0.68, 1, t / 0.14) : 1 - 0.74 * ((t - 0.14) / 0.44) ** 2;
        ctx.save();
        ctx.scale(pop, pop);
        ctx.strokeStyle = "#422b3a";
        ctx.lineWidth = 1.3 + strength;
        ctx.lineJoin = "round";
        ctx.fillStyle = "#ffab62";
        ctx.fill(flash);
        ctx.stroke(flash);
        ctx.scale(0.68, 0.68);
        ctx.fillStyle = "#fff5cf";
        ctx.fill(flash);
        ctx.restore();
      }
      ctx.globalAlpha *= 1 - t * t;
      ctx.fillStyle = "#ffdf96";
      for (const tip of tips) {
        ctx.save();
        ctx.rotate(tip.angle);
        const start = tip.length * (0.55 + 1.05 * t);
        const span = radius * 0.42 * (1 - t);
        const halfWidth = (0.8 + strength) * (1 - t);
        ctx.beginPath();
        ctx.moveTo(start, 0);
        ctx.lineTo(start + span * 0.65, -halfWidth);
        ctx.lineTo(start + span, 0);
        ctx.lineTo(start + span * 0.52, halfWidth);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    vec2.copy(this.visual.position, at);
    this.visual.rotation = Math.atan2(direction[1], direction[0]);
  }
}

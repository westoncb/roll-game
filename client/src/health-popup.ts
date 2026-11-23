import { Drawable2D } from "./engine/drawable";
import { maxPunchStrength } from "./player/grapple-motion";
import type { HealthSource, Player } from "./player/player";
import { lerp } from "./utils/math";

export class HealthPopup {
  readonly visual: Drawable2D;
  readonly expiresAt: number;

  constructor(
    player: Player,
    delta: number,
    source: HealthSource,
    born: number,
    bounds: { width: number; height: number }
  ) {
    const punch = source.kind === "punch";
    const strength = punch ? Math.min(1, source.strength / maxPunchStrength) : 0;
    const duration = punch ? lerp(0.64, 0.96, strength) : 0.72;
    this.expiresAt = born + duration;
    const magnitude = Math.round(Math.abs(delta) * 10) / 10;
    const label = (delta > 0 ? "+" : "−") + (magnitude || "<0.1");
    const fontSize = punch ? lerp(16, 34, strength ** 2) : 17;
    const [x, y] = player.body.pos;
    const travel = punch ? lerp(26, 82, strength) : 56;
    const clearance = player.body.radius + 28;
    // Give a stream of health changes room below a robot walking on the ceiling.
    const riseDirection = y - clearance - travel < fontSize / 2 ? 1 : -1;
    const [dx, dy] = punch ? source.direction : [0, riseDirection];
    const startX = punch ? x + dx * player.body.radius * 0.55 : x + (delta > 0 ? -14 : 14);
    const startY = punch ? y + dy * player.body.radius * 0.55 - 5 : y + dy * clearance;
    this.visual = new Drawable2D((ctx, { time }) => {
      const t = (time - born) / duration;
      if (t < 0 || t >= 1) return;
      // Punch numbers hang after the initial kick. Fungal ticks rise to make room for the next one.
      const progress = punch ? 1 - (1 - Math.min(1, t / 0.4)) ** 2 : t;
      const px = startX + dx * travel * progress;
      const py = startY + (dy * travel - (punch ? 14 : 0)) * progress;
      ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
      const margin = ctx.measureText(label).width / 2 + 3;
      ctx.translate(
        Math.max(margin, Math.min(bounds.width - margin, px)),
        Math.max(fontSize / 2 + 3, Math.min(bounds.height - fontSize / 2 - 3, py))
      );
      ctx.globalAlpha *= Math.min(1, (1 - t) / 0.24);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#101921";
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = delta > 0 ? "#85f5a4" : "#ff787c";
      ctx.fillText(label, 0, 0);
    });
  }
}

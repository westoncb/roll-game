import { vec2 } from "gl-matrix";
import { Drawable2D } from "./engine/drawable";
import type { Entity } from "./engine/entity";

/** A score award stays at the collection or knockout site as the robots move away. */
export class PointsPopup implements Entity {
  readonly visual: Drawable2D;
  readonly expiresAt: number;

  constructor(
    points: number,
    color: string,
    at: vec2,
    born: number,
    bounds: { width: number; height: number }
  ) {
    const knockout = points > 1;
    const duration = knockout ? 1.35 : 1;
    const rise = knockout ? 55 : 38;
    const label = `+${points}`;
    this.expiresAt = born + duration;
    this.visual = new Drawable2D((ctx, { time }) => {
      const t = Math.max(0, Math.min(1, (time - born) / duration));
      ctx.translate(0, -rise * (1 - (1 - t) ** 2));
      const pop = 1 + 0.22 * Math.sin(Math.PI * Math.min(1, t / 0.22));
      ctx.scale(pop, pop);
      ctx.globalAlpha *= Math.min(1, (1 - t) / 0.35);
      ctx.font = `800 ${knockout ? 36 : 27}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#101921";
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(label, 0, 0);
    });
    vec2.set(
      this.visual.position,
      Math.max(35, Math.min(bounds.width - 35, at[0])),
      Math.max(rise + 20, Math.min(bounds.height - 20, at[1] - 48))
    );
  }
}

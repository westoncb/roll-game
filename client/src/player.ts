import { vec2 } from "gl-matrix";
import type { Entity } from "./entity";
import type { PhysicsBody } from "./physics";

type Leg = { angle: number; length: number; footAngle: number };

export class Player implements Entity {
  readonly body: PhysicsBody;
  angle = 0;
  readonly legs: Leg[] = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * 2 * Math.PI;
    return { angle, length: 23, footAngle: angle };
  });

  constructor(start: vec2) {
    this.body = {
      pos: vec2.clone(start),
      vel: vec2.create(),
      accel: vec2.create(),
      radius: 28,
      contacts: []
    };
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.body.pos[0], this.body.pos[1]);
    ctx.rotate(this.angle);
    ctx.strokeStyle = "#e9c680";
    ctx.fillStyle = "#e9c680";
    for (const leg of this.legs) {
      const x = Math.cos(leg.angle) * leg.length;
      const y = Math.sin(leg.angle) * leg.length;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(leg.footAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(4, -3);
      ctx.lineTo(4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.roundRect(-13, -10, 26, 20, 5);
    ctx.fill();
    ctx.restore();
  }
}

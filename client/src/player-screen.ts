import type { vec2 } from "gl-matrix";
import { Drawable2D } from "./drawable";
import { playerConfig } from "./player-config";
import { approachAngle } from "./util";

const { screen } = playerConfig;
const characterSeconds = 0.12;

export class PlayerScreen extends Drawable2D {
  private previousLine = ">SYS";
  private line = "F000";
  private lineTime = 0;
  private charge = 0;
  private settledSeconds = 0;
  private contentAngle = 0;

  constructor(private readonly shell: Drawable2D) {
    super((ctx) => this.drawScreen(ctx), shell);
  }

  update(
    dt: number,
    charge: number,
    speed: number,
    feet: number,
    plantedNormal: vec2 | null
  ) {
    this.charge = charge;
    this.lineTime += dt;
    // Leave a short pause after the final character before scrolling the line up.
    const lineSeconds = (this.line.length + 2) * characterSeconds;
    if (this.lineTime >= lineSeconds) {
      this.lineTime %= lineSeconds;
      this.previousLine = this.line;
      this.line = this.line.startsWith("F")
        ? "V" + Math.min(999, Math.round(speed)).toString().padStart(3, "0")
        : "F" + feet.toString().padStart(3, "0");
    }

    this.settledSeconds = plantedNormal ? this.settledSeconds + dt : 0;
    if (plantedNormal && this.settledSeconds >= screen.settleSeconds) {
      // Local +Y is the bottom of the text. Aim it opposite the planted outward normal.
      const target = Math.atan2(plantedNormal[0], -plantedNormal[1]) - this.shell.rotation;
      this.contentAngle = approachAngle(this.contentAngle, target, screen.turnSpeed * dt);
    }
  }

  private drawScreen(ctx: CanvasRenderingContext2D) {
    const { width, height, cornerRadius, borderWidth } = screen;
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, cornerRadius);
    ctx.fill();
    ctx.lineWidth = borderWidth;
    ctx.stroke();
    ctx.clip();
    ctx.rotate(this.contentAngle);
    ctx.font = 'bold 7px "Courier Prime", Menlo, monospace';
    if (this.charge > 0) {
      ctx.fillStyle = "#fff2db";
      ctx.fillText("JMP", -7.5, -1);
      const lit = Math.ceil(this.charge * 5);
      for (let i = 0; i < 5; i++) {
        ctx.globalAlpha = i < lit ? 1 : 0.22;
        ctx.fillRect(-7.5 + i * 3.2, 2, 2.2, 3.5);
      }
    } else {
      const count = Math.min(
        this.line.length,
        Math.floor(this.lineTime / characterSeconds)
      );
      ctx.fillStyle = "#6aa996";
      ctx.fillText(this.previousLine, -8.4, -1);
      ctx.fillStyle = "#abffcf";
      ctx.fillText(this.line.slice(0, count), -8.4, 5.6);
      if (count < this.line.length) ctx.fillRect(-8.4 + count * 4.2, 5.6, 3.1, 1);
    }
  }
}

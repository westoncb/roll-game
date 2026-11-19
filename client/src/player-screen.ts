import { vec2 } from "gl-matrix";
import { Drawable2D } from "./drawable";
import { playerConfig } from "./player-config";
import type { PlayerGun } from "./player-gun";
import { approachAngle, tau } from "./util";

const { screen } = playerConfig;
const characterSeconds = 0.12;
const staticHoldSeconds = 0.5;
const staticFadeSeconds = 1;
const staticColors = [
  "#172238",
  "#30325a",
  "#276a7b",
  "#69d7d4",
  "#885ac4",
  "#ec69a1",
  "#ffc885",
  "#d7ece5"
];

type ScreenInput = {
  airborne: boolean;
  charging: boolean;
  speed: number;
  feet: number;
  plantedNormal: vec2 | null;
};

type ScreenMode = "terminal" | "sight" | "chargeGrin" | "flightStatic";

export class PlayerScreen extends Drawable2D {
  private previousLine = ">SYS";
  private line = "F000";
  private lineTime = 0;
  private mode: ScreenMode = "terminal";
  private time = 0;
  private lastAirTime = -Infinity;
  private settledSeconds = 0;
  private contentAngle = 0;

  constructor(
    private readonly shell: Drawable2D,
    private readonly gun: PlayerGun
  ) {
    super((ctx) => this.drawScreen(ctx), shell);
    // The TV and its artwork share a coordinate system sized for a 30-unit shell.
    const scale = playerConfig.shell.size / 30;
    vec2.set(this.scale, scale, scale);
  }

  update(dt: number, { airborne, charging, speed, feet, plantedNormal }: ScreenInput) {
    this.time += dt;
    if (airborne) this.lastAirTime = this.time;
    this.mode = this.displayMode(charging);
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

  private displayMode(charging: boolean): ScreenMode {
    if (charging) return "chargeGrin";
    const phase = this.gun.phase;
    if (
      this.time - this.lastAirTime < staticHoldSeconds + staticFadeSeconds &&
      (phase === "idle" || phase === "pulling")
    )
      return "flightStatic";
    return phase === "idle" ? "terminal" : "sight";
  }

  private drawScreen(ctx: CanvasRenderingContext2D) {
    const { width, height, cornerRadius, borderWidth } = screen;
    if (this.mode === "flightStatic") ctx.fillStyle = "#000";
    else if (this.mode === "sight") ctx.fillStyle = "#0c293a";
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, cornerRadius);
    ctx.fill();
    ctx.lineWidth = borderWidth;
    ctx.stroke();
    ctx.clip();
    if (this.mode === "flightStatic") {
      const fadeTime = Math.max(0, this.time - this.lastAirTime - staticHoldSeconds);
      ctx.globalAlpha *= 1 - fadeTime / staticFadeSeconds;
      drawStatic(ctx, Math.floor(this.time * 14));
      return;
    }
    ctx.rotate(this.contentAngle);
    if (this.mode === "chargeGrin") {
      drawGrin(ctx);
    } else if (this.mode === "sight") {
      const matrix = this.renderWorldMatrix;
      const screenAngle = Math.atan2(matrix[1], matrix[0]) + this.contentAngle;
      drawSight(ctx, this.gun.renderAngle - screenAngle);
    } else {
      ctx.font = 'bold 7px "Courier Prime", Menlo, monospace';
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

function drawStatic(ctx: CanvasRenderingContext2D, frame: number) {
  // Repainting the same TV frame should reproduce the same noise.
  let seed = Math.imul(frame + 1, 2654435761);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const { width, height } = screen;
  for (let y = -height / 2; y < height / 2; y += 2) {
    for (let x = -width / 2; x < width / 2; ) {
      const run = 1 + Math.floor(random() * 4);
      ctx.fillStyle = staticColors[Math.floor(random() * staticColors.length)];
      ctx.fillRect(x, y, run, 1.5);
      x += run;
    }
  }
}

function drawSight(ctx: CanvasRenderingContext2D, aimAngle: number) {
  ctx.strokeStyle = "#98e9f3";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 5.9, 0, tau);
  ctx.moveTo(-8.8, 0);
  ctx.lineTo(8.8, 0);
  ctx.moveTo(0, -8.8);
  ctx.lineTo(0, 8.8);
  ctx.stroke();
  ctx.rotate(aimAngle);
  ctx.fillStyle = "#ffcf70";
  ctx.beginPath();
  ctx.moveTo(9.6, 0);
  ctx.lineTo(4.6, -2.6);
  ctx.lineTo(4.6, 2.6);
  ctx.closePath();
  ctx.fill();
}

function drawGrin(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#182333";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const x of [-4.2, 4.2]) {
    ctx.moveTo(x - 1.9, -3);
    ctx.quadraticCurveTo(x, -7, x + 1.9, -3.4);
  }
  ctx.stroke();

  ctx.fillStyle = "#182333";
  ctx.beginPath();
  ctx.moveTo(-7.6, -0.5);
  ctx.quadraticCurveTo(0, 1.7, 7.5, -1.2);
  ctx.bezierCurveTo(6.4, 9.3, -5.5, 9.8, -7.6, -0.5);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "#fff3cc";
  ctx.beginPath();
  ctx.moveTo(-6.3, -2);
  ctx.lineTo(6.3, -2);
  ctx.lineTo(5.5, 2.2);
  ctx.quadraticCurveTo(0, 5, -5.3, 2.5);
  ctx.fill();
  ctx.fillStyle = "#ff8293";
  ctx.beginPath();
  ctx.ellipse(1.4, 7.3, 3.3, 1.9, -0.2, 0, tau);
  ctx.fill();
}

import { vec2 } from "gl-matrix";
import { Drawable2D } from "../engine/drawable";
import { playerConfig } from "./config";
import type { PlayerGun } from "./gun";
import { approachAngle, tau } from "../utils/math";

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
  bootProgress: number | null;
  airborne: boolean;
  charge: number;
  speed: number;
  feet: number;
  plantedNormal: vec2 | null;
};

type ScreenMode = "boot" | "terminal" | "sight" | "chargeScope" | "flightStatic";

export class PlayerScreen extends Drawable2D {
  private previousLine = ">SYS";
  private line = "F000";
  private lineTime = 0;
  private mode: ScreenMode = "terminal";
  private bootProgress: number | null = null;
  private charge = 0;
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

  update(
    dt: number,
    { bootProgress, airborne, charge, speed, feet, plantedNormal }: ScreenInput
  ) {
    this.time += dt;
    this.bootProgress = bootProgress;
    this.charge = charge;
    if (airborne) this.lastAirTime = this.time;
    this.mode = this.displayMode();
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

  private displayMode(): ScreenMode {
    if (this.bootProgress !== null) return "boot";
    if (this.gun.showingSight) return "sight";
    if (this.charge > 0) return "chargeScope";
    if (this.time - this.lastAirTime < staticHoldSeconds + staticFadeSeconds)
      return "flightStatic";
    return "terminal";
  }

  private drawScreen(ctx: CanvasRenderingContext2D) {
    const { width, height, cornerRadius, borderWidth } = screen;
    if (this.mode === "boot") ctx.fillStyle = "#2b211b";
    else if (this.mode === "flightStatic") ctx.fillStyle = "#000";
    else if (this.mode === "sight") ctx.fillStyle = "#0c293a";
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, cornerRadius);
    ctx.fill();
    ctx.lineWidth = borderWidth;
    ctx.stroke();
    ctx.clip();
    if (this.mode === "boot") {
      // Keep the boot readout level even when the shell rolls.
      const matrix = this.renderWorldMatrix;
      ctx.rotate(-Math.atan2(matrix[1], matrix[0]));
      ctx.textAlign = "center";
      ctx.font = 'bold 7px "Courier Prime", Menlo, monospace';
      ctx.fillStyle = "#ffe5af";
      ctx.fillText("BOOT", 0, 0);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i <= (this.bootProgress ?? 0) * 4 ? "#ffcd81" : "#65513e";
        ctx.fillRect(-7.5 + i * 4, 3, 3, 2);
      }
      return;
    }
    if (this.mode === "flightStatic") {
      const fadeTime = Math.max(0, this.time - this.lastAirTime - staticHoldSeconds);
      ctx.globalAlpha *= 1 - fadeTime / staticFadeSeconds;
      drawStatic(ctx, Math.floor(this.time * 14));
      return;
    }
    ctx.rotate(this.contentAngle);
    if (this.mode === "chargeScope") {
      drawChargeScope(ctx, this.time, this.charge);
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

function drawChargeScope(ctx: CanvasRenderingContext2D, time: number, charge: number) {
  // Span the diagonal so the trace reaches the glass edge at any screen orientation.
  const span = Math.ceil(Math.hypot(screen.width, screen.height));
  const amplitude = 1.8 + 4.6 * charge;
  const frequency = (tau * (1 + 0.8 * charge)) / screen.width;
  const waveY = (x: number) => {
    const phase = x * frequency - time * tau * 1.3;
    return amplitude * (Math.sin(phase) + 0.24 * charge * Math.sin(2 * phase + 0.6));
  };

  ctx.fillStyle = "#902d44";
  for (let x = -span / 2; x < span / 2; x += 4) ctx.fillRect(x, -0.45, 2, 0.9);
  ctx.beginPath();
  ctx.moveTo(-span / 2, waveY(-span / 2));
  for (let x = -span / 2 + 0.5; x <= span / 2; x += 0.5) ctx.lineTo(x, waveY(x));
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#a33145";
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#fff1b3";
  ctx.stroke();

  const sweepX = (((time * 1.5) % 1) - 0.5) * span;
  ctx.fillStyle = "#fffef2";
  ctx.beginPath();
  ctx.arc(sweepX, waveY(sweepX), 1.65, 0, tau);
  ctx.fill();
}

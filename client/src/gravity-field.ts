import { vec2 } from "gl-matrix";
import type { GroundPolygon } from "./ground";
import { sampleGravity } from "./physics";
import { lerp } from "./util";

const density = 0.65;
const opacity = 0.56;
const sampleSeconds = 0.08;
const maxSpeed = 68;
const tailSeconds = 0.27;
const maxSeedCells = 1200;

type Sample = { x: number; y: number; strength: number };
type Streak = { path: Sample[]; phase: number };

function trace(start: vec2, radius: number, ground: GroundPolygon[]): Sample[] {
  const path: Sample[] = [];
  const force = vec2.create();
  const count = 18 + Math.floor(Math.random() * 21);
  for (let i = 0; i < count; i++) {
    const clearance = sampleGravity(force, start, radius, ground);
    const magnitude = vec2.length(force);
    if (clearance <= 1 || magnitude < 20) break;
    const strength = Math.min(1, magnitude / 1050);
    path.push({ x: start[0], y: start[1], strength });
    const travel = strength * maxSpeed * sampleSeconds;
    // End the streak before a step can cross even a thin piece of terrain.
    if (travel >= clearance) break;
    vec2.scaleAndAdd(start, start, force, travel / magnitude);
  }
  return path;
}

export class GravityField {
  private readonly streaks: Streak[] = [];
  private previousTime = 0;
  private time = 0;

  constructor(width: number, height: number, radius: number, ground: GroundPolygon[]) {
    if (!ground.some((polygon) => polygon.gravityScale !== 0)) return;
    // Spread a bounded number of starting points over the whole level.
    const spacing = Math.max(
      35,
      width / maxSeedCells,
      height / maxSeedCells,
      Math.sqrt(width) * Math.sqrt(height / maxSeedCells)
    );
    const columns = Math.ceil(width / spacing);
    const rows = Math.ceil(height / spacing);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        if (Math.random() >= density) continue;
        const start = vec2.fromValues(
          (col + Math.random()) * (width / columns),
          (row + Math.random()) * (height / rows)
        );
        const path = trace(start, radius, ground);
        if (path.length >= 5) this.streaks.push({ path, phase: Math.random() });
      }
    }
  }

  step(dt: number) {
    this.previousTime = this.time;
    this.time += dt;
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number) {
    const time = lerp(this.previousTime, this.time, alpha);
    ctx.save();
    ctx.strokeStyle = "#adc9ce";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { path, phase } of this.streaks) {
      const last = path.length - 1;
      const progress = (phase + time / (last * sampleSeconds)) % 1;
      const head = progress * last;
      const tail = Math.max(0, head - tailSeconds / sampleSeconds);
      const i = Math.floor(head);
      const j = Math.floor(tail);
      const from = path[i],
        to = path[i + 1];
      const x = lerp(from.x, to.x, head - i);
      const y = lerp(from.y, to.y, head - i);
      const strength = lerp(from.strength, to.strength, head - i);
      const fade = opacity * Math.min(1, progress / 0.13, (1 - progress) / 0.18);
      ctx.globalAlpha = fade * (0.22 + 0.43 * strength);
      ctx.lineWidth = 1.35 + 0.65 * strength;
      ctx.beginPath();
      ctx.moveTo(
        lerp(path[j].x, path[j + 1].x, tail - j),
        lerp(path[j].y, path[j + 1].y, tail - j)
      );
      for (let k = j + 1; k <= i; k++) ctx.lineTo(path[k].x, path[k].y);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.globalAlpha = fade * (0.3 + 0.43 * strength);
      ctx.lineWidth += 0.55;
      ctx.beginPath();
      ctx.moveTo(x - (to.x - from.x) * 0.3, y - (to.y - from.y) * 0.3);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

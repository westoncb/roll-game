import { vec2, type ReadonlyVec2 } from "gl-matrix";
import type { TerrainHit } from "../collision";
import { Drawable2D } from "../drawable";
import { playerConfig } from "./config";
import { approach, tau } from "../util";

// The level identifies the first target; only a clingable hit supplies a movement anchor.
export type BeamHit =
  | ({ kind: "clingable" } & TerrainHit)
  | { kind: "damageable"; point: vec2 };
export type CastBeam = (
  from: vec2,
  to: vec2
) => BeamHit | { kind: "miss"; point: vec2 } | null;

const gun = playerConfig.gun;
const dockedNose: ReadonlyVec2 = [gun.headLength, 0];
type Shot =
  | { kind: "idle" }
  | { kind: "aiming"; rightTurn: 1 | -1; time: number }
  | { kind: "extending"; direction: vec2; castFrom: vec2 }
  | { kind: "pulling"; hit: TerrainHit; latchLength: number; lastDistance: number }
  | { kind: "retracting"; remaining: number };

export class PlayerGun {
  private shot: Shot = { kind: "idle" };
  private readonly pivot: Drawable2D;
  private readonly muzzle: Drawable2D;
  private readonly tipNode: Drawable2D;
  private readonly tip = vec2.create();

  constructor(
    private readonly root: Drawable2D,
    stance: Drawable2D
  ) {
    this.tipNode = new Drawable2D((ctx) => this.drawGrapple(ctx), root);
    this.pivot = new Drawable2D(undefined, stance);
    this.muzzle = new Drawable2D((ctx) => this.drawBarrel(ctx), this.pivot);
  }

  get phase() {
    return this.shot.kind;
  }
  get renderAngle() {
    const matrix = this.pivot.renderWorldMatrix;
    return Math.atan2(matrix[1], matrix[0]);
  }
  get anchor() {
    return this.shot.kind === "pulling" ? this.shot.hit : null;
  }

  pullVelocity(center: vec2, radius: number) {
    const anchor = this.anchor;
    if (!anchor) return null;
    const toAnchor = vec2.subtract(vec2.create(), anchor.point, center);
    const distance = vec2.length(toAnchor);
    if (distance <= radius + 0.001) {
      this.finish();
      return null;
    }
    return vec2.scale(toAnchor, toAnchor, gun.pullSpeed / distance);
  }

  beginAim(direction: ReadonlyVec2) {
    if (this.shot.kind !== "idle") return;
    this.pivot.setOrientation(Math.atan2(direction[1], direction[0]));
    // Right turns clockwise from an upward or horizontal start, counterclockwise from below.
    this.shot = { kind: "aiming", rightTurn: direction[1] > 1e-6 ? -1 : 1, time: 0 };
  }

  aim(horizontalInput: number, dt: number) {
    const shot = this.shot;
    if (shot.kind !== "aiming") return;
    this.pivot.rotation += horizontalInput * shot.rightTurn * gun.aimSpeed * dt;
  }

  fire() {
    if (this.shot.kind !== "aiming") return;
    // A tap still fires from the end of a deployed barrel.
    this.muzzle.position[0] = gun.barrelLength;
    this.muzzle.localToWorld(dockedNose, this.tip);
    const mount = this.pivot.localToWorld([0, 0]);
    const direction = vec2.subtract(vec2.create(), this.tip, mount);
    this.shot = {
      kind: "extending",
      direction: vec2.normalize(direction, direction),
      castFrom: mount
    };
  }

  finish() {
    this.shot = { kind: "idle" };
  }

  update(cast: CastBeam, dt: number) {
    const shot = this.shot;
    this.muzzle.position[0] = approach(
      this.muzzle.position[0],
      shot.kind === "idle" ? 0 : gun.barrelLength,
      gun.deploySpeed * dt
    );
    const dock = this.muzzle.localToWorld(dockedNose);
    if (shot.kind === "extending") {
      const travel = gun.extensionSpeed * dt;
      const end = vec2.scaleAndAdd(vec2.create(), this.tip, shot.direction, travel);
      // On release this includes the loaded head, even when aimed into nearby terrain.
      const result = cast(shot.castFrom, end);
      if (result) {
        vec2.copy(this.tip, result.point);
        if (result.kind === "clingable") {
          const socket = vec2.scaleAndAdd(
            vec2.create(),
            this.tip,
            result.normal,
            gun.headLength
          );
          this.shot = {
            kind: "pulling",
            hit: result,
            latchLength: vec2.distance(this.muzzle.localToWorld([0, 0]), socket),
            lastDistance: vec2.distance(this.root.position, this.tip)
          };
        } else this.shot = { kind: "retracting", remaining: vec2.distance(dock, this.tip) };
      } else {
        vec2.copy(this.tip, end);
        vec2.copy(shot.castFrom, end);
      }
    } else if (shot.kind === "pulling") {
      // Physics can slide the body along an existing contact without reporting a new hit.
      const distance = vec2.distance(this.root.position, this.tip);
      if (shot.lastDistance - distance < gun.minPullProgressSpeed * dt) this.finish();
      else shot.lastDistance = distance;
    } else if (shot.kind === "retracting") {
      const distance = vec2.distance(this.tip, dock);
      shot.remaining = Math.max(
        0,
        Math.min(shot.remaining, distance) - gun.retractSpeed * dt
      );
      if (shot.remaining === 0) {
        vec2.copy(this.tip, dock);
        this.finish();
      } else vec2.lerp(this.tip, dock, this.tip, shot.remaining / distance);
    } else {
      vec2.copy(this.tip, dock);
      if (shot.kind === "aiming") shot.time += dt;
    }
    this.root.worldToLocal(this.tip, this.tipNode.position);
  }

  private drawBarrel(ctx: CanvasRenderingContext2D) {
    const reach = this.muzzle.renderPosition[0];
    if (reach <= 0) return;
    ctx.fillRect(-reach, -4, reach, 8);
    ctx.lineWidth = playerConfig.leg.borderWidth;
    ctx.strokeRect(-reach, -4, reach, 8);
    ctx.fillStyle = "#273941";
    ctx.fillRect(-16, -4, 15, 8);
    ctx.fillStyle = "#68cbd1";
    for (let x = -14; x <= -6; x += 4) ctx.fillRect(x, -3.5, 2, 7);
    ctx.fillStyle = "#566973";
    ctx.fillRect(-4, -5.5, 4, 11);
    ctx.strokeRect(-4, -5.5, 4, 11);

    const shot = this.shot;
    if (shot.kind === "aiming") drawAimWaves(ctx, shot.time);
    if (shot.kind === "aiming" || shot.kind === "idle") {
      ctx.translate(gun.headLength, 0);
      drawGrappleHead(ctx, false);
    }
  }

  private drawGrapple(ctx: CanvasRenderingContext2D) {
    if (this.shot.kind === "idle" || this.shot.kind === "aiming") return;
    // Seat the claws on contact even in the interpolated frame when the cast first hits.
    const anchor = this.anchor;
    const tipPose = this.tipNode.renderWorldMatrix;
    const tipX = anchor?.point[0] ?? tipPose[4];
    const tipY = anchor?.point[1] ?? tipPose[5];
    ctx.translate(tipX - tipPose[4], tipY - tipPose[5]);
    const angle = anchor
      ? Math.atan2(-anchor.normal[1], -anchor.normal[0])
      : this.renderAngle;
    const dx = this.muzzle.renderWorldMatrix[4] - tipX;
    const dy = this.muzzle.renderWorldMatrix[5] - tipY;
    const cableX = -gun.headLength * Math.cos(angle) - dx;
    const cableY = -gun.headLength * Math.sin(angle) - dy;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(Math.atan2(cableY, cableX));
    this.drawBeam(ctx, Math.hypot(cableX, cableY));
    ctx.restore();
    ctx.rotate(angle);
    drawGrappleHead(ctx, anchor !== null);
  }

  private drawBeam(ctx: CanvasRenderingContext2D, length: number) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(66,214,236,.18)";
    ctx.fillRect(0, -4, length, 8);
    // Keep the last partial sleeve at the anchor. The first sleeve disappears into the muzzle.
    const pitch = gun.segmentLength;
    const clipped =
      this.shot.kind === "pulling"
        ? (((this.shot.latchLength - length) % pitch) + pitch) % pitch
        : 0;
    const sleeves = new Path2D();
    for (let s = -clipped; s < length; s += pitch) {
      const start = Math.max(0, s),
        end = Math.min(length, s + pitch - 1.5);
      if (end > start) sleeves.rect(start, -2, end - start, 4);
    }
    ctx.fillStyle = "#61d4df";
    ctx.shadowColor = "#57dce6";
    ctx.shadowBlur = 6;
    ctx.fill(sleeves);
    ctx.shadowBlur = 0;
    ctx.scale(1, 0.375);
    ctx.fillStyle = "#ddffff";
    ctx.fill(sleeves);
  }
}

// The nose is the cast point. The cable joins the ferrule at the opposite end.
function drawGrappleHead(ctx: CanvasRenderingContext2D, latched: boolean) {
  const tail = -gun.headLength;
  const clawX = latched ? 0 : -9;
  const span = latched ? 8 : 5.5;
  ctx.strokeStyle = "#28343b";
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.fillStyle = "#f0b866";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-4.5, 2.6);
  ctx.lineTo(clawX, span);
  ctx.lineTo(clawX - 2, span - 1);
  ctx.lineTo(tail + 2, 2);
  ctx.lineTo(tail, 2);
  ctx.lineTo(tail, -2);
  ctx.lineTo(tail + 2, -2);
  ctx.lineTo(clawX - 2, 1 - span);
  ctx.lineTo(clawX, -span);
  ctx.lineTo(-4.5, -2.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff1bf";
  ctx.fillRect(-7.5, -0.9, 5, 1.8);
}

function drawAimWaves(ctx: CanvasRenderingContext2D, time: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = "#82eff2";
  const opacity = ctx.globalAlpha;
  for (let i = 0; i < 2; i++) {
    const phase = (time * 1.35 + i * 0.5) % 1;
    const y = 5 + 11 * phase;
    const ripple = 2.5 * Math.sin(tau * (time * 2 - phase));
    ctx.globalAlpha = opacity * Math.sin(Math.PI * phase) * 0.8;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(-17, side * y);
      ctx.bezierCurveTo(
        -12,
        side * (y + ripple + 3),
        -6,
        side * (y - ripple - 2),
        0,
        side * y
      );
    }
    ctx.stroke();
  }
  ctx.restore();
}

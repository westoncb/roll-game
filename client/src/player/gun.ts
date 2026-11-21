import { vec2, type ReadonlyVec2 } from "gl-matrix";
import { castSegment, type TerrainHit } from "../engine/collision";
import type { GroundPolygon } from "../engine/ground";
import { Drawable2D } from "../engine/drawable";
import { playerConfig } from "./config";
import { approach, tau } from "../utils/math";
import type { PhysicsBody } from "../engine/physics";
import type { FungalGem } from "../fungus/gem";
import type { Player } from "./player";

// The level identifies the first target; only a clingable hit supplies a movement anchor.
export type BeamHit =
  | ({ kind: "clingable" } & TerrainHit)
  | { kind: "gem"; point: vec2; normal: vec2; fraction: number; gem: FungalGem }
  | { kind: "robot"; point: vec2; fraction: number; target: Player };
export type CastBeam = (
  from: vec2,
  direction: vec2,
  distance?: number
) => BeamHit | { kind: "miss" | "clear"; point: vec2 };

const gun = playerConfig.gun;
const dockedNose: ReadonlyVec2 = [gun.headLength, 0];
type Shot =
  | { kind: "idle" }
  | { kind: "extending"; direction: vec2; castFrom: vec2 }
  | { kind: "pulling"; hit: TerrainHit; latchLength: number; lastDistance: number }
  | { kind: "reeling"; gem: FungalGem; grip: vec2; normal: vec2; latchLength: number }
  | { kind: "tether"; target: Player; remaining: number }
  | { kind: "retracting"; remaining: number; direction: vec2 };

export class PlayerGun {
  private aim: { rightTurn: number; target: vec2 | null; fired: boolean } | null = null;
  private lastShot: { angle: number; position: vec2 } | null = null;
  private shot: Shot = { kind: "idle" };
  private deploying = false;
  private readonly pivot: Drawable2D;
  private readonly muzzle: Drawable2D;
  private readonly tipNode: Drawable2D;
  private readonly tip = vec2.create();

  constructor(
    private readonly stance: Drawable2D,
    private readonly receiver: PhysicsBody,
    private readonly cast: CastBeam,
    private readonly collectGem: () => void
  ) {
    this.tipNode = new Drawable2D((ctx) => this.drawGrapple(ctx), stance);
    this.pivot = new Drawable2D(undefined, stance);
    this.pivot.rotation = -Math.PI / 2;
    this.muzzle = new Drawable2D((ctx) => this.drawBarrel(ctx), this.pivot);
    new Drawable2D((ctx) => this.drawLaserDot(ctx), this.pivot);
  }

  get aiming() {
    return this.aim !== null;
  }
  get ready() {
    return this.shot.kind === "idle";
  }
  get tethered() {
    return this.shot.kind === "tether" ? this.shot.target : null;
  }
  get showingSight() {
    return this.aiming || this.shot.kind !== "idle" || this.muzzle.position[0] > 0;
  }
  get renderAngle() {
    const matrix = this.pivot.renderWorldMatrix;
    return Math.atan2(matrix[1], matrix[0]);
  }
  get anchor() {
    return this.shot.kind === "pulling" ? this.shot.hit : null;
  }

  threatens(target: Player) {
    if (this.tethered === target) return true;
    const shot = this.shot;
    if (shot.kind !== "extending" && !(this.ready && this.aiming)) return false;
    const from =
      shot.kind === "extending" ? shot.castFrom : this.pivot.localToWorld([0, 0]);
    if (vec2.distance(from, target.body.pos) > 480) return false;
    const angle = this.pivot.rotation;
    const direction =
      shot.kind === "extending"
        ? shot.direction
        : vec2.fromValues(Math.cos(angle), Math.sin(angle));
    const first = this.cast(from, direction, 480);
    return first.kind === "robot" && first.target === target;
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

  beginAim(defaultDirection: ReadonlyVec2) {
    const angle =
      this.lastShot?.angle ?? Math.atan2(defaultDirection[1], defaultDirection[0]);
    this.pivot.setOrientation(angle);
    this.aim = { rightTurn: Math.sin(angle) > 1e-6 ? -1 : 1, target: null, fired: false };
  }

  pointAt(target: vec2 | null) {
    if (!this.aim || !target) return;
    this.aim.target = target;
    const mount = this.tethered?.body.pos ?? this.pivot.localToWorld([0, 0]);
    const dx = target[0] - mount[0],
      dy = target[1] - mount[1];
    if (dx || dy) this.pivot.setOrientation(Math.atan2(dy, dx));
  }

  turn(horizontal: number, dt: number) {
    if (!this.aim || !horizontal) return;
    this.aim.target = null;
    this.pivot.rotation += horizontal * this.aim.rightTurn * gun.aimSpeed * dt;
  }

  endAim(fireOnRelease: boolean) {
    if (fireOnRelease && this.aim && !this.aim.fired) this.fire();
    this.aim = null;
  }

  fire() {
    if (!this.aim) return;
    if (this.shot.kind === "tether") {
      const angle = this.pivot.rotation;
      this.shot.target.throwAlong(vec2.fromValues(Math.cos(angle), Math.sin(angle)));
      this.aim.fired = true;
      this.finish();
      return;
    }
    if (!this.ready) return;
    this.aim.fired = true;
    this.lastShot = { angle: this.pivot.rotation, position: vec2.clone(this.receiver.pos) };
    this.deploying = true;
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

  onRespawn() {
    this.endAim(false);
    this.lastShot = null;
    this.deploying = false;
    this.muzzle.position[0] = 0;
    this.pivot.setOrientation(-Math.PI / 2);
    if (this.shot.kind === "reeling") {
      this.shot.gem.receiverRespawned();
      this.stance.worldToLocal(this.tip, this.tipNode.position);
    } else this.finish();
  }

  update(dt: number, ground: GroundPolygon[]) {
    if (
      this.lastShot &&
      vec2.squaredDistance(this.receiver.pos, this.lastShot.position) >=
        gun.aimMemoryDistance ** 2
    )
      this.lastShot = null;
    if (this.aim?.target) this.pointAt(this.aim.target);
    const shot = this.shot;
    // Even a point-blank hit completes the outward stroke before the barrel stows.
    const reach = approach(
      this.muzzle.position[0],
      this.aiming || this.deploying || shot.kind !== "idle" ? gun.barrelLength : 0,
      gun.barrelSpeed * dt
    );
    this.muzzle.position[0] = reach;
    if (reach === gun.barrelLength) this.deploying = false;
    const dock = this.muzzle.localToWorld(dockedNose);
    if (shot.kind === "extending") {
      // The first sweep includes the loaded head so a close surface still catches it.
      const distance = vec2.distance(shot.castFrom, this.tip) + gun.extensionSpeed * dt;
      const result = this.cast(shot.castFrom, shot.direction, distance);
      vec2.copy(this.tip, result.point);
      if (result.kind === "clear") {
        vec2.copy(shot.castFrom, result.point);
      } else if (result.kind === "clingable" || result.kind === "gem") {
        const socket = vec2.scaleAndAdd(
          vec2.create(),
          this.tip,
          result.normal,
          gun.headLength
        );
        const latchLength = vec2.distance(this.muzzle.localToWorld([0, 0]), socket);
        if (result.kind === "gem") {
          const grip = result.gem.visual.worldToLocal(result.point);
          result.gem.reelTo(this.receiver, gun.reelSpeed, this.collectGem);
          this.shot = {
            kind: "reeling",
            gem: result.gem,
            grip,
            normal: result.normal,
            latchLength
          };
        } else {
          this.shot = {
            kind: "pulling",
            hit: result,
            latchLength,
            lastDistance: vec2.distance(this.receiver.pos, this.tip)
          };
        }
      } else if (result.kind === "robot") {
        this.shot = { kind: "tether", target: result.target, remaining: gun.tetherSeconds };
      } else {
        this.shot = {
          kind: "retracting",
          remaining: vec2.distance(dock, this.tip),
          direction: shot.direction
        };
      }
    } else if (shot.kind === "pulling") {
      // Physics can slide the body along an existing contact without reporting a new hit.
      const distance = vec2.distance(this.receiver.pos, this.tip);
      if (shot.lastDistance - distance < gun.minPullProgressSpeed * dt) this.finish();
      else shot.lastDistance = distance;
    } else if (shot.kind === "tether") {
      shot.remaining -= dt;
      const body = shot.target.body;
      const toward = vec2.subtract(vec2.create(), this.receiver.pos, body.pos);
      vec2.normalize(toward, toward);
      vec2.scaleAndAdd(this.tip, body.pos, toward, body.radius * 0.8);
      if (shot.remaining <= 0 || castSegment(this.receiver.pos, body.pos, ground)) {
        this.finish();
        // Losing the cable while aiming a throw cancels that release.
        if (this.aim) this.aim.fired = true;
      }
    } else if (shot.kind === "reeling") {
      shot.gem.visual.localToWorld(shot.grip, this.tip);
      if (!shot.gem.reeling) this.finish();
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
    }
    this.stance.worldToLocal(this.tip, this.tipNode.position);
  }

  private drawLaserDot(ctx: CanvasRenderingContext2D) {
    if (!this.aiming) return;
    const [dx, dy, , , x, y] = this.pivot.renderWorldMatrix;
    if (this.tethered) {
      // Mark the launch direction at the other end of the cable.
      const target = this.tethered.visual.renderWorldMatrix;
      const ox = target[4] - x,
        oy = target[5] - y;
      ctx.translate(ox * dx + oy * dy, oy * dx - ox * dy);
      const start = this.tethered.body.radius;
      ctx.strokeStyle = "#ffe195";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(start, 0);
      ctx.lineTo(start + 60, 0);
      ctx.lineTo(start + 50, -6);
      ctx.moveTo(start + 60, 0);
      ctx.lineTo(start + 50, 6);
      ctx.stroke();
      return;
    }
    const hit = this.cast(vec2.fromValues(x, y), vec2.fromValues(dx, dy));
    if (hit.kind === "clear" || hit.kind === "miss") return;
    ctx.translate(Math.hypot(hit.point[0] - x, hit.point[1] - y), 0);
    ctx.fillStyle = "#ff403d";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, tau);
    ctx.fill();
    ctx.fillStyle = "#fff2dc";
    ctx.beginPath();
    ctx.arc(0, 0, 1.25, 0, tau);
    ctx.fill();
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

    if (this.shot.kind === "idle") {
      ctx.translate(gun.headLength, 0);
      drawGrappleHead(ctx, false);
    }
  }

  private drawGrapple(ctx: CanvasRenderingContext2D) {
    if (this.shot.kind === "idle") return;
    // Seat the claws on contact even in the interpolated frame when the cast first hits.
    const shot = this.shot;
    if (shot.kind === "reeling" && !shot.gem.reeling) return;
    const tipPose = this.tipNode.renderWorldMatrix;
    const contact =
      shot.kind === "reeling"
        ? vec2.transformMat2d(vec2.create(), shot.grip, shot.gem.visual.renderWorldMatrix)
        : this.anchor?.point;
    const tipX = contact?.[0] ?? tipPose[4];
    const tipY = contact?.[1] ?? tipPose[5];
    ctx.translate(tipX - tipPose[4], tipY - tipPose[5]);
    const direction =
      shot.kind === "tether"
        ? vec2.subtract(vec2.create(), this.tip, this.receiver.pos)
        : shot.kind === "extending" || shot.kind === "retracting"
          ? shot.direction
          : vec2.negate(
              vec2.create(),
              shot.kind === "pulling" ? shot.hit.normal : shot.normal
            );
    const angle = Math.atan2(direction[1], direction[0]);
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
    drawGrappleHead(ctx, !!contact || shot.kind === "tether");
  }

  private drawBeam(ctx: CanvasRenderingContext2D, length: number) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(66,214,236,.18)";
    ctx.fillRect(0, -4, length, 8);
    // Keep the last partial sleeve at the anchor. The first sleeve disappears into the muzzle.
    const pitch = gun.segmentLength;
    const clipped =
      this.shot.kind === "pulling" || this.shot.kind === "reeling"
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

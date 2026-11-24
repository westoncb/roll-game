import { vec2, type ReadonlyVec2 } from "gl-matrix";
import type { TerrainHit } from "../engine/collision";
import { Drawable2D } from "../engine/drawable";
import {
  extensionAt,
  extensionSeconds,
  extensionTimeAt,
  punchImpact,
  tipVelocity
} from "./grapple-motion";
import { playerConfig } from "./config";
import { approach } from "../utils/math";
import type { FungalGem } from "../fungus/gem";
import type { Player } from "./player";

// The level identifies the first target; only a clingable hit supplies a movement anchor.
export type BeamHit =
  | ({ kind: "clingable" } & TerrainHit)
  | { kind: "gem"; point: vec2; normal: vec2; fraction: number; gem: FungalGem }
  | { kind: "robot"; point: vec2; normal: vec2; fraction: number; target: Player };
export type CastBeam = (
  from: vec2,
  direction: vec2,
  distance: number,
  robotMotion?: "swept"
) => BeamHit | { kind: "clear"; point: vec2 };
export type HoverTarget = Extract<BeamHit["kind"], "gem" | "robot">;

const gun = playerConfig.gun;
type Head = "claw" | "glove";
const nose: Record<Head, ReadonlyVec2> = { claw: [gun.headLength, 0], glove: [24, 0] };
type Shot =
  | { kind: "idle" }
  | {
      kind: "extending";
      head: Head;
      direction: vec2;
      mount: vec2;
      sweptReach: number;
      time: number;
    }
  | { kind: "pulling"; hit: TerrainHit; latchLength: number; lastDistance: number }
  | { kind: "reeling"; gem: FungalGem; grip: vec2; normal: vec2; latchLength: number }
  | { kind: "retracting"; head: Head; remaining: number; direction: vec2 };

export class PlayerGun {
  private shot: Shot = { kind: "idle" };
  private deploying = false;
  private readonly pivot: Drawable2D;
  private readonly muzzle: Drawable2D;
  private readonly tipNode: Drawable2D;
  private readonly tip = vec2.create();

  constructor(
    private readonly stance: Drawable2D,
    private readonly owner: Player,
    private readonly cast: CastBeam
  ) {
    this.tipNode = new Drawable2D((ctx) => this.drawGrapple(ctx), stance);
    this.pivot = new Drawable2D(undefined, stance);
    this.pivot.rotation = -Math.PI / 2;
    this.muzzle = new Drawable2D((ctx) => this.drawBarrel(ctx), this.pivot);
  }

  get phase() {
    return this.shot.kind;
  }
  get ready() {
    return this.phase === "idle";
  }
  get renderAngle() {
    const matrix = this.pivot.renderWorldMatrix;
    return Math.atan2(matrix[1], matrix[0]);
  }
  get anchor() {
    return this.shot.kind === "pulling" ? this.shot.hit : null;
  }

  threatens(target: Player) {
    if (this.owner.respawnRemaining) return false;
    const shot = this.shot;
    if (shot.kind !== "extending" || shot.head !== "glove") return false;
    const from = vec2.scaleAndAdd(
      vec2.create(),
      shot.mount,
      shot.direction,
      shot.sweptReach
    );
    if (vec2.distance(from, target.body.pos) > 480) return false;
    const first = this.cast(
      from,
      shot.direction,
      Math.min(480, gun.maxReach - shot.sweptReach)
    );
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

  private aimAt(target: ReadonlyVec2) {
    const mount = this.pivot.localToWorld([0, 0]);
    const direction = vec2.subtract(vec2.create(), target, mount);
    if (!vec2.squaredLength(direction)) return null;
    vec2.normalize(direction, direction);
    return { mount, direction, hit: this.cast(mount, direction, gun.maxReach) };
  }

  hoverTarget(point: vec2): HoverTarget | null {
    const hit = this.aimAt(point)?.hit;
    // The shot may pass through the cursor and hit something farther along the ray.
    if (hit?.kind === "gem" && hit.gem.cast(point, point)) return "gem";
    if (hit?.kind === "robot") {
      const { pos, radius } = hit.target.body;
      if (vec2.squaredDistance(point, pos) <= radius * radius) return "robot";
    }
    return null;
  }

  fireAt(target: ReadonlyVec2) {
    if (!this.ready) return;
    const aim = this.aimAt(target);
    if (!aim) return;
    const { mount, direction, hit } = aim;
    this.pivot.setOrientation(Math.atan2(direction[1], direction[0]));
    this.pivot.snapshotPose();
    this.deploying = true;
    const head = hit.kind === "robot" ? "glove" : "claw";
    this.muzzle.localToWorld(nose[head], this.tip);
    this.stance.worldToLocal(this.tip, this.tipNode.position);
    this.tipNode.snapshotPose();
    this.shot = {
      kind: "extending",
      head,
      direction,
      mount,
      sweptReach: 0,
      time: extensionTimeAt(vec2.distance(mount, this.tip))
    };
  }

  private retract(head: Head, direction: vec2) {
    const dock = this.muzzle.localToWorld(nose[head]);
    this.shot = {
      kind: "retracting",
      head,
      direction,
      remaining: vec2.distance(dock, this.tip)
    };
  }

  finish() {
    this.shot = { kind: "idle" };
  }

  onRespawn() {
    this.deploying = false;
    this.muzzle.position[0] = 0;
    this.pivot.setOrientation(-Math.PI / 2);
    if (this.shot.kind === "reeling") {
      this.shot.gem.receiverRespawned();
      this.stance.worldToLocal(this.tip, this.tipNode.position);
    } else this.finish();
  }

  update(dt: number) {
    const shot = this.shot;
    // Even a point-blank hit completes the outward stroke before the barrel stows.
    const reach = approach(
      this.muzzle.position[0],
      this.deploying || shot.kind !== "idle" ? gun.barrelLength : 0,
      gun.barrelSpeed * dt
    );
    this.muzzle.position[0] = reach;
    if (reach === gun.barrelLength) this.deploying = false;
    const head =
      shot.kind === "extending" || shot.kind === "retracting" ? shot.head : "claw";
    const dock = this.muzzle.localToWorld(nose[head]);
    if (shot.kind === "extending") {
      // Sweep the tip in world space, including movement of the gun mount.
      // On the first tick the sweep also covers the loaded barrel and head.
      const mount = this.pivot.localToWorld([0, 0]);
      const from = vec2.scaleAndAdd(
        vec2.create(),
        shot.mount,
        shot.direction,
        shot.sweptReach
      );
      shot.time = Math.min(extensionSeconds, shot.time + dt);
      const reach = extensionAt(shot.time);
      const end = vec2.scaleAndAdd(vec2.create(), mount, shot.direction, reach);
      const travel = vec2.subtract(vec2.create(), end, from);
      const distance = vec2.length(travel);
      const result = this.cast(from, vec2.normalize(travel, travel), distance, "swept");
      vec2.copy(this.tip, result.point);
      if (result.kind === "clear") {
        shot.sweptReach = reach;
        shot.mount = mount;
        if (shot.time >= extensionSeconds) this.retract(shot.head, shot.direction);
      } else if (
        shot.head === "claw" &&
        (result.kind === "clingable" || result.kind === "gem")
      ) {
        const socket = vec2.scaleAndAdd(
          vec2.create(),
          this.tip,
          result.normal,
          gun.headLength
        );
        const latchLength = vec2.distance(this.muzzle.localToWorld([0, 0]), socket);
        if (result.kind === "gem") {
          const grip = result.gem.visual.worldToLocal(result.point);
          result.gem.reelTo(this.owner, gun.reelSpeed);
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
            lastDistance: vec2.distance(this.owner.body.pos, this.tip)
          };
        }
      } else {
        if (shot.head === "glove" && result.kind === "robot") {
          const hitReach = shot.sweptReach + (reach - shot.sweptReach) * result.fraction;
          const mountVelocity = vec2.subtract(vec2.create(), mount, shot.mount);
          vec2.scale(mountVelocity, mountVelocity, 1 / dt);
          const velocity = tipVelocity(shot.direction, hitReach, mountVelocity);
          result.target.takePunch(
            result.point,
            punchImpact(velocity, result.normal, result.target.body.vel)
          );
        }
        this.retract(shot.head, shot.direction);
      }
    } else if (shot.kind === "pulling") {
      // Physics can slide the body along an existing contact without reporting a new hit.
      const distance = vec2.distance(this.owner.body.pos, this.tip);
      if (shot.lastDistance - distance < gun.minPullProgressSpeed * dt) this.finish();
      else shot.lastDistance = distance;
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
    if (this.ready) {
      ctx.translate(nose.claw[0], 0);
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
    const flying = shot.kind === "extending" || shot.kind === "retracting";
    const head = flying ? shot.head : "claw";
    const direction = flying
      ? shot.direction
      : vec2.negate(vec2.create(), shot.kind === "pulling" ? shot.hit.normal : shot.normal);
    const angle = Math.atan2(direction[1], direction[0]);
    const dx = this.muzzle.renderWorldMatrix[4] - tipX;
    const dy = this.muzzle.renderWorldMatrix[5] - tipY;
    const cableX = -nose[head][0] * Math.cos(angle) - dx;
    const cableY = -nose[head][0] * Math.sin(angle) - dy;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(Math.atan2(cableY, cableX));
    this.drawBeam(ctx, Math.hypot(cableX, cableY));
    ctx.restore();
    ctx.rotate(angle);
    if (head === "glove") drawBoxingGlove(ctx);
    else drawGrappleHead(ctx, !!contact);
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

function drawBoxingGlove(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#491c2a";
  ctx.fillStyle = "#de3f48";
  ctx.beginPath();
  ctx.moveTo(-18, -5);
  ctx.bezierCurveTo(-16, -12, -7, -13, -3, -9);
  ctx.bezierCurveTo(1, -6, 1, 2, -2, 5);
  ctx.quadraticCurveTo(-5, 8, -10, 7);
  ctx.bezierCurveTo(-12, 13, -19, 10, -18, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-15, 3);
  ctx.quadraticCurveTo(-10, 1, -10, 7);
  ctx.stroke();
  ctx.fillStyle = "#f6e0bb";
  ctx.beginPath();
  ctx.roundRect(-24, -6, 7, 13, 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#ff9b91";
  ctx.beginPath();
  ctx.moveTo(-13, -7);
  ctx.quadraticCurveTo(-9, -10, -5, -8);
  ctx.stroke();
}

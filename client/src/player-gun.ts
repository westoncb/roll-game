import { vec2, type ReadonlyVec2 } from "gl-matrix";
import type { TerrainHit } from "./collision";
import { Drawable2D } from "./drawable";
import { playerConfig } from "./player-config";
import { approach } from "./util";

// The level identifies the first target; only a clingable hit supplies a movement anchor.
export type BeamHit =
  | ({ kind: "clingable" } & TerrainHit)
  | { kind: "damageable"; point: vec2 };
export type CastBeam = (
  from: vec2,
  to: vec2
) => BeamHit | { kind: "miss"; point: vec2 } | null;

const gun = playerConfig.gun;
type Shot =
  | { kind: "idle" }
  | { kind: "aiming"; rightTurn: 1 | -1 }
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
    this.tipNode = new Drawable2D((ctx) => this.drawBeam(ctx), root);
    this.pivot = new Drawable2D(undefined, stance);
    this.muzzle = new Drawable2D((ctx) => this.drawBarrel(ctx), this.pivot);
  }

  get phase() {
    return this.shot.kind;
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
    this.shot = { kind: "aiming", rightTurn: direction[1] > 1e-6 ? -1 : 1 };
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
    this.muzzle.localToWorld([0, 0], this.tip);
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
    const muzzle = this.muzzle.localToWorld([0, 0]);
    if (shot.kind === "extending") {
      const travel = gun.extensionSpeed * dt;
      const end = vec2.scaleAndAdd(vec2.create(), this.tip, shot.direction, travel);
      // On release this includes the mount-to-muzzle segment.
      const result = cast(shot.castFrom, end);
      if (result) {
        vec2.copy(this.tip, result.point);
        const length = vec2.distance(muzzle, this.tip);
        this.shot =
          result.kind === "clingable"
            ? {
                kind: "pulling",
                hit: result,
                latchLength: length,
                lastDistance: vec2.distance(this.root.position, this.tip)
              }
            : { kind: "retracting", remaining: length };
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
      const distance = vec2.distance(this.tip, muzzle);
      shot.remaining = Math.max(
        0,
        Math.min(shot.remaining, distance) - gun.retractSpeed * dt
      );
      if (shot.remaining === 0) {
        vec2.copy(this.tip, muzzle);
        this.finish();
      } else vec2.lerp(this.tip, muzzle, this.tip, shot.remaining / distance);
    } else vec2.copy(this.tip, muzzle);
    this.root.worldToLocal(this.tip, this.tipNode.position);
  }

  private drawBarrel(ctx: CanvasRenderingContext2D) {
    const reach = this.muzzle.renderPosition[0];
    if (reach <= 0) return;
    ctx.fillRect(-reach, -4, reach, 8);
    ctx.lineWidth = playerConfig.leg.borderWidth;
    ctx.strokeRect(-reach, -4, reach, 8);
  }

  private drawBeam(ctx: CanvasRenderingContext2D) {
    if (this.shot.kind === "idle" || this.shot.kind === "aiming") return;
    // Draw in the tip's sampled frame. The player root translates in world axes.
    const dx = this.muzzle.renderWorldMatrix[4] - this.tipNode.renderWorldMatrix[4];
    const dy = this.muzzle.renderWorldMatrix[5] - this.tipNode.renderWorldMatrix[5];
    const length = Math.hypot(dx, dy);
    ctx.translate(dx, dy);
    ctx.rotate(Math.atan2(-dy, -dx));
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

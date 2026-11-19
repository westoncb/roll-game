import { vec2 } from "gl-matrix";
import { nearbyEdges } from "./collision";
import { Drawable2D } from "./drawable";
import type { Entity } from "./entity";
import {
  findFoothold,
  foldedFootScale,
  foldedHalfSole,
  footHeight,
  halfSole,
  padHalfWidth,
  plantedPose,
  poseFits,
  reachable,
  type FootAnchor,
  type LegStance,
  type Pose
} from "./foothold";
import type { GroundEdge, GroundPolygon } from "./ground";
import type { InputState } from "./input";
import { collectContacts, gravityAt, stepPhysics, PhysicsBody } from "./physics";
import {
  advanceAlongSurface,
  supportFromContact,
  surfaceNormal,
  surfacePose,
  type Support
} from "./walking";
import { angleDifference, approach, approachAngle, largestFit, lerp, tau } from "./util";

const legCount = 10;
const spacing = tau / legCount;
const maxLegAngle = spacing * 0.49;
const restLength = 23;
const maxReach = 43;
const chargedLegLength = 13;
const legExtensionSpeed = 175;
const footUnfoldSeconds = 0.12;
const shellFill = "#55585c";
const legFill = "#73767a";
const metalRim = "#94989c";
const footFill = "#d63d41";
const footRim = "#82272d";
// World units per second, with acceleration rates in units per second squared.
const topSpeed = 660;
const runAcceleration = 240;
const coastDeceleration = 175;
const brakeDeceleration = 850;
const tapJumpSpeed = 205;
const fullJumpSpeed = 750;
const fullChargeSeconds = 0.75;
const chargedSpeedScale = 0.02;
// Absolute horizontal component of the unit surface tangent.
const wallEnterX = 0.4;
const wallExitX = 0.65;
const minLandingSlide = 20;

type FootState = { kind: "free" } | { kind: "reaching" | "planted"; anchor: FootAnchor };
// Angles are in world coordinates. The leg index identifies its part of the rotating body.
type Leg = Pose & { foot: FootState; footScale: number; soleHalfWidth: number };

// While the ankle is rotating toward its target, retract as far as necessary
// to keep the visible foot on the accessible side of the terrain.
function clearSwing(center: vec2, leg: Leg, edges: GroundEdge[]) {
  const height = footHeight * leg.footScale;
  leg.length =
    largestFit(0, leg.length, (length) =>
      poseFits(center, { ...leg, length }, edges, height, leg.soleHalfWidth)
    ) ?? 0;
}

// Split the unwrapped clockwise span between successive planted legs into equal gaps.
function targetAngles(legs: Leg[], bodyAngle: number) {
  const angles = legs.map((_, i) => bodyAngle + i * spacing);
  const pins: number[] = [];
  for (const [i, leg] of legs.entries()) {
    if (leg.foot.kind === "planted") {
      angles[i] += angleDifference(angles[i], leg.angle);
      pins.push(i);
    }
  }
  for (let p = 0; p < pins.length; p++) {
    const first = pins[p],
      last = pins[(p + 1) % pins.length];
    const count = (last - first + legCount) % legCount || legCount;
    const span = angles[last] + (last <= first ? tau : 0) - angles[first];
    for (let j = 1; j < count; j++)
      angles[(first + j) % legCount] = angles[first] + (span * j) / count;
  }
  return angles;
}

export class Player implements Entity {
  readonly legs: Leg[] = Array.from({ length: legCount }, (_, i) => ({
    angle: i * spacing,
    length: restLength,
    footAngle: i * spacing,
    footScale: foldedFootScale,
    soleHalfWidth: foldedHalfSole,
    foot: { kind: "free" }
  }));
  support: Support | null = null;
  private moveInput = 0;
  // Signed path direction for Right on a wall; zero uses screen-space steering.
  private wallRight = 0;
  private jumpHeldSeconds: number | null = null;
  private launchCharge: number | null = null;
  private groundSpeed = 0;
  readonly visual = new Drawable2D();
  readonly body = new PhysicsBody(this.visual.position, 28);
  // The stance can crouch relative to the collider. Only the shell rolls.
  private readonly stance = new Drawable2D((ctx) => this.drawLegs(ctx), this.visual);
  private readonly ankles = this.legs.map(() => new Drawable2D(drawFoot, this.stance));
  private readonly shell = new Drawable2D(drawShell, this.stance);
  private readonly chargeIndicator = new Drawable2D(drawHexagon, this.shell);
  private displayedCharge?: number;

  constructor(start: vec2, ground: GroundPolygon[]) {
    vec2.copy(this.visual.position, start);
    this.setChargeColors(0);
    collectContacts(this.body, ground);
    this.land(ground);
    this.steerOnLanding();
    this.poseAnkles();
  }

  private poseAnkles() {
    for (const [i, leg] of this.legs.entries()) {
      const ankle = this.ankles[i];
      vec2.set(
        ankle.position,
        Math.cos(leg.angle) * leg.length,
        Math.sin(leg.angle) * leg.length
      );
      if (leg.foot.kind !== "planted") {
        vec2.add(ankle.position, ankle.position, this.shell.position);
      }
      ankle.setOrientation(leg.footAngle);
      vec2.set(ankle.scale, leg.footScale, leg.soleHalfWidth / halfSole);
    }
  }

  private get jumpCharge() {
    return Math.min(1, (this.jumpHeldSeconds ?? 0) / fullChargeSeconds);
  }

  private get strideScale() {
    return lerp(1, chargedSpeedScale, this.launchCharge ?? this.jumpCharge);
  }

  control(input: InputState, dt: number) {
    this.moveInput =
      Number(input.keysDown.has("ArrowRight")) - Number(input.keysDown.has("ArrowLeft"));
    const previousStride = this.strideScale;
    this.launchCharge = null;
    if (this.support) {
      for (const change of input.keyChanges) {
        if (change.code !== "Space") continue;
        if (change.type === "press") {
          this.jumpHeldSeconds = 0;
        } else if (this.jumpHeldSeconds !== null) {
          this.launchCharge = this.jumpCharge;
          this.jumpHeldSeconds = null;
          break;
        }
      }
    }
    if (!this.support || !input.keysDown.has("Space")) this.jumpHeldSeconds = null;
    else if (this.jumpHeldSeconds !== null) this.jumpHeldSeconds += dt;
    // Shortening a stride sheds the same fraction of the player's existing speed.
    const stride = this.strideScale;
    if (stride < previousStride) this.groundSpeed *= stride / previousStride;
    this.poseJumpCharge();
  }

  private poseJumpCharge() {
    const charge = this.jumpCharge;
    const time = this.jumpHeldSeconds ?? 0;
    this.setChargeColors(charge);
    // Free and reaching feet follow this offset until they plant.
    vec2.set(
      this.shell.position,
      2.5 * charge * Math.sin(tau * 11 * time),
      1.5 * charge * Math.sin(tau * 14 * time)
    );
  }

  private setChargeColors(charge: number) {
    if (charge === this.displayedCharge) return;
    this.displayedCharge = charge;
    const tint = (base: string, full: string) =>
      charge === 0 ? base : `color-mix(in srgb, ${base}, ${full} ${charge * 100}%)`;
    const rim = tint(metalRim, "#ffffff");
    this.stance.color = { fill: tint(legFill, "#e4e7e9"), stroke: rim };
    this.shell.color = { fill: tint(shellFill, "#c7cbd0"), stroke: rim };
    const footColors = {
      fill: tint(footFill, "#ff8889"),
      stroke: tint(footRim, "#db5159")
    };
    for (const ankle of this.ankles) ankle.color = footColors;
    this.chargeIndicator.color = `rgb(${Math.round(255 * charge)} 0 0)`;
  }

  move(ground: GroundPolygon[], dt: number) {
    const body = this.body;
    if (this.support) {
      const normal = surfaceNormal(this.support, body.radius);
      const tangentX = -normal[1];
      const drive = this.moveInput * (this.wallRight || tangentX);
      const reversing = drive * this.groundSpeed < 0;
      const stride = this.strideScale;
      const targetSpeed = reversing ? 0 : drive * topSpeed * stride;
      const rate = reversing
        ? brakeDeceleration
        : drive
          ? runAcceleration
          : coastDeceleration;
      this.groundSpeed = approach(this.groundSpeed, targetSpeed, rate * stride * dt);
      if (this.launchCharge === null) {
        const { support, travel, retainedSpeed } = advanceAlongSurface(
          this.support,
          this.groundSpeed * dt,
          body.radius,
          ground
        );
        this.support = support;
        const { pos, normal } = surfacePose(support, body.radius);
        const nextTangentX = -normal[1];
        if (!this.wallRight && Math.abs(nextTangentX) <= wallEnterX) {
          this.wallRight = Math.sign(tangentX);
        } else if (this.wallRight && Math.abs(nextTangentX) >= wallExitX) {
          this.wallRight = 0;
        }
        vec2.copy(body.pos, pos);
        this.groundSpeed *= retainedSpeed;
        vec2.set(body.vel, -normal[1] * this.groundSpeed, normal[0] * this.groundSpeed);
        vec2.zero(body.accel);
        this.shell.rotation += travel / body.radius;
        collectContacts(body, ground);
        return;
      }
      vec2.set(body.vel, -normal[1] * this.groundSpeed, normal[0] * this.groundSpeed);
      const launchSpeed = lerp(tapJumpSpeed, fullJumpSpeed, this.launchCharge);
      vec2.scaleAndAdd(body.vel, body.vel, normal, launchSpeed);
      this.support = null;
    }
    this.shell.rotation += (this.groundSpeed * dt) / body.radius;
    vec2.copy(body.accel, gravityAt(body, ground));
    stepPhysics(body, ground, dt);
    this.land(ground);
    this.steerOnLanding();
  }

  private steerOnLanding() {
    if (!this.support) return;
    const normal = surfaceNormal(this.support, this.body.radius);
    this.groundSpeed = -normal[1] * this.body.vel[0] + normal[0] * this.body.vel[1];
    this.wallRight = 0;
    if (Math.abs(normal[1]) > wallEnterX) return;
    // For a sliding landing the held key continues the slide. With no key
    // held, assign that motion to the key pointing into the wall.
    const approachKey = this.moveInput || -Math.sign(normal[0]);
    this.wallRight =
      Math.abs(this.groundSpeed) > minLandingSlide
        ? approachKey * Math.sign(this.groundSpeed)
        : 1; // With clockwise boundaries this makes the key into the wall climb.
  }

  private land(ground: GroundPolygon[]) {
    // Re-query after each correction: one concave polygon can supply multiple faces.
    for (let i = 0; i < 6; i++) {
      const contacts = this.body.contacts;
      if (!contacts.length) return;
      const hit = contacts.reduce((deepest, contact) =>
        contact.depth > deepest.depth ? contact : deepest
      );
      if (vec2.dot(this.body.vel, hit.normal) <= 0)
        this.support = supportFromContact(hit, this.body.radius);
      if (hit.depth < 0.0001) return;
      vec2.scaleAndAdd(this.body.pos, this.body.pos, hit.normal, hit.depth);
      const inward = Math.min(0, vec2.dot(this.body.vel, hit.normal));
      vec2.scaleAndAdd(this.body.vel, this.body.vel, hit.normal, -inward);
      collectContacts(this.body, ground);
    }
  }

  afterPhysics(dt: number, ground: GroundPolygon[]) {
    const stance = this.updateStance(dt);
    this.updateFeet(dt, ground, stance);
    this.poseAnkles();
  }

  private updateStance(dt: number): LegStance {
    const depth = (restLength - chargedLegLength) * this.jumpCharge;
    const normal =
      depth > 0 && this.support ? surfaceNormal(this.support, this.body.radius) : [0, 0];
    const offset = this.stance.position;
    const step = legExtensionSpeed * dt;
    vec2.set(
      offset,
      approach(offset[0], -normal[0] * depth, step),
      approach(offset[1], -normal[1] * depth, step)
    );
    const length = restLength - vec2.length(offset);
    const scale = length / restLength;
    return {
      center: vec2.add(vec2.create(), this.body.pos, offset),
      restLength: length,
      minReach: 14 * scale,
      maxReach: maxReach * scale
    };
  }

  private updateFeet(dt: number, ground: GroundPolygon[], stance: LegStance) {
    const speed = Math.abs(this.groundSpeed);
    const rollRate = speed / this.body.radius;
    // Faster steps leave less time to open the foot before its anchor passes.
    const scaleStep =
      (1 - foldedFootScale) * (1 / footUnfoldSeconds + rollRate / spacing) * dt;
    const shake = this.shell.position;
    const swingCenter = vec2.add(vec2.create(), stance.center, shake);
    const edges = nearbyEdges(
      stance.center,
      stance.maxReach + footHeight + halfSole + vec2.length(shake),
      ground
    );
    const contacts = this.legs.map((leg, i) => {
      const restAngle = this.shell.rotation + i * spacing;
      if (
        this.support &&
        leg.foot.kind !== "free" &&
        reachable(stance, leg.foot.anchor, restAngle, maxLegAngle, edges)
      ) {
        if (leg.foot.kind === "planted")
          Object.assign(leg, plantedPose(stance.center, leg.foot.anchor));
        return leg.foot.anchor;
      }
      const anchor = this.support
        ? findFoothold(stance, restAngle, maxLegAngle, this.body.radius, edges)
        : null;
      leg.foot = anchor ? { kind: "reaching", anchor } : { kind: "free" };
      return anchor;
    });
    const targets = targetAngles(this.legs, this.shell.rotation);
    for (const [i, leg] of this.legs.entries()) {
      const anchor = contacts[i];
      const room = anchor ? padHalfWidth(anchor, contacts) : halfSole;
      leg.soleHalfWidth = Math.min(
        room,
        approach(leg.soleHalfWidth, anchor ? room : foldedHalfSole, halfSole * scaleStep)
      );
      if (leg.foot.kind === "planted") continue;
      leg.footScale = approach(leg.footScale, anchor ? 1 : foldedFootScale, scaleStep);
      const target =
        leg.foot.kind === "reaching"
          ? plantedPose(stance.center, leg.foot.anchor)
          : { angle: targets[i], length: stance.restLength, footAngle: targets[i] };
      leg.angle = approachAngle(leg.angle, target.angle, (14 + rollRate) * dt);
      leg.length = approach(leg.length, target.length, (legExtensionSpeed + speed) * dt);
      leg.footAngle = approachAngle(leg.footAngle, target.footAngle, (15 + rollRate) * dt);
      if (
        leg.foot.kind === "reaching" &&
        leg.footScale === 1 &&
        Math.abs(angleDifference(leg.angle, target.angle)) < 0.0001 &&
        Math.abs(leg.length - target.length) < 0.0001 &&
        Math.abs(angleDifference(leg.footAngle, target.footAngle)) < 0.0001
      ) {
        leg.foot = { kind: "planted", anchor: leg.foot.anchor };
      } else {
        clearSwing(swingCenter, leg, edges);
      }
    }
  }

  private drawLegs(ctx: CanvasRenderingContext2D) {
    const [x, y] = this.shell.renderPosition;
    ctx.beginPath();
    for (const ankle of this.ankles) {
      ctx.moveTo(x, y);
      ctx.lineTo(ankle.renderPosition[0], ankle.renderPosition[1]);
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 2.25;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  }
}

function drawFoot(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(footHeight, -halfSole);
  ctx.lineTo(footHeight, halfSole);
  ctx.closePath();
  ctx.fill();
  // Keep the border inside the same triangle used to place the sole on terrain.
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawShell(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.roundRect(-10.5, -10.5, 21, 21, 1.5);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHexagon(ctx: CanvasRenderingContext2D) {
  const radius = 7;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  for (let i = 1; i < 6; i++) {
    const angle = (i * tau) / 6;
    ctx.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fill();
}

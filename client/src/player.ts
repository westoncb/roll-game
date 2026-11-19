import { vec2 } from "gl-matrix";
import { nearbyEdges } from "./collision";
import { Drawable2D } from "./drawable";
import type { Entity } from "./entity";
import {
  fitCrouchGrips,
  planFootholds,
  plantedPose,
  poseFits,
  type FootAnchor,
  type GripRequest,
  type LegStance,
  type Pose
} from "./foothold";
import type { GroundEdge, GroundPolygon } from "./ground";
import type { InputState } from "./input";
import { collectContacts, gravityAt, stepPhysics, PhysicsBody } from "./physics";
import {
  halfSole,
  legSpacing,
  maxLegReach,
  playerConfig,
  restLegLength,
  rollRadius,
  shellRadius
} from "./player-config";
import {
  advanceAlongSurface,
  supportFromContact,
  surfaceNormal,
  surfacePose,
  type Support
} from "./walking";
import { angleDifference, approach, approachAngle, largestFit, lerp, tau } from "./util";

const { leg: legConfig, foot, shell, hexagon, movement, jump, colors } = playerConfig;
// A critically damped step from rest has 5% error at rate × time ≈ 4.744.
const spacingSpringRate = 4.744 / legConfig.spacingSettleSeconds;

type FreeFoot = { kind: "free"; offset: number; angularVelocity: number };
type FootState =
  | FreeFoot
  | { kind: "reaching"; anchor: FootAnchor }
  | { kind: "planted"; anchor: FootAnchor; plantedOffset: number };
type FootStep = { from: FootAnchor; remaining: number };
// Angles are in world coordinates. The leg index identifies its part of the rotating body.
type Leg = Pose & {
  foot: FootState;
  step: FootStep | null;
  footScale: number;
};

function stepPose(from: Pose, to: Pose, progress: number, lift: number): Pose {
  const blend = progress * progress * (3 - 2 * progress);
  return {
    angle: from.angle + angleDifference(from.angle, to.angle) * blend,
    length: Math.max(shellRadius, lerp(from.length, to.length, blend) - lift),
    footAngle: from.footAngle + angleDifference(from.footAngle, to.footAngle) * blend
  };
}

// While the ankle is rotating toward its target, retract as far as necessary
// to keep the visible foot on the accessible side of the terrain.
function clearSwing(center: vec2, leg: Leg, edges: GroundEdge[]) {
  const height = foot.height * leg.footScale;
  leg.length =
    largestFit(0, leg.length, (length) =>
      poseFits(center, { ...leg, length }, edges, height, halfSole * leg.footScale)
    ) ?? 0;
}

// Even spacing between two pins means interpolating their offsets from the shell's spokes.
function spacingOffsets(legs: Leg[], bodyAngle: number) {
  const legCount = legs.length;
  const offsets: number[] = Array(legCount).fill(0);
  const pins: number[] = [];
  for (const [i, leg] of legs.entries()) {
    if (leg.foot.kind === "planted") {
      offsets[i] = angleDifference(bodyAngle + i * legSpacing, leg.angle);
      pins.push(i);
    }
  }
  for (let p = 0; p < pins.length; p++) {
    const first = pins[p],
      last = pins[(p + 1) % pins.length];
    const count = (last - first + legCount) % legCount || legCount;
    for (let j = 1; j < count; j++)
      offsets[(first + j) % legCount] = lerp(offsets[first], offsets[last], j / count);
  }
  return offsets;
}

function settleSpacing(foot: FreeFoot, target: number, dt: number) {
  const error = foot.offset - target;
  const decay = Math.exp(-spacingSpringRate * dt);
  const travel = (foot.angularVelocity + spacingSpringRate * error) * dt;
  foot.offset = target + (error + travel) * decay;
  foot.angularVelocity = (foot.angularVelocity - spacingSpringRate * travel) * decay;
  return foot.offset;
}

export class Player implements Entity {
  readonly legs: Leg[] = Array.from({ length: legConfig.count }, (_, i) => ({
    angle: i * legSpacing,
    length: restLegLength,
    footAngle: i * legSpacing,
    footScale: foot.foldedScale,
    step: null,
    foot: { kind: "free", offset: 0, angularVelocity: 0 }
  }));
  support: Support | null = null;
  private moveInput = 0;
  // Signed path direction for Right on a wall; zero uses screen-space steering.
  private wallRight = 0;
  private jumpHeldSeconds: number | null = null;
  private launchCharge: number | null = null;
  private groundSpeed = 0;
  readonly visual = new Drawable2D();
  readonly body = new PhysicsBody(this.visual.position, rollRadius);
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
      vec2.set(ankle.scale, leg.footScale, leg.footScale);
    }
  }

  private jumpCharge() {
    return this.jumpHeldSeconds === null
      ? 0
      : Math.min(1, this.jumpHeldSeconds / jump.fullChargeSeconds);
  }

  private get strideScale() {
    return lerp(1, jump.chargedSpeedScale, this.launchCharge ?? this.jumpCharge());
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
          this.launchCharge = this.jumpCharge();
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
    const charge = this.jumpCharge();
    const time = this.jumpHeldSeconds ?? 0;
    this.setChargeColors(charge);
    // Free and reaching feet follow this offset until they plant.
    vec2.set(
      this.shell.position,
      jump.shakeAmplitudeX * charge * Math.sin(tau * jump.shakeHzX * time),
      jump.shakeAmplitudeY * charge * Math.sin(tau * jump.shakeHzY * time)
    );
  }

  private setChargeColors(charge: number) {
    if (charge === this.displayedCharge) return;
    this.displayedCharge = charge;
    const tint = ([base, full]: readonly [string, string]) =>
      charge === 0 ? base : `color-mix(in srgb, ${base}, ${full} ${charge * 100}%)`;
    const rim = tint(colors.metalBorder);
    this.stance.color = { fill: tint(colors.legFill), stroke: rim };
    this.shell.color = { fill: tint(colors.shellFill), stroke: rim };
    const footColors = { fill: tint(colors.footFill), stroke: tint(colors.footBorder) };
    for (const ankle of this.ankles) ankle.color = footColors;
    this.chargeIndicator.color = {
      fill: tint(colors.hexagonFill),
      stroke: tint(colors.hexagonBorder)
    };
  }

  move(ground: GroundPolygon[], dt: number) {
    const body = this.body;
    if (this.support) {
      const normal = surfaceNormal(this.support, body.radius);
      const tangentX = -normal[1];
      const drive = this.moveInput * (this.wallRight || tangentX);
      const reversing = drive * this.groundSpeed < 0;
      const stride = this.strideScale;
      const targetSpeed = reversing ? 0 : drive * movement.topSpeed * stride;
      const rate = reversing
        ? movement.brakeDeceleration
        : drive
          ? movement.runAcceleration
          : movement.coastDeceleration;
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
        if (!this.wallRight && Math.abs(nextTangentX) <= movement.wallEnterX) {
          this.wallRight = Math.sign(tangentX);
        } else if (this.wallRight && Math.abs(nextTangentX) >= movement.wallExitX) {
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
      const launchSpeed = lerp(jump.tapSpeed, jump.fullSpeed, this.launchCharge);
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
    if (Math.abs(normal[1]) > movement.wallEnterX) return;
    // For a sliding landing the held key continues the slide. With no key
    // held, assign that motion to the key pointing into the wall.
    const approachKey = this.moveInput || -Math.sign(normal[0]);
    this.wallRight =
      Math.abs(this.groundSpeed) > movement.minLandingSlide
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
    this.updateFeet(dt, ground);
    this.poseAnkles();
  }

  private updateCrouch(dt: number, legs: GripRequest[], edges: GroundEdge[]) {
    const charge = this.jumpCharge();
    const depth = (legConfig.restExtension - legConfig.chargedExtension) * charge;
    const normal =
      depth > 0 && this.support ? surfaceNormal(this.support, this.body.radius) : [0, 0];
    const offset = this.stance.position;
    const step = legConfig.extensionSpeed * dt;
    const target = vec2.fromValues(
      approach(offset[0], -normal[0] * depth, step),
      approach(offset[1], -normal[1] * depth, step)
    );
    if (charge === 0) {
      vec2.copy(offset, target);
      return [];
    }
    const probe = vec2.create();
    const { fraction, held } = fitCrouchGrips(edges, legs, (t) =>
      this.stanceAt(vec2.lerp(probe, offset, target, t))
    );
    vec2.lerp(offset, offset, target, fraction);
    return held;
  }

  private stanceAt(offset: vec2, secondsAhead = 0): LegStance {
    const center = vec2.add(vec2.create(), this.body.pos, offset);
    vec2.scaleAndAdd(center, center, this.body.vel, secondsAhead);
    const extension = legConfig.restExtension - vec2.length(offset);
    return {
      center,
      restLength: shellRadius + extension,
      landingReach:
        shellRadius + legConfig.maxExtension * (extension / legConfig.restExtension)
    };
  }

  private placeFeet(edges: GroundEdge[], gripSeconds: number, dt: number) {
    const rollRate = this.groundSpeed / this.body.radius;
    const legs = this.support
      ? this.legs.map((leg, i) => ({
          leg,
          angle: this.shell.rotation + i * legSpacing,
          grip:
            leg.foot.kind === "planted"
              ? { ...leg.foot, travel: foot.slideSpeed * dt }
              : undefined
        }))
      : [];
    const held = this.updateCrouch(dt, legs, edges);
    const offset = this.stance.position;
    const stance = this.stanceAt(offset);
    // Predict travel at the crouch the grips permit. Future grips may limit further contraction.
    const requests = legs.map(({ leg, angle, grip }) => {
      const stepTime = grip ? foot.stepSeconds : (leg.step?.remaining ?? 0);
      const touchdown = Math.max(0, stepTime - dt);
      const holdTime = touchdown + gripSeconds;
      return {
        current: { stance, angle },
        landing: {
          stance: touchdown ? this.stanceAt(offset, touchdown) : stance,
          angle: angle + rollRate * touchdown
        },
        hold: {
          stance: this.stanceAt(offset, holdTime),
          angle: angle + rollRate * holdTime
        },
        previous: leg.foot.kind === "reaching" ? leg.foot.anchor : undefined,
        grip
      };
    });
    const plan = planFootholds(edges, requests, held);
    for (const [i, leg] of this.legs.entries()) {
      const contact = plan[i];
      if (leg.foot.kind === "planted") {
        if (contact?.gripping) {
          leg.foot.anchor = contact.anchor;
          Object.assign(leg, plantedPose(stance.center, contact.anchor));
          continue;
        }
        if (this.support) leg.step = { from: leg.foot.anchor, remaining: foot.stepSeconds };
      }
      if (leg.step) {
        leg.step.remaining -= dt;
        if (!this.support || leg.step.remaining <= 0) leg.step = null;
      }
      if (contact) leg.foot = { kind: "reaching", anchor: contact.anchor };
      else if (leg.foot.kind !== "free") {
        const angle = this.shell.rotation + i * legSpacing;
        leg.foot = {
          kind: "free",
          offset: angleDifference(angle, leg.angle),
          angularVelocity: 0
        };
      }
    }
    return stance;
  }

  private updateFeet(dt: number, ground: GroundPolygon[]) {
    const speed = Math.abs(this.groundSpeed);
    const rollRate = speed / this.body.radius;
    // Faster steps leave less time to open the foot before its anchor passes.
    const scaleStep =
      (1 - foot.foldedScale) * (1 / foot.unfoldSeconds + rollRate / legSpacing) * dt;
    const shake = this.shell.position;
    // Look one step beyond touchdown, or a fraction of a stride at higher speeds.
    const gripAngle = legSpacing * foot.gripCheckSpacingFraction;
    const gripSeconds =
      rollRate > 0 ? Math.min(foot.stepSeconds, gripAngle / rollRate) : foot.stepSeconds;
    const searchReach = maxLegReach + foot.height + halfSole + vec2.length(shake);
    const edges = nearbyEdges(
      this.body.pos,
      searchReach + speed * (foot.stepSeconds + gripSeconds),
      ground
    );
    const stance = this.placeFeet(edges, gripSeconds, dt);
    const swingCenter = vec2.add(vec2.create(), stance.center, shake);
    const offsets = spacingOffsets(this.legs, this.shell.rotation);
    for (const [i, leg] of this.legs.entries()) {
      if (leg.foot.kind === "planted") continue;
      const step = leg.step;
      const progress = step ? 1 - step.remaining / foot.stepSeconds : 1;
      const lift = step ? Math.sin(Math.PI * progress) : 0;
      const scale =
        leg.foot.kind === "reaching" ? lerp(1, foot.foldedScale, lift) : foot.foldedScale;
      leg.footScale = approach(leg.footScale, scale, scaleStep);
      let target: Pose;
      if (leg.foot.kind === "free") {
        const offset = settleSpacing(leg.foot, offsets[i], dt);
        const angle = this.shell.rotation + i * legSpacing + offset;
        target = { angle, length: stance.restLength, footAngle: angle };
      } else {
        target = plantedPose(stance.center, leg.foot.anchor);
      }
      if (step) {
        target = stepPose(
          plantedPose(swingCenter, step.from),
          target,
          progress,
          foot.stepHeight * lift
        );
        target.length = Math.min(target.length, stance.landingReach);
      }
      leg.angle =
        leg.foot.kind === "free"
          ? target.angle
          : approachAngle(leg.angle, target.angle, (legConfig.swingSpeed + rollRate) * dt);
      leg.length = approach(
        leg.length,
        target.length,
        (legConfig.extensionSpeed + speed) * dt
      );
      leg.footAngle = approachAngle(
        leg.footAngle,
        target.footAngle,
        (foot.turnSpeed + rollRate) * dt
      );
      if (
        leg.foot.kind === "reaching" &&
        !leg.step &&
        leg.footScale === 1 &&
        Math.abs(angleDifference(leg.angle, target.angle)) < 0.0001 &&
        Math.abs(leg.length - target.length) < 0.0001 &&
        Math.abs(angleDifference(leg.footAngle, target.footAngle)) < 0.0001
      ) {
        const { anchor } = leg.foot;
        leg.foot = { kind: "planted", anchor, plantedOffset: anchor.offset };
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
    ctx.lineWidth = legConfig.width;
    ctx.stroke();
    ctx.lineWidth = legConfig.width - 2 * legConfig.borderWidth;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  }
}

function drawFoot(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(foot.height, -halfSole);
  ctx.lineTo(foot.height, halfSole);
  ctx.closePath();
  ctx.fill();
  // Keep the border inside the same triangle used to place the sole on terrain.
  ctx.clip();
  ctx.lineWidth = 2 * foot.borderWidth;
  ctx.stroke();
}

function drawShell(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.roundRect(
    -shell.size / 2,
    -shell.size / 2,
    shell.size,
    shell.size,
    shell.cornerRadius
  );
  ctx.fill();
  ctx.lineWidth = shell.borderWidth;
  ctx.stroke();
}

function drawHexagon(ctx: CanvasRenderingContext2D) {
  const { radius } = hexagon;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  for (let i = 1; i < 6; i++) {
    const angle = (i * tau) / 6;
    ctx.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = hexagon.borderWidth;
  ctx.stroke();
}

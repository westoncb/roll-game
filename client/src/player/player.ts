import { vec2 } from "gl-matrix";
import { gameAssets } from "../assets";
import { nearbyEdges } from "../engine/collision";
import { fill, stroke } from "../engine/draw-routines";
import { Drawable2D } from "../engine/drawable";
import { ShapeStyle, type StyledShape } from "../engine/shape";
import type { Entity } from "../engine/entity";
import {
  fitCrouchGrips,
  planFootholds,
  plantedPose,
  poseFits,
  soleAt,
  type FootAnchor,
  type GripRequest,
  type LegStance,
  type Pose
} from "./foothold";
import type { GroundEdge, GroundPolygon } from "../engine/ground";
import type { InputState } from "../engine/input";
import { PlayerScreen } from "./screen";
import { PlayerGun, type CastBeam } from "./gun";
import type { EffectPlayer } from "../engine/particles/system";
import {
  collectContacts,
  gravityAt,
  moveAtVelocity,
  stepPhysics,
  PhysicsBody
} from "../engine/physics";
import {
  halfSole,
  legSpacing,
  maxLegReach,
  playerConfig,
  restLegLength,
  rollRadius,
  shellRadius
} from "./config";
import {
  advanceAlongSurface,
  steerAlongSurface,
  supportFromContact,
  supportOnEdge,
  surfaceNormal,
  surfacePose,
  type Support
} from "./walking";
import {
  angleDifference,
  approach,
  approachAngle,
  largestFit,
  lerp,
  tau
} from "../engine/math";

const { leg: legConfig, foot, shell, movement, jump, colors } = playerConfig;
const shellShape: StyledShape = {
  shape: {
    kind: "rect",
    x: -shell.size / 2,
    y: -shell.size / 2,
    width: shell.size,
    height: shell.size,
    cornerRadius: shell.cornerRadius
  },
  style: new ShapeStyle([fill(), stroke({ width: shell.borderWidth })])
};
// A critically damped step from rest has 5% error at rate × time ≈ 4.744.
const spacingSpringRate = 4.744 / legConfig.spacingSettleSeconds;

type FreeFoot = { kind: "free"; offset: number; angularVelocity: number };
type FootState =
  | FreeFoot
  | { kind: "reaching"; anchor: FootAnchor; landingVelocity?: vec2 }
  | { kind: "planted"; anchor: FootAnchor; plantedOffset: number };
type FootStep = { from: FootAnchor; remaining: number };
// Angles are in world coordinates. The leg index identifies its part of the rotating body.
type Leg = Pose & {
  foot: FootState;
  step: FootStep | null;
  footScale: number;
};

// Place a tucked ankle on the rim of the square shell along its own spoke.
function tuckedLegLength(shellAngle: number) {
  const side = Math.max(Math.abs(Math.cos(shellAngle)), Math.abs(Math.sin(shellAngle)));
  return (shell.size + shell.borderWidth) / (2 * side);
}

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
  private readonly moveInput = vec2.create();
  // Signed path direction for Right on a wall; zero uses screen-space steering.
  private wallRight = 0;
  private jumpHeldSeconds: number | null = null;
  private launchCharge: number | null = null;
  private readonly lastJumpDirection = vec2.fromValues(0, -1);
  private landingVelocity?: vec2;
  private groundSpeed = 0;
  private coastingFromCorner = false;
  readonly visual = new Drawable2D();
  readonly body = new PhysicsBody(this.visual.position, rollRadius);
  // The stance can crouch relative to the collider. Only the shell rolls.
  private readonly stance = new Drawable2D((ctx) => this.drawLegs(ctx), this.visual);
  private readonly ankles = this.legs.map(() => new Drawable2D(drawFoot, this.stance));
  private readonly joints = this.ankles.map(
    (ankle) => new Drawable2D(drawAnkleJoint, ankle)
  );
  private readonly gun = new PlayerGun(this.visual, this.stance);
  private readonly shell = new Drawable2D(shellShape, this.stance);
  private readonly screen = new PlayerScreen(this.shell, this.gun);
  private displayedCharge?: number;

  constructor(
    start: vec2,
    ground: GroundPolygon[],
    private readonly particles: EffectPlayer,
    private readonly castBeam: CastBeam
  ) {
    vec2.copy(this.visual.position, start);
    this.setChargeColors(0);
    collectContacts(this.body, ground);
    this.land(ground);
    this.steerOnLanding();
    this.poseAnkles();
    this.updateScreen(0);
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

  private plantedNormal() {
    const normals: vec2[] = [];
    const sum = vec2.create();
    for (const { foot } of this.legs) {
      if (foot.kind !== "planted") continue;
      const normal = foot.anchor.edge.normal;
      // Each direction contributes once, even if several feet or edges share it.
      if (normals.some((other) => vec2.equals(other, normal))) continue;
      normals.push(normal);
      vec2.add(sum, sum, normal);
    }
    return vec2.length(sum) > 0.0001 ? vec2.normalize(sum, sum) : null;
  }

  private pushOffDirection(support: Support) {
    return this.plantedNormal() ?? surfaceNormal(support, this.body.radius);
  }

  private get strideScale() {
    return lerp(1, jump.chargedSpeedScale, this.launchCharge ?? this.jumpCharge());
  }

  control(input: InputState, dt: number) {
    vec2.set(
      this.moveInput,
      Number(input.keysDown.has("ArrowRight")) - Number(input.keysDown.has("ArrowLeft")),
      Number(input.keysDown.has("ArrowDown")) - Number(input.keysDown.has("ArrowUp"))
    );
    const previousStride = this.strideScale;
    this.launchCharge = null;
    for (const change of input.keyChanges) {
      if (change.code === "KeyF") {
        if (change.type === "release") this.gun.fire();
        else if (this.jumpHeldSeconds === null && this.launchCharge === null)
          this.gun.beginAim(
            this.support ? this.pushOffDirection(this.support) : this.lastJumpDirection
          );
      } else if (change.code === "Space" && this.support && this.gun.phase === "idle") {
        if (change.type === "press") this.jumpHeldSeconds = 0;
        else if (this.jumpHeldSeconds !== null) {
          this.launchCharge = this.jumpCharge();
          this.jumpHeldSeconds = null;
        }
      }
    }
    if (this.gun.phase === "aiming") {
      // Blur clears held keys without issuing a fire command.
      if (!input.keysDown.has("KeyF")) this.gun.finish();
      else {
        this.gun.aim(this.moveInput[0], dt);
        vec2.zero(this.moveInput);
      }
    }
    if (!this.support || !input.keysDown.has("Space")) this.jumpHeldSeconds = null;
    else if (this.jumpHeldSeconds !== null) this.jumpHeldSeconds += dt;
    // Shortening a stride sheds the same fraction of the player's existing speed.
    const stride = this.strideScale;
    if (stride < previousStride) this.groundSpeed *= stride / previousStride;
    this.poseChargeVisuals(this.jumpCharge(), this.jumpHeldSeconds ?? 0);
  }

  private poseChargeVisuals(charge: number, time: number) {
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
    for (const joint of this.joints) joint.color = this.shell.color;
    this.screen.color = {
      fill: charge > 0 ? tint(colors.screenChargeFill) : colors.screenIdleFill,
      stroke: tint(colors.screenBorder)
    };
  }

  move(ground: GroundPolygon[], dt: number) {
    const body = this.body;
    const pull = this.gun.pullVelocity(body.pos, body.radius);
    if (this.support && !pull) {
      const normal = surfaceNormal(this.support, body.radius);
      const tangentX = -normal[1];
      let drive = this.moveInput[0] * (this.wallRight || tangentX);
      if (this.moveInput[1]) {
        const steering = steerAlongSurface(
          this.support,
          this.moveInput,
          body.pos,
          body.radius,
          ground,
          this.groundSpeed === 0 && this.launchCharge === null
        );
        this.support = steering.support;
        drive = Math.max(-1, Math.min(1, steering.drive));
      }
      const reversing = drive * this.groundSpeed < 0;
      const stride = this.strideScale;
      const targetSpeed = reversing ? 0 : drive * movement.topSpeed * stride;
      const rate =
        reversing || this.gun.phase === "aiming"
          ? movement.brakeDeceleration
          : drive
            ? movement.runAcceleration
            : movement.coastDeceleration;
      this.groundSpeed = approach(this.groundSpeed, targetSpeed, rate * stride * dt);
      if (this.launchCharge === null) {
        const { support, travel, retainedSpeed, airTime } = advanceAlongSurface(
          this.support,
          this.groundSpeed,
          dt,
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
        this.shell.rotation += travel / body.radius;
        if (!airTime) {
          vec2.zero(body.accel);
          collectContacts(body, ground);
          return;
        }
        this.coastingFromCorner = true;
        dt = airTime;
      } else {
        vec2.set(body.vel, -normal[1] * this.groundSpeed, normal[0] * this.groundSpeed);
        const launchSpeed = lerp(jump.tapSpeed, jump.fullSpeed, this.launchCharge);
        // Push back along the crouch the grips actually allowed. A tap can have no pose yet.
        const offset = this.stance.position;
        const depth = vec2.length(offset);
        const direction =
          this.launchCharge > 0 && depth > 0.0001
            ? vec2.scale(vec2.create(), offset, -1 / depth)
            : this.pushOffDirection(this.support);
        vec2.scaleAndAdd(body.vel, body.vel, direction, launchSpeed);
        vec2.copy(this.lastJumpDirection, direction);
      }
      this.support = null;
    }
    this.shell.rotation += (this.groundSpeed * dt) / body.radius;
    if (pull) {
      this.coastingFromCorner = false;
      vec2.copy(body.vel, pull);
      vec2.zero(body.accel);
    } else vec2.copy(body.accel, gravityAt(body, ground));
    const from = this.support;
    // Sweep along the departure tangent before gravity bends the flight. Applying
    // gravity first would aim the initial sweep straight back into the lip.
    const hit = this.coastingFromCorner
      ? moveAtVelocity(body, ground, dt)
      : stepPhysics(body, ground, dt, from && surfaceNormal(from, body.radius));
    if (this.coastingFromCorner)
      vec2.scaleAndAdd(body.vel, body.vel, body.accel, dt * (hit?.fraction ?? 1));
    this.support = from && supportOnEdge(body.pos, body.radius, from.edge);
    this.land(ground);
    if (this.support) this.coastingFromCorner = false;
    this.steerOnLanding();
    if (pull && this.support && (hit || !from)) this.gun.finish();
  }

  private steerOnLanding() {
    if (!this.support) return;
    const normal = surfaceNormal(this.support, this.body.radius);
    this.groundSpeed = -normal[1] * this.body.vel[0] + normal[0] * this.body.vel[1];
    this.wallRight = 0;
    if (Math.abs(normal[1]) > movement.wallEnterX) return;
    // For a sliding landing the held key continues the slide. With no key
    // held, assign that motion to the key pointing into the wall.
    const approachKey = this.moveInput[0] || -Math.sign(normal[0]);
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
        contact.depth > deepest.depth + 0.0001 ? contact : deepest
      );
      const normalSpeed = vec2.dot(this.body.vel, hit.normal);
      if (normalSpeed <= 0) {
        if (normalSpeed < 0 && !this.support)
          this.landingVelocity = vec2.clone(this.body.vel);
        this.support = supportFromContact(hit, this.body.radius);
        vec2.scaleAndAdd(this.body.vel, this.body.vel, hit.normal, -normalSpeed);
      }
      if (hit.depth < 0.0001) return;
      vec2.scaleAndAdd(this.body.pos, this.body.pos, hit.normal, hit.depth);
      collectContacts(this.body, ground);
    }
  }

  afterPhysics(dt: number, ground: GroundPolygon[]) {
    this.gun.update(this.castBeam, dt);
    this.updateFeet(dt, ground);
    this.poseAnkles();
    this.updateScreen(dt);
  }

  private updateScreen(dt: number) {
    const speed = vec2.length(this.body.vel);
    const normal =
      this.support && speed <= playerConfig.screen.settleSpeed
        ? this.plantedNormal()
        : null;
    const feet = this.legs.reduce(
      (count, leg) => count + Number(leg.foot.kind === "planted"),
      0
    );
    this.screen.update(dt, {
      airborne: this.support === null,
      charge: this.jumpCharge(),
      speed,
      feet,
      plantedNormal: normal
    });
  }

  private updateCrouch(dt: number, legs: GripRequest[], edges: GroundEdge[]) {
    const charge = this.jumpCharge();
    const depth = (legConfig.restExtension - legConfig.chargedExtension) * charge;
    const normal = depth > 0 && this.support ? this.pushOffDirection(this.support) : [0, 0];
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
      if (contact) {
        // Feet assigned at impact carry the incoming velocity until they plant or lose the reach.
        const landingVelocity =
          this.landingVelocity ??
          (leg.foot.kind === "reaching" ? leg.foot.landingVelocity : undefined);
        leg.foot = { kind: "reaching", anchor: contact.anchor, landingVelocity };
      } else if (leg.foot.kind !== "free") {
        const angle = this.shell.rotation + i * legSpacing;
        leg.foot = {
          kind: "free",
          offset: angleDifference(angle, leg.angle),
          angularVelocity: 0
        };
      }
    }
    this.landingVelocity = undefined;
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
    const charge = this.jumpCharge();
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
        const rim = tuckedLegLength(angle - this.shell.rotation);
        const length =
          this.gun.phase === "aiming"
            ? rim
            : lerp(stance.restLength, rim + jump.freeLegStub, charge);
        target = { angle, length, footAngle: angle };
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
        const { anchor, landingVelocity } = leg.foot;
        leg.foot = { kind: "planted", anchor, plantedOffset: anchor.offset };
        if (landingVelocity || speed > 0) this.playFootDust(anchor, speed, landingVelocity);
      } else {
        clearSwing(swingCenter, leg, edges);
      }
    }
  }

  private playFootDust(
    { edge, offset }: FootAnchor,
    speed: number,
    landingVelocity?: vec2
  ) {
    const strength = landingVelocity
      ? Math.min(1, Math.max(0, -vec2.dot(landingVelocity, edge.normal)) / jump.fullSpeed)
      : movement.maxStepDustStrength * Math.min(1, speed / movement.topSpeed);
    this.particles.play(
      gameAssets.particles.get("landing-dust"),
      {
        kind: "world",
        position: soleAt(edge, offset),
        angle: Math.atan2(edge.normal[1], edge.normal[0])
      },
      { strength }
    );
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

function drawAnkleJoint(ctx: CanvasRenderingContext2D) {
  const { radius, borderWidth } = playerConfig.ankleJoint;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, tau);
  ctx.fill();
  ctx.lineWidth = borderWidth;
  ctx.stroke();
}

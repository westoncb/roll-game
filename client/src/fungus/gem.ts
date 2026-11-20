import { vec2 } from "gl-matrix";
import { castCapsule, nearestBoundary, sweepCircle } from "../engine/collision";
import { Drawable2D } from "../engine/drawable";
import type { Entity } from "../engine/entity";
import { GroundPolygon } from "../engine/ground";
import { tau } from "../engine/math";
import type { PhysicsBody } from "../engine/physics";
import type { FungalColony } from "./colony";
import type { Junction } from "./fabric";
import type { ColonyPalette } from "./palette";

// Unit geometry is shared; each colony scales both the drawing and casts by its radius.
const hex = new GroundPolygon(
  Array.from({ length: 6 }, (_, i) => {
    const angle = (i * tau) / 6;
    return vec2.fromValues(Math.cos(angle), Math.sin(angle));
  }),
  0
);

function face(points: vec2[]) {
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1]);
  path.closePath();
  return path;
}

// The full black hexagon is also the collision outline. All facets lie inside its bevel.
const outline = face(hex.vertices);
const inset = hex.vertices.map((p) => vec2.scale(vec2.create(), p, 0.74));
const crown = inset.map((p) => vec2.fromValues(p[0] * 0.53 - 0.093, p[1] * 0.5 - 0.121));
const facets = inset.map((p, i) => {
  const next = (i + 1) % 6;
  return face([p, inset[next], crown[next], crown[i]]);
});
const table = face(crown);
function drawGem(ctx: CanvasRenderingContext2D, colors: ColonyPalette) {
  ctx.fillStyle = "#000";
  ctx.fill(outline);
  for (let i = 0; i < facets.length; i++) {
    ctx.fillStyle = colors.facets[i];
    ctx.fill(facets[i]);
  }
  ctx.fillStyle = colors.gem;
  ctx.fill(table);
}

type ReturnTrip =
  | { phase: "reeling"; receiver: PhysicsBody; previousCenter: vec2; speed: number }
  | {
      phase: "collecting";
      receiver: PhysicsBody;
      offset: vec2;
      startScale: number;
      elapsed: number;
    };

export class FungalNode implements Entity {
  readonly radius: number;
  readonly visual: Drawable2D;
  private age: number;
  private opacity = 1;
  private trip: ReturnTrip | null = null;
  constructor(
    readonly id: string,
    readonly junction: Junction,
    private readonly colony: FungalColony,
    growing: boolean
  ) {
    this.radius = colony.tuning.nodeRadius;
    const animating = growing && colony.tuning.gemGrowSeconds > 0;
    this.age = animating ? 0 : colony.tuning.gemGrowSeconds;
    this.visual = new Drawable2D((ctx) => {
      ctx.globalAlpha *= this.opacity;
      ctx.scale(this.radius, this.radius);
      drawGem(ctx, colony.palette);
    }, colony.visual);
    vec2.copy(this.visual.position, junction.position);
    vec2.set(this.visual.scale, animating ? 0 : 1, animating ? 0 : 1);
  }

  get reeling() {
    return this.trip?.phase === "reeling";
  }

  growIn(dt: number) {
    const { gemGrowSeconds } = this.colony.tuning;
    if (this.age >= gemGrowSeconds) return;
    this.age = Math.min(gemGrowSeconds, this.age + dt);
    const t = this.age / gemGrowSeconds;
    const scale = t * t * (3 - 2 * t);
    vec2.set(this.visual.scale, scale, scale);
  }

  /** Cast in gem-local coordinates so the growing silhouette and the hits agree. */
  cast(from: vec2, to: vec2, movingRadius = 0) {
    const center = this.visual.position,
      scale = this.radius * this.visual.scale[0];
    if (scale <= 0 || !castCapsule(from, to, movingRadius, center, center, scale))
      return null;
    const start = vec2.subtract(vec2.create(), from, center);
    vec2.scale(start, start, 1 / scale);
    const radius = movingRadius / scale;
    const boundary = nearestBoundary(start, hex);
    const delta = vec2.subtract(vec2.create(), to, from);
    const hit =
      boundary.distance <= radius
        ? { ...boundary, fraction: 0 }
        : sweepCircle(start, radius, vec2.scale(delta, delta, 1 / scale), [hex]);
    return (
      hit && {
        fraction: hit.fraction,
        normal: hit.normal,
        point: vec2.scaleAndAdd(vec2.create(), center, hit.point, scale)
      }
    );
  }

  reelTo(receiver: PhysicsBody, speed: number) {
    this.colony.detachNode(this);
    this.trip = {
      phase: "reeling",
      receiver,
      previousCenter: vec2.clone(receiver.pos),
      speed
    };
  }

  /** Called after body movement, including while the player holds a fatal-contact pose. */
  advanceReturn(dt: number) {
    const trip = this.trip!;
    const pos = this.visual.position;
    if (trip.phase === "collecting") {
      trip.elapsed += dt;
      const t = Math.min(1, trip.elapsed / this.colony.tuning.gemCollectSeconds);
      vec2.scaleAndAdd(pos, trip.receiver.pos, trip.offset, 1 - 0.3 * t);
      const scale = trip.startScale * (1 - t * t);
      vec2.set(this.visual.scale, scale, scale);
      this.opacity = 1 - t * t;
      return t === 1;
    }
    this.growIn(dt);
    const center = trip.receiver.pos;
    const travel = vec2.subtract(vec2.create(), center, pos);
    const distance = vec2.length(travel);
    if (distance > 0) vec2.scale(travel, travel, Math.min(1, (trip.speed * dt) / distance));
    // Sweep relative motion so walking or jumping through the returning gem counts too.
    const relativeEnd = vec2.subtract(vec2.create(), center, travel);
    const hit = this.cast(trip.previousCenter, relativeEnd, trip.receiver.radius);
    vec2.scaleAndAdd(pos, pos, travel, hit?.fraction ?? 1);
    if (hit) {
      if (this.colony.tuning.gemCollectSeconds === 0) {
        this.trip = null;
        return true;
      }
      const atContact = vec2.lerp(vec2.create(), trip.previousCenter, center, hit.fraction);
      const offset = vec2.subtract(vec2.create(), pos, atContact);
      vec2.add(pos, center, offset);
      this.trip = {
        phase: "collecting",
        receiver: trip.receiver,
        offset,
        startScale: this.visual.scale[0],
        elapsed: 0
      };
    } else vec2.copy(trip.previousCenter, center);
    return false;
  }
}

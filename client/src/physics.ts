import { vec2 } from "gl-matrix";
import { circleGroundContact, nearestBoundary, type GroundContact } from "./collision";
import type { GroundPolygon } from "./ground";

export class PhysicsBody {
  readonly vel = vec2.create();
  readonly accel = vec2.create();
  readonly contacts: GroundContact[] = [];

  /** pos is the live world-space center, typically the entity's root drawable position. */
  constructor(
    readonly pos: vec2,
    public radius: number
  ) {}
}

export function stepPhysics(body: PhysicsBody, ground: GroundPolygon[], dt: number) {
  vec2.scaleAndAdd(body.vel, body.vel, body.accel, dt);
  vec2.scaleAndAdd(body.pos, body.pos, body.vel, dt);
  collectContacts(body, ground);
}

export function collectContacts(body: PhysicsBody, ground: GroundPolygon[]) {
  body.contacts.length = 0;
  for (const polygon of ground) {
    const contact = circleGroundContact(body.pos, body.radius, polygon);
    if (contact) body.contacts.push(contact);
  }
}

export function gravityAt(body: PhysicsBody, ground: GroundPolygon[]) {
  let x = 0;
  let y = 0;
  const range = 180;
  for (const polygon of ground) {
    const { normal, distance } = nearestBoundary(body.pos, polygon);
    const t = Math.min(1, Math.max(0, (distance - body.radius) / range));
    const falloff = 1 - t * t * (3 - 2 * t);
    const strength = -650 * polygon.gravityScale * falloff;
    x += normal[0] * strength;
    y += normal[1] * strength;
  }
  return vec2.fromValues(x, y);
}

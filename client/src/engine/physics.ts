import { vec2 } from "gl-matrix";
import {
  circleGroundContact,
  sweepCircle,
  type GroundContact,
  type TerrainHit
} from "./collision";
import type { GroundPolygon } from "./ground";

export const gravityY = 650;

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

export function stepPhysics(
  body: PhysicsBody,
  ground: GroundPolygon[],
  dt: number,
  supportNormal: vec2 | null = null
) {
  vec2.scaleAndAdd(body.vel, body.vel, body.accel, dt);
  if (supportNormal && vec2.dot(body.vel, supportNormal) < 0) {
    const along = -supportNormal[1] * body.vel[0] + supportNormal[0] * body.vel[1];
    vec2.set(body.vel, -supportNormal[1] * along, supportNormal[0] * along);
  }
  const travel = vec2.scale(vec2.create(), body.vel, dt);
  const hit = sweepCircle(body.pos, body.radius, travel, ground);
  vec2.scaleAndAdd(body.pos, body.pos, travel, hit?.fraction ?? 1);
  collectContacts(body, ground, hit);
  return hit;
}

export function collectContacts(
  body: PhysicsBody,
  ground: GroundPolygon[],
  impact: TerrainHit | null = null
) {
  body.contacts.length = 0;
  // Keep the face we entered first. At a junction the nearest boundary can be the
  // surface we were already sliding along, even when both faces belong to one polygon.
  const first = impact && { ...impact, depth: 0 };
  if (first) body.contacts.push(first);
  for (const polygon of ground) {
    const contact = circleGroundContact(body.pos, body.radius, polygon);
    if (!contact) continue;
    if (first && first.ground === polygon && first.edgeIndex === contact.edgeIndex)
      first.depth = contact.depth;
    else body.contacts.push(contact);
  }
}

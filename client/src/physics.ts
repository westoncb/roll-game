import { vec2 } from "gl-matrix";
import { circleGroundContact, type GroundContact } from "./collision";
import type { GroundPolygon } from "./ground";

export type PhysicsBody = {
  pos: vec2;
  vel: vec2;
  accel: vec2;
  radius: number;
  contacts: GroundContact[];
};

export function stepPhysics(body: PhysicsBody, ground: GroundPolygon[], dt: number) {
  vec2.scaleAndAdd(body.vel, body.vel, body.accel, dt);
  vec2.scaleAndAdd(body.pos, body.pos, body.vel, dt);
  body.contacts.length = 0;
  for (const polygon of ground) {
    const contact = circleGroundContact(body.pos, body.radius, polygon);
    if (contact) body.contacts.push(contact);
  }
}

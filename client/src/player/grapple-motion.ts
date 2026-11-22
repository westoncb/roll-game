import { vec2 } from "gl-matrix";
import { playerConfig } from "./config";

const gun = playerConfig.gun;
// A spring pulling back on the extending head: x = reach * sin(rate * t).
const rate = gun.launchSpeed / gun.maxReach;
export const extensionSeconds = Math.PI / (2 * rate);

export function extensionAt(time: number) {
  return gun.maxReach * Math.sin(rate * Math.min(time, extensionSeconds));
}

export function extensionTimeAt(reach: number) {
  return Math.asin(Math.min(1, reach / gun.maxReach)) / rate;
}

export function tipVelocity(direction: vec2, reach: number, mountVelocity: vec2) {
  const speed = gun.launchSpeed * Math.sqrt(Math.max(0, 1 - (reach / gun.maxReach) ** 2));
  return vec2.scaleAndAdd(vec2.create(), mountVelocity, direction, speed);
}

export type PunchImpact = { normal: vec2; impulse: number; damage: number };
export const maxPunchStrength = 1.25;

export function punchImpact(
  velocity: vec2,
  surfaceNormal: vec2,
  targetVelocity: vec2
): PunchImpact {
  const normal = vec2.negate(vec2.create(), surfaceNormal);
  const closingSpeed = vec2.dot(velocity, normal) - vec2.dot(targetVelocity, normal);
  // Transfer normal momentum; damage scales with the kinetic energy of the impact.
  const strength = Math.max(0, Math.min(maxPunchStrength, closingSpeed / gun.launchSpeed));
  return {
    normal,
    impulse: gun.punchImpulse * strength,
    damage: Math.round(gun.punchDamage * strength ** 2)
  };
}

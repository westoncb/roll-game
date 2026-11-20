/** Immutable birth state in the emitter's simulation space. */
export interface Particle {
  readonly born: number;
  readonly lifetime: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ax: number;
  readonly ay: number;
  readonly rotation: number;
  readonly angularSpeed: number;
  readonly radius: number;
}

/** Evaluate motion at any age under constant acceleration and linear drag. */
export function particlePoseAt(
  particle: Particle,
  age: number,
  drag: number,
  out: { x: number; y: number; rotation: number }
) {
  let velocityTime = age;
  let accelerationTime = (age * age) / 2;
  if (drag * age > 1e-6) {
    velocityTime = -Math.expm1(-drag * age) / drag;
    accelerationTime = (age - velocityTime) / drag;
  }
  out.x = particle.x + particle.vx * velocityTime + particle.ax * accelerationTime;
  out.y = particle.y + particle.vy * velocityTime + particle.ay * accelerationTime;
  out.rotation = particle.rotation + particle.angularSpeed * age;
}

import { tau } from "./util";

// Distances are in world units, angles in radians, and times in seconds.
export const playerConfig = {
  shell: { size: 30, cornerRadius: 2, borderWidth: 1.5 },
  hexagon: { radius: 10, borderWidth: 1.25 },
  leg: {
    count: 10,
    // Extensions are measured from the shell's outer corner radius to the ankle.
    // The minimum leaves room for the shell to shake around a planted leg.
    minExtension: 3,
    chargedExtension: 3,
    restExtension: 9,
    maxExtension: 24,
    width: 4,
    borderWidth: 0.875,
    extensionSpeed: 175,
    swingSpeed: 14,
    swingFractionOfSpacing: 0.49,
    spacingSettleSeconds: 0.12
  },
  foot: {
    height: 8,
    width: 18,
    borderWidth: 1,
    foldedScale: 0.3,
    unfoldSeconds: 0.12,
    stepSeconds: 0.085,
    stepHeight: 6,
    slideSpeed: 120,
    // At speed, check a new grip over this fraction of the angle between legs.
    gripCheckSpacingFraction: 0.25,
    turnSpeed: 15
  },
  movement: {
    topSpeed: 660,
    runAcceleration: 240,
    coastDeceleration: 175,
    brakeDeceleration: 850,
    // Absolute horizontal component of the surface tangent.
    wallEnterX: 0.4,
    wallExitX: 0.65,
    minLandingSlide: 20
  },
  jump: {
    tapSpeed: 205,
    fullSpeed: 750,
    fullChargeSeconds: 0.75,
    chargedSpeedScale: 0.02,
    shakeAmplitudeX: 2.5,
    shakeAmplitudeY: 1.5,
    shakeHzX: 11,
    shakeHzY: 14
  },
  // Each pair runs from neutral to fully charged.
  colors: {
    shellFill: ["#55585c", "#c7cbd0"],
    legFill: ["#73767a", "#e4e7e9"],
    metalBorder: ["#94989c", "#ffffff"],
    footFill: ["#d63d41", "#ff8889"],
    footBorder: ["#82272d", "#db5159"],
    hexagonFill: ["#000000", "#ff0000"],
    hexagonBorder: ["#929ba1", "#ffb4a8"]
  }
} as const;

const { shell, leg, foot } = playerConfig;
export const shellRadius = (shell.size + shell.borderWidth) / Math.SQRT2;
export const restLegLength = shellRadius + leg.restExtension;
export const minLegReach = shellRadius + leg.minExtension;
export const maxLegReach = shellRadius + leg.maxExtension;
// At rest a ground-facing leg and an open pad span the rolling radius.
export const rollRadius = restLegLength + foot.height;
export const halfSole = foot.width / 2;
export const legSpacing = tau / leg.count;
export const maxLegAngle = legSpacing * leg.swingFractionOfSpacing;

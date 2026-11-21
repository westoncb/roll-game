import { tau } from "../utils/math";

export const knockoutPoints = 10;
export const maxHealth = 100;
export const fungusDamagePerSecond = 36;

// The glove hits hardest within one robot's diameter, then loses force over its reach.
export function punchDamage(distance: number) {
  const falloff = Math.min(1, Math.max(0, (distance - 90) / 450));
  return Math.round(30 - 15 * falloff);
}

// Distances are in world units, angles in radians, and times in seconds.
export const playerConfig = {
  shell: { size: 39.675, cornerRadius: 2, borderWidth: 1.5 },
  screen: {
    width: 24,
    height: 21,
    cornerRadius: 4,
    borderWidth: 1.25,
    settleSpeed: 18,
    settleSeconds: 0.2,
    turnSpeed: 6
  },
  leg: {
    count: 10,
    // Extensions are measured from the shell's outer corner radius to the ankle.
    // The minimum leaves room for the shell to shake around a planted leg.
    minExtension: 3,
    chargedExtension: 3,
    restExtension: 7,
    maxExtension: 20,
    width: 4,
    borderWidth: 0.875,
    extensionSpeed: 175,
    swingSpeed: 14,
    swingFractionOfSpacing: 0.49,
    spacingSettleSeconds: 0.12
  },
  ankleJoint: { radius: 3.5, borderWidth: 1 },
  foot: {
    height: 8,
    width: 18,
    borderWidth: 1,
    foldedScale: 0.55,
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
    // Tangential speed that breaks grip on a 90-degree outside corner.
    cornerReleaseSpeed: 500,
    maxStepDustStrength: 0.35,
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
    fullChargeSeconds: 0.3,
    chargedSpeedScale: 0.02,
    // Distance from the shell rim to a free ankle at full charge.
    freeLegStub: 5,
    shakeAmplitudeX: 2.5,
    shakeAmplitudeY: 1.5,
    shakeHzX: 11,
    shakeHzY: 14
  },
  gun: {
    aimSpeed: 2.7,
    aimMemoryDistance: 48,
    extensionSpeed: 900,
    retractSpeed: 1150,
    pullSpeed: 710,
    reelSpeed: 720,
    punchSpeed: 880,
    minPullProgressSpeed: 0.1,
    barrelLength: 45,
    barrelSpeed: 375,
    headLength: 11,
    segmentLength: 13
  },
  // Each pair runs from neutral to fully charged.
  colors: {
    shellFill: ["#55585c", "#c7cbd0"],
    legFill: ["#73767a", "#e4e7e9"],
    metalBorder: ["#94989c", "#ffffff"],
    footFill: ["#d63d41", "#ff8889"],
    footBorder: ["#82272d", "#db5159"],
    screenIdleFill: "#08201c",
    screenChargeFill: ["#ce3943", "#ed4952"],
    screenBorder: ["#a1b0ae", "#ffb4a8"]
  }
} as const;

export type PlayerColors = {
  [K in keyof typeof playerConfig.colors]: K extends "screenIdleFill"
    ? string
    : readonly [string, string];
};

export const rivalColors: PlayerColors = {
  shellFill: ["#266774", "#9adbd8"],
  legFill: ["#438e93", "#adf7ef"],
  metalBorder: ["#83c6bd", "#effffc"],
  footFill: ["#33d4c2", "#a9fff3"],
  footBorder: ["#186d70", "#51b6b0"],
  screenIdleFill: "#0b2730",
  screenChargeFill: ["#198a99", "#38bbbe"],
  screenBorder: ["#99c7ca", "#c7fffb"]
};

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

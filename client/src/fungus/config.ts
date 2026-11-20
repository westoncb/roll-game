import type { Point } from "../level";

export const defaultColonySeed = 37;
export const defaultPrimaryColor = "#cf817c";

// Level JSON can override any of these under fungalColonies[].tuning.
// Distances are in world units. A tick advances both main and minor growth.
export const defaultColonyTuning = {
  tickSeconds: 1 / 20, // Seconds between growth ticks (minimum 0.001).
  growthStep: 2, // Distance a main tip travels per tick.
  matureTipTicks: 10, // Age at which a tip can seek a junction, merge, or split.
  mergeRadius: 4.5,
  attractionRadius: 26,
  followRadius: 13,
  meanSplitLength: 95, // Mean distance between split attempts on an eligible tip.
  minSplitWeight: 0.5,

  // A split or a new group of minor buds can form a gem this far from other gems.
  branchKnotSpacing: 108,
  fusionArrivals: 3, // Two tips establish a junction and count as the first two arrivals.
  fusionKnotSpacingRadii: 2, // Minimum fusion-gem spacing in multiples of nodeRadius.
  nodeRadius: 16,
  gemGrowSeconds: 0.38,
  gemCollectSeconds: 0.22,

  // Extraction sends a pulse along fibers. Strength at path distance d is exp(-d / decayLength).
  woundSpeed: 90, // World units of fiber traveled per second.
  woundDecayLength: 52,
  woundMinStrength: 0.14, // Stop propagation below this strength.
  woundKillStrength: 0.01, // Weaker hits dim and recover.
  woundFlashSeconds: 0.2,
  woundWitherSeconds: 0.32,
  woundRecoverSeconds: 0.65,

  mainRadius: 1.35,
  minorRadius: 0.6,
  mainSegmentsPerTile: 180, // Local saturation stops further growth of that strand type.
  minorSegmentsPerTile: 650,
  minBudGroupGap: 4,
  meanExtraBudGroupGap: 15, // Mean random distance added to the minimum gap.
  minorForkChance: 0.23
};
export type ColonyTuning = typeof defaultColonyTuning;

export type ColonyData = {
  id: string;
  seed?: number;
  primaryColor?: string;
  tuning?: Partial<ColonyTuning>;
  nodes: { id: string; position: Point }[];
  strands?: [string, string][];
  tips?: { from: string; direction: Point }[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function point(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function validTuning(key: keyof ColonyTuning, value: number) {
  if (!Number.isFinite(value)) return false;
  switch (key) {
    case "tickSeconds":
      return value >= 0.001; // At most 1,000 simulation ticks per second.
    case "fusionArrivals":
      return Number.isSafeInteger(value) && value >= 2;
    case "matureTipTicks":
    case "mainSegmentsPerTile":
    case "minorSegmentsPerTile":
      return Number.isSafeInteger(value) && value >= 0;
    case "minorForkChance":
      return value >= 0 && value <= 1;
    case "woundMinStrength":
    case "woundKillStrength":
      return value > 0 && value <= 1;
    case "branchKnotSpacing":
    case "fusionKnotSpacingRadii":
    case "mergeRadius":
    case "attractionRadius":
    case "followRadius":
    case "minSplitWeight":
    case "gemGrowSeconds":
    case "gemCollectSeconds":
    case "meanExtraBudGroupGap":
      return value >= 0;
    default:
      return value > 0;
  }
}

export function resolveColonyTuning(value: unknown, colonyId: string): ColonyTuning {
  if (value !== undefined && (!record(value) || Array.isArray(value)))
    throw new Error(`Expected a tuning object in fungal colony "${colonyId}".`);
  const tuning = { ...defaultColonyTuning, ...value };
  for (const [key, v] of Object.entries(tuning)) {
    if (!Object.hasOwn(defaultColonyTuning, key))
      throw new Error(`Unknown tuning.${key} in fungal colony "${colonyId}".`);
    if (typeof v !== "number" || !validTuning(key as keyof ColonyTuning, v))
      throw new Error(`Invalid tuning.${key} in fungal colony "${colonyId}".`);
  }
  return tuning;
}

export function readColonies(value: unknown): ColonyData[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("fungalColonies must be an array.");
  const colonies = new Set<string>();
  return value.map((raw, index) => {
    if (!record(raw) || !id(raw.id) || colonies.has(raw.id))
      throw new Error(`fungalColonies[${index}] needs a unique ID.`);
    colonies.add(raw.id);
    const invalid = (field: string) =>
      new Error(`Invalid ${field} in fungal colony "${raw.id}".`);
    if (
      raw.seed !== undefined &&
      !(typeof raw.seed === "number" && Number.isSafeInteger(raw.seed))
    )
      throw invalid("seed");
    if (
      raw.primaryColor !== undefined &&
      (typeof raw.primaryColor !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.primaryColor))
    )
      throw invalid("primaryColor (expected #RRGGBB)");
    if (!Array.isArray(raw.nodes) || !raw.nodes.length) throw invalid("nodes");
    const ids = new Set<string>();
    const nodes = raw.nodes.map((n: unknown) => {
      if (!record(n) || !id(n.id) || ids.has(n.id) || !point(n.position))
        throw invalid("starting node");
      ids.add(n.id);
      return { id: n.id, position: n.position };
    });
    const strands: [string, string][] = [];
    if (raw.strands !== undefined) {
      if (!Array.isArray(raw.strands)) throw invalid("strands");
      for (const edge of raw.strands) {
        if (
          !Array.isArray(edge) ||
          edge.length !== 2 ||
          !ids.has(edge[0]) ||
          !ids.has(edge[1]) ||
          edge[0] === edge[1]
        )
          throw invalid("strand endpoints");
        strands.push([edge[0], edge[1]]);
      }
    }
    if (raw.tips !== undefined && !Array.isArray(raw.tips)) throw invalid("tips");
    const tips = raw.tips?.map((t: unknown) => {
      if (
        !record(t) ||
        !id(t.from) ||
        !ids.has(t.from) ||
        !point(t.direction) ||
        (t.direction[0] === 0 && t.direction[1] === 0)
      )
        throw invalid("tip");
      return { from: t.from, direction: t.direction };
    });
    return {
      id: raw.id,
      seed: raw.seed,
      primaryColor: raw.primaryColor,
      tuning:
        raw.tuning === undefined ? undefined : resolveColonyTuning(raw.tuning, raw.id),
      nodes,
      strands,
      tips
    };
  });
}

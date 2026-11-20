import type { Point } from "../level";

export type ColonyData = {
  id: string;
  seed?: number;
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
    return { id: raw.id, seed: raw.seed, nodes, strands, tips };
  });
}

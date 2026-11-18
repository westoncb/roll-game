import { Level, type GroundData, type Point } from "./level";

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isGroundData(value: unknown): value is GroundData {
  if (!value || typeof value !== "object" || !("vertices" in value)) return false;
  const vertices = value.vertices;
  return (
    Array.isArray(vertices) &&
    vertices.length >= 3 &&
    vertices.every(isPoint) &&
    (!("gravityScale" in value) ||
      (typeof value.gravityScale === "number" && Number.isFinite(value.gravityScale)))
  );
}

export async function loadLevel(id: string, signal: AbortSignal): Promise<Level> {
  const response = await fetch(`/api/levels/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error(`Level "${id}" returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("playerStart" in data) ||
    !isPoint(data.playerStart)
  ) {
    throw new Error(`Level "${id}" needs a playerStart coordinate pair.`);
  }
  if (
    !("ground" in data) ||
    !Array.isArray(data.ground) ||
    !data.ground.every(isGroundData)
  ) {
    throw new Error(`Level "${id}" has invalid ground polygons.`);
  }
  if (
    !("width" in data) ||
    !isDimension(data.width) ||
    !("height" in data) ||
    !isDimension(data.height)
  ) {
    throw new Error(`Level "${id}" needs a positive width and height in world units.`);
  }
  return new Level({
    width: data.width,
    height: data.height,
    playerStart: data.playerStart,
    ground: data.ground
  });
}

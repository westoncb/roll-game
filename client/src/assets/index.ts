import { fill, stroke } from "../engine/draw-routines";
import { readShapeStyle } from "../engine/shape-style";
import { AssetCatalog } from "./catalog";
import { fungalStrands } from "./draw-routines/fungal-strands";
import { grass } from "./draw-routines/grass";
import { sciFiDirt } from "./draw-routines/sci-fi-dirt";
import { sketchBorder } from "./draw-routines/sketch-border";
import { readParticleEffect } from "./particle-effect";

const gameRoutines = {
  fill,
  stroke,
  sciFiDirt,
  sketchBorder,
  fungalStrands,
  grass
};

const particleFiles = import.meta.glob<unknown>("../../../assets/particles/*.json", {
  eager: true,
  import: "default"
});

const styleFiles = import.meta.glob<unknown>("../../../assets/shape-styles/*.json", {
  eager: true,
  import: "default"
});

function catalog<T>(
  kind: string,
  files: Record<string, unknown>,
  read: (data: unknown, source: string) => T
) {
  return new AssetCatalog(
    kind,
    Object.entries(files).map(([path, data]) => {
      const id = path.slice(path.lastIndexOf("/") + 1, -".json".length);
      return [id, read(data, path)] as const;
    })
  );
}

export const gameAssets = {
  particles: catalog("particle", particleFiles, readParticleEffect),
  shapeStyles: catalog("shape style", styleFiles, (data, source) =>
    readShapeStyle(data, source, gameRoutines)
  )
};

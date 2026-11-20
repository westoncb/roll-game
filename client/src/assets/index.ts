import { readParticleEffect } from "./particle-effect";
import { readShapeStyle } from "./shape-style";
import { AssetCatalog } from "./catalog";

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
  shapeStyles: catalog("shape style", styleFiles, readShapeStyle)
};

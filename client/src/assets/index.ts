import { readParticleEffect } from "../particles/read-definition";
import { AssetCatalog } from "./catalog";

const particleFiles = import.meta.glob<unknown>("../../../assets/particles/*.json", {
  eager: true,
  import: "default"
});

export const gameAssets = {
  particles: new AssetCatalog(
    "particle",
    Object.entries(particleFiles).map(([path, data]) => {
      const id = path.slice(path.lastIndexOf("/") + 1, -".json".length);
      return [id, readParticleEffect(data, path)] as const;
    })
  )
};

import { defaultPrimaryColor, fiberColorSteps } from "./config";

function luminance(channels: number[]) {
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Prefer a bright complementary facet, with at least 3:1 contrast against the main strand.
export function colonyPalette(primary = defaultPrimaryColor) {
  const rgb = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16) / 255);
  const low = Math.min(...rgb),
    high = Math.max(...rgb);
  const complement =
    high - low < 0.04
      ? [0.25, 0.9, 0.78]
      : rgb.map((c) => 0.18 + (0.8 * (high - c)) / (high - low));
  const base = luminance(rgb);
  let gem = "";
  for (const end of [1, 0]) {
    for (let step = 0; step <= 20; step++) {
      const candidate = complement.map((c) =>
        Math.round(255 * (c + ((end - c) * step) / 20))
      );
      const light = luminance(candidate.map((c) => c / 255));
      if ((Math.max(light, base) + 0.05) / (Math.min(light, base) + 0.05) >= 3) {
        gem = "#" + candidate.map((c) => c.toString(16).padStart(2, "0")).join("");
        break;
      }
    }
    if (gem) break;
  }
  const tint = (color: string, other: string, amount: number) =>
    `color-mix(in srgb, ${color}, ${other} ${amount}%)`;
  const mid = tint(gem, "black", 22);
  const minor = tint(primary, "#38394e", 32);
  const ash = "#505053";
  const healthRamp = (healthy: string) => {
    // Give the bruise a plum hue at the lightness halfway between this fiber and its ash.
    const midpoint = `color-mix(in oklab, ${ash}, ${healthy})`;
    const bruise = `oklch(from ${midpoint} l 0.045 325)`;
    const half = fiberColorSteps / 2;
    return Array.from({ length: fiberColorSteps + 1 }, (_, i) => {
      if (i === 0) return ash;
      if (i === fiberColorSteps) return healthy;
      return i <= half
        ? `color-mix(in oklab, ${ash}, ${bruise} ${(100 * i) / half}%)`
        : `color-mix(in oklab, ${bruise}, ${healthy} ${(100 * (i - half)) / half}%)`;
    });
  };
  return {
    primary,
    ash,
    tissue: { main: healthRamp(primary), minor: healthRamp(minor) },
    supply: Array.from({ length: fiberColorSteps + 1 }, (_, i) =>
      tint("#4c285e", "#ffe18a", (100 * i) / fiberColorSteps)
    ),
    tip: tint(primary, "white", 42),
    wound: tint(gem, "white", 72),
    gem,
    facets: [
      mid,
      tint(gem, "black", 48),
      mid,
      tint(gem, "white", 88),
      tint(gem, "white", 65),
      gem
    ]
  };
}

export type ColonyPalette = ReturnType<typeof colonyPalette>;

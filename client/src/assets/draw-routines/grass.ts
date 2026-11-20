import type { DrawRoutine, RoutineSettings } from "../../engine/draw-routines";
import { boundaryArtwork } from "./boundary";
import { checkFields, color, positive, seededRandom } from "./brush-settings";

export function grass(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(
    settings,
    ["height", "spacing", "pixelSize", "shadow", "leaf", "highlight"],
    source
  );
  const height = positive(settings, "height", source);
  const spacing = positive(settings, "spacing", source);
  const pixel =
    settings.pixelSize === undefined ? 2 : positive(settings, "pixelSize", source);
  const shadow = color(settings, "shadow", source);
  const leaf = color(settings, "leaf", source);
  const highlight = color(settings, "highlight", source);

  const artwork = boundaryArtwork((edges, seed) => {
    const roots = new Path2D(),
      leaves = new Path2D(),
      tips = new Path2D();
    const random = seededRandom(Math.imul(seed + 1, 0x27d4eb2d));
    const phase = random() * Math.PI * 2;
    const gap = () => spacing * (0.55 + random() * 0.85);
    const strip = () => spacing * (2.6 + random() * 2);
    let start = -random() * spacing * 2;
    let end = start + strip();

    // Walk from a wall or underside so a continuous shelf can cross vertex zero.
    const first = edges.findIndex(({ transform }) => transform.d >= -0.55);
    for (let i = 1; i <= edges.length; i++) {
      const { length, transform } = edges[(first + i) % edges.length];
      if (transform.d >= -0.55) continue;
      // A column belongs to the edge under its centre, including where two slopes meet.
      // Keep very long edges bounded even when an asset requests sub-pixel blades.
      const stride = Math.max(1, Math.ceil(length / pixel / 4096));
      const step = stride * pixel;
      while (start < length) {
        const left = transform.e + Math.max(0, start) * transform.a;
        const right = transform.e + Math.min(length, end) * transform.a;
        for (let col = Math.ceil(left / step - 0.5); col < right / step - 0.5; col++) {
          const at = ((col + 0.5) * step - transform.e) / transform.a;
          const y = Math.round((transform.f + at * transform.b) / pixel);
          const taper = Math.min(1, (at - start) / height, (end - at) / height);
          const wave = Math.sin((col * step) / (height * 1.8) + phase);
          const rows = Math.min(
            48,
            Math.max(
              1,
              Math.round(
                (height / pixel) * taper * (0.7 + 0.19 * wave) * (0.65 + 0.85 * random())
              )
            )
          );
          const sod = Math.max(1, Math.round(rows * 0.34));
          const x = col * stride;
          roots.rect(x, y - sod, stride, sod + 1);
          leaves.rect(x, y - sod, stride, sod);

          const lean =
            rows * (0.22 + 0.3 * wave + transform.c * 0.45 + (random() - 0.5) * 0.65);
          const lit = random() < 0.67;
          const paleTip = lit && random() < 0.2 + 0.12 * wave;
          const blade = lit ? leaves : roots;
          let previous = x;
          for (let row = sod; row <= rows; row++) {
            const t = row / rows;
            const bladeX = x + Math.round(lean * t * t);
            const left = Math.min(previous, bladeX);
            const width = stride + Math.abs(bladeX - previous) + (t < 0.65 ? 1 : 0);
            blade.rect(left, y - row, width, 1);
            if (paleTip && row >= rows - 1) tips.rect(left, y - row, width, 1);
            previous = bladeX;
          }
        }
        if (end >= length) break;
        start = end + Math.max(gap(), length / 512);
        end = start + strip();
      }
      // Carry the remainder of this strip (or clearing) onto the next surface.
      start -= length;
      end -= length;
    }
    return { roots, leaves, tips };
  });

  return (ctx, shape, frame) => {
    const { roots, leaves, tips } = artwork(shape, frame.seed);
    ctx.scale(pixel, pixel);
    ctx.fillStyle = shadow;
    ctx.fill(roots);
    ctx.fillStyle = leaf;
    ctx.fill(leaves);
    ctx.fillStyle = highlight;
    ctx.fill(tips);
  };
}

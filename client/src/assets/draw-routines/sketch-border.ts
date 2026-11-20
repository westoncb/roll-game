import {
  shapePath,
  type DrawRoutine,
  type RoutineSettings
} from "../../engine/draw-routines";
import { boundaryArtwork } from "./boundary";
import { checkFields, color, positive, seededRandom } from "./brush-settings";

export function sketchBorder(settings: RoutineSettings, source: string): DrawRoutine {
  checkFields(settings, ["width", "reach", "ink", "highlight"], source);
  const ink = color(settings, "ink", source);
  // Older terrain styles specified a second pigment for the charcoal grain.
  if (settings.highlight !== undefined) color(settings, "highlight", source);
  const width = positive(settings, "width", source);
  const reach = positive(settings, "reach", source);

  const artwork = boundaryArtwork((edges, seed, shape) => {
    const strokes = new Path2D();
    const random = seededRandom(Math.imul(seed + 1, 0x9e3779b1));
    for (const [index, { length, transform }] of edges.entries()) {
      const edge = new Path2D();
      const spans = Math.min(256, Math.max(1, Math.round(length / (width * 20))));
      const span = length / spans;
      let end = 0;
      for (let i = 0; i < spans; i++) {
        const start = end;
        end = i === spans - 1 ? length : span * (i + 0.7 + random() * 0.6);
        const run = end - start;
        const swell = Math.min(reach, width, run * 0.12) * (0.3 + random() * 0.7);
        const weight = width * (0.64 + 0.24 * transform.d + random() * 0.65);
        const shoulder = start + run * (0.25 + random() * 0.22);
        const taper = end - run * (0.1 + random() * 0.19);

        // Keep the inner edge in the rock as the outer edge swells into open space.
        edge.moveTo(start, width * 0.4);
        edge.bezierCurveTo(
          shoulder,
          width * 0.4 + swell,
          taper,
          width * 0.4 + swell * 0.25,
          end,
          width * 0.4
        );
        edge.lineTo(end, -width * 0.4);
        edge.bezierCurveTo(taper, -weight * 0.55, shoulder, -weight, start, -width * 0.4);
        edge.closePath();
      }

      const next = edges[(index + 1) % edges.length];
      const turn = transform.a * next.transform.b - transform.b * next.transform.a;
      const room = Math.min(length, next.length);
      if (turn > 0.32 && room > width * 3 && random() < 0.8) {
        // Continue the incoming stroke through a convex corner, then sweep onto the next face.
        const along = transform.a * next.transform.a + transform.b * next.transform.b;
        const flick = Math.min(reach * (0.85 + random() * 0.8), room * 0.26);
        const landing = Math.min(flick * 1.65, next.length * 0.32);
        edge.moveTo(length - flick * 1.55, width * 0.32);
        edge.quadraticCurveTo(length, width * 0.7, length + flick, width * 0.25);
        edge.quadraticCurveTo(
          length + flick * 0.28,
          -width * 0.25,
          length + along * landing,
          -turn * landing
        );
        edge.lineTo(length - width * 0.38, -width * 0.45);
        edge.closePath();
      }
      strokes.addPath(edge, transform);
    }
    return { contour: shapePath(shape), strokes };
  });

  return (ctx, shape, frame) => {
    const { contour, strokes } = artwork(shape, frame.seed);
    ctx.strokeStyle = ctx.fillStyle = ink;
    ctx.lineJoin = "miter";
    ctx.miterLimit = 2.4;
    ctx.lineWidth = width * 0.52;
    ctx.stroke(contour);
    ctx.fill(strokes);
  };
}

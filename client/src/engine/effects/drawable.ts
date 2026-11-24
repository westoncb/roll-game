import { Drawable2D } from "../drawable";
import type { DrawFrame } from "../draw-routines";
import { EffectLifetime, type Effect, type EffectFrame, type EffectTiming } from "./effect";

/** Mount a temporary child in the normal draw order. The parent's transform, Canvas
 * state isolation, and interpolated draw time all come from Drawable2D. */
export function timedDrawable(
  parent: Drawable2D,
  timing: EffectTiming,
  draw: (ctx: CanvasRenderingContext2D, frame: EffectFrame & DrawFrame) => void
): Effect {
  return {
    kind: "leaf",
    start(time) {
      const lifetime = new EffectLifetime(time, timing);
      const node = new Drawable2D((ctx, frame) => {
        const local = lifetime.frameAt(frame.time);
        if (local) draw(ctx, { ...local, seed: frame.seed });
      }, parent);
      return {
        advance: (step) => lifetime.advance(step),
        dispose: () => node.dispose()
      };
    }
  };
}

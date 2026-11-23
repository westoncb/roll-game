import { useEffect, useRef, type RefObject } from "react";
import type { vec2 } from "gl-matrix";
import type { HoverTarget, PlayerGun } from "../player/gun";

export function AimReticle({
  canvasRef,
  pointerRef,
  phase,
  target
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  pointerRef: RefObject<vec2 | null>;
  phase: PlayerGun["phase"];
  target: HoverTarget | null;
}) {
  const reticleRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const reticle = reticleRef.current;
    if (!canvas || !reticle) return;

    const controller = new AbortController();
    const options = { signal: controller.signal };
    const hide = () => {
      pointerRef.current = null;
      canvas.removeAttribute("data-reticle");
    };
    const track = (event: PointerEvent) => {
      if (event.pointerType === "touch") return hide();
      pointerRef.current = [event.clientX, event.clientY];
      reticle.style.translate = `${event.clientX}px ${event.clientY}px`;
      canvas.toggleAttribute("data-reticle", true);
    };
    canvas.addEventListener("pointerenter", track, options);
    canvas.addEventListener("pointermove", track, options);
    canvas.addEventListener("pointerdown", track, options);
    canvas.addEventListener("pointerleave", hide, options);
    canvas.addEventListener("pointercancel", hide, options);
    window.addEventListener("blur", hide, options);
    return () => {
      controller.abort();
      hide();
    };
  }, [canvasRef, pointerRef]);

  return (
    <svg
      className="aim-reticle"
      ref={reticleRef}
      data-phase={phase}
      data-target={target ?? undefined}
      width="96"
      height="96"
      viewBox="-48 -48 96 96"
      aria-hidden="true"
    >
      <g className="reticle-marks">
        {[0, 90, 180, 270].map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path
              className="reticle-index"
              d="M -18.5,-15.5 L -15.5,-18.5 -11,-14 -8.5,-8.5 -14,-11 Z"
            />
          </g>
        ))}
      </g>
      <path d="M 0,-2.2 L 2.2,0 0,2.2 -2.2,0 Z" />
    </svg>
  );
}

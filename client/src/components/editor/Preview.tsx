import { useEffect, useRef, useState } from "react";
import { ParticleSystem } from "../../particles/system";
import type { ParticleEffect } from "../../particles/emitter";

export function Preview({ effect }: { effect: ParticleEffect | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [background, setBackground] = useState("#18222a");
  const [playCount, setPlayCount] = useState(0);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const system = new ParticleSystem();
    if (effect)
      system.play(effect, { kind: "world", position: [0, 0], angle: -Math.PI / 2 });
    const dt = 1 / 60;
    system.step(dt);
    if (playCount === 0) for (let i = 0; i < 8; i++) system.step(dt);
    function draw(alpha: number) {
      if (!ctx || !el) return;
      const { clientWidth: w, clientHeight: h } = el;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(w * dpr));
      const height = Math.max(1, Math.round(h * dpr));
      if (el.width !== width) el.width = width;
      if (el.height !== height) el.height = height;
      ctx.resetTransform();
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, (w * dpr) / 2, h * dpr * 0.7);
      const zoom = Math.min(3, h / 60);
      ctx.scale(zoom, zoom);
      system.draw(ctx, "behind", alpha);
      system.draw(ctx, "front", alpha);
    }
    draw(1);
    let frame = 0,
      last = performance.now(),
      acc = 0;
    function tick(now: number) {
      acc += Math.min((now - last) / 1000, 0.1);
      last = now;
      while (acc >= dt) {
        system.step(dt);
        acc -= dt;
      }
      draw(acc / dt);
      if (system.active) frame = requestAnimationFrame(tick);
    }
    if (playCount > 0 && effect) frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(() => draw(1));
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [effect, playCount]);
  return (
    <section className="preview">
      <canvas ref={canvas} style={{ background }} aria-label="Particle effect preview" />
      <div className="preview-bar">
        <button disabled={!effect} onClick={() => setPlayCount((count) => count + 1)}>
          ▶ Play
        </button>
        <label>
          Background{" "}
          <input
            type="color"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
          />
        </label>
      </div>
    </section>
  );
}

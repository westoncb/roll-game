import { useEffect, useRef, useState, type RefObject } from "react";
import type { vec2 } from "gl-matrix";
import { gameKeys, updateGame, type GameState } from "../game";
import { clientToWorld, listenForInput } from "../engine/input";
import { loadLevel } from "../level-loader";
import type { Level } from "../level";
import { approach } from "../utils/math";
import type { HoverTarget, PlayerGun } from "../player/gun";
import { AimReticle } from "./AimReticle";

type Hud = {
  you: number;
  rival: number | null;
  health: number;
  rivalHealth: number;
  shotPhase: PlayerGun["phase"];
  hoverTarget: HoverTarget | null;
  hint: string | null;
  result: string | null;
};

function roundSummary({ player, rival, result }: Level) {
  if (!result) return null;
  if (!rival) return "Knocked out by fungus";
  const winner =
    player.score === rival.score
      ? "Draw"
      : player.score > rival.score
        ? "You win"
        : "Rival wins";
  return `${winner} · All gems collected`;
}

function playHint({ player, rival }: Level) {
  if (player.respawnRemaining)
    return `You respawn in ${Math.ceil(player.respawnRemaining)}s`;
  if (rival?.respawnRemaining)
    return `Rival respawns in ${Math.ceil(rival.respawnRemaining)}s`;
  if (player.spawnProtection && rival?.spawnProtection) return "Both robots respawned";
  if (player.spawnProtection) return "You respawned";
  if (rival?.spawnProtection) return "Rival respawned";
  return null;
}

function canvasLabel(hud: Hud | null) {
  if (!hud) return "Game canvas";
  const you = `You: ${hud.you} points, ${hud.health} health.`;
  const rival =
    hud.rival === null ? "" : ` Rival: ${hud.rival} points, ${hud.rivalHealth} health.`;
  return `Game canvas. ${you}${rival}`;
}

export function Game() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<vec2 | null>(null);
  const pauseMenuRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [hud, setHud] = useState<Hud | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const menu = pauseMenuRef.current;
    if (!host || !canvas || !menu) return;

    const controller = new AbortController();
    let session: ReturnType<typeof startGame> | undefined;
    const togglePause = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p" && event.key !== "Escape") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      if (event.repeat) return;
      if (menu.open) {
        menu.close();
      } else {
        menu.showModal();
        session?.pause();
      }
    };
    const resume = () => {
      if (menu.open) return;
      session?.resume();
      canvas.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", togglePause, { signal: controller.signal });
    menu.addEventListener("close", resume, { signal: controller.signal });
    loadLevel("test", controller.signal)
      .then((level) => {
        if (!controller.signal.aborted) {
          session = startGame(host, canvas, { level }, pointerRef, setHud);
          if (menu.open) session.pause();
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      controller.abort();
      session?.stop();
    };
  }, [attempt]);

  return (
    <div id="game-host" ref={hostRef}>
      {error && (
        <p className="game-error" role="alert">
          Could not start the game. {error}
        </p>
      )}
      <canvas
        id="game-canvas"
        className={hud && hud.health > 0 && !hud.result ? "in-play" : undefined}
        ref={canvasRef}
        tabIndex={0}
        aria-label={canvasLabel(hud)}
      />
      <AimReticle
        canvasRef={canvasRef}
        pointerRef={pointerRef}
        phase={hud?.shotPhase ?? "idle"}
        target={hud?.hoverTarget ?? null}
      />
      <div className="damage-border fungal-border" aria-hidden="true" />
      <div className="damage-border punch-border" aria-hidden="true" />
      {hud?.hint && !hud.result && (
        <div className="duel-hint" role="status">
          {hud.hint}
        </div>
      )}
      {hud?.result && (
        <div className="fungal-contact">
          <span role="status">{hud.result}</span>
          <button
            type="button"
            onClick={() => {
              setHud(null);
              setAttempt((n) => n + 1);
            }}
          >
            {hud.rival === null ? "Restart level" : "Play again"}
          </button>
        </div>
      )}
      <dialog className="pause-menu" ref={pauseMenuRef} aria-labelledby="pause-title">
        <h1 id="pause-title">Game paused</h1>
        <form method="dialog">
          <button type="submit" autoFocus>
            Resume game
          </button>
        </form>
        <a href="/editor">Level editor</a>
      </dialog>
    </div>
  );
}

const stepSeconds = 1 / 60;

function startGame(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  game: GameState,
  pointerRef: RefObject<vec2 | null>,
  onHud: (hud: Hud) => void
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const { level } = game;
  const { camera } = level;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const viewport = window.visualViewport;
  const fitHost = () => {
    if (!viewport) return;
    host.style.width = `${viewport.width}px`;
    host.style.height = `${viewport.height}px`;
    host.style.left = `${viewport.offsetLeft}px`;
    host.style.top = `${viewport.offsetTop}px`;
  };
  const fitCanvas = (available: DOMRectReadOnly) => {
    camera.fit(available);
    canvas.style.width = `${camera.width}px`;
    canvas.style.height = `${camera.height}px`;
  };
  fitHost();
  fitCanvas(host.getBoundingClientRect());
  const observer = new ResizeObserver(([entry]) => fitCanvas(entry.contentRect));
  observer.observe(host);
  viewport?.addEventListener("resize", fitHost);
  viewport?.addEventListener("scroll", fitHost);

  const { input, stopInput } = listenForInput(
    canvas,
    camera,
    gameKeys,
    () => pointerRef.current
  );
  let previousHud: Hud | undefined;
  const syncHud = () => {
    const you = level.player.score,
      rival = level.rival?.score ?? null;
    const health = Math.ceil(level.player.health),
      rivalHealth = Math.ceil(level.rival?.health ?? 0);
    const hint = playHint(level);
    const result = roundSummary(level);
    const shotPhase = level.player.gun.phase;
    const pointer = pointerRef.current;
    const hoverTarget =
      pointer && health > 0 && !result && shotPhase === "idle" && camera.zoom > 0
        ? level.player.gun.hoverTarget(clientToWorld(canvas, camera, pointer))
        : null;
    if (
      previousHud &&
      previousHud.you === you &&
      previousHud.rival === rival &&
      previousHud.health === health &&
      previousHud.rivalHealth === rivalHealth &&
      previousHud.shotPhase === shotPhase &&
      previousHud.hoverTarget === hoverTarget &&
      previousHud.hint === hint &&
      previousHud.result === result
    )
      return;
    previousHud = { you, rival, health, rivalHealth, shotPhase, hoverTarget, hint, result };
    onHud(previousHud);
  };
  syncHud();
  let previousTime: number | undefined;
  let previousBorderOpacity = 0;
  let fungalBorderStrength = 0;
  let accumulator = 0;
  let frameId: number | undefined;

  const frame = (now: number) => {
    const frameSeconds = Math.min(now - (previousTime ?? now), 50) / 1000;
    accumulator += frameSeconds;
    previousTime = now;
    while (accumulator >= stepSeconds) {
      updateGame(game, input, stepSeconds);
      input.changes.length = 0;
      accumulator -= stepSeconds;
    }

    const density = window.devicePixelRatio * (viewport?.scale ?? 1);
    const width = Math.round(camera.width * density);
    const height = Math.round(camera.height * density);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (width > 0 && height > 0) {
      ctx.resetTransform();
      ctx.fillStyle = "#112233";
      ctx.fillRect(0, 0, width, height);
      // Account for the whole-pixel rounding of each bitmap dimension.
      ctx.scale(width / camera.width, height / camera.height);
      const alpha = accumulator / stepSeconds;
      level.draw(ctx, alpha, reducedMotion.matches);
      const borderOpacity = level.presentation.impactBorderOpacity(alpha);
      if (borderOpacity !== previousBorderOpacity) {
        host.style.setProperty("--impact-border-opacity", String(borderOpacity));
        previousBorderOpacity = borderOpacity;
      }
      const fungalExposure = level.fungalExposureAt(alpha);
      if (fungalBorderStrength !== fungalExposure) {
        const fadeSeconds = fungalExposure > fungalBorderStrength ? 0.18 : 0.32;
        fungalBorderStrength = approach(
          fungalBorderStrength,
          fungalExposure,
          frameSeconds / fadeSeconds
        );
        host.style.setProperty("--fungal-border-strength", String(fungalBorderStrength));
      }
    }
    syncHud();
    frameId = requestAnimationFrame(frame);
  };

  const resume = () => {
    if (frameId !== undefined) return;
    previousTime = undefined;
    frameId = requestAnimationFrame(frame);
  };
  const pause = () => {
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
  };
  resume();
  return {
    pause,
    resume,
    stop() {
      pause();
      host.style.removeProperty("--impact-border-opacity");
      host.style.removeProperty("--fungal-border-strength");
      stopInput();
      observer.disconnect();
      viewport?.removeEventListener("resize", fitHost);
      viewport?.removeEventListener("scroll", fitHost);
    }
  };
}

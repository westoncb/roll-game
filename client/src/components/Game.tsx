import { useEffect, useRef, useState } from "react";
import { Camera } from "../engine/camera";
import { gameKeys, updateGame, type GameState } from "../game";
import { listenForInput } from "../engine/input";
import { loadLevel } from "../level-loader";
import type { Level } from "../level";
import { knockoutPoints } from "../player/config";

type Hud = {
  you: number;
  rival: number | null;
  hint: string | null;
  result: string | null;
};

function roundSummary({ player, rival, result }: Level) {
  if (!result) return null;
  if (!rival) return "Fungal contact";
  const winner =
    player.score === rival.score
      ? "Draw"
      : player.score > rival.score
        ? "You win"
        : "Rival wins";
  return `${winner} · All gems collected`;
}

function playHint({ player, rival }: Level) {
  if (player.gun.tethered)
    return "Rival hooked · Hold F to aim the throw, release to launch";
  if (rival?.gun.tethered) return "You’re hooked · Get behind terrain to break the cable";
  if (player.spawnProtection && rival?.spawnProtection) return "Both robots respawned";
  if (player.spawnProtection) return "You respawned";
  if (rival?.spawnProtection) return "Rival respawned";
  return null;
}

export function Game() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [hud, setHud] = useState<Hud | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!host || !canvas) return;

    const controller = new AbortController();
    let stopGame: (() => void) | undefined;
    loadLevel("test", controller.signal)
      .then((level) => {
        if (!controller.signal.aborted) {
          stopGame = startGame(host, canvas, { level }, setHud);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      controller.abort();
      stopGame?.();
    };
  }, [attempt]);

  return error ? (
    <p role="alert">Could not start the game. {error}</p>
  ) : (
    <div id="game-host" ref={hostRef}>
      <canvas id="game-canvas" ref={canvasRef} tabIndex={0} aria-label="Game canvas" />
      {hud && hud.rival !== null && (
        <div className="duel-score" aria-label="Scores">
          <span className="team-score you">
            You <b>{hud.you}</b>
          </span>
          <span className="team-score rival">
            Rival <b>{hud.rival}</b>
          </span>
          <span className="score-rules">
            Gem +1 · Opponent falls into fungus +{knockoutPoints}
          </span>
        </div>
      )}
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
    </div>
  );
}

const stepSeconds = 1 / 60;

function startGame(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  game: GameState,
  onHud: (hud: Hud) => void
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");

  const camera = new Camera(game.level.size);
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

  const { input, stopInput } = listenForInput(canvas, camera, gameKeys);
  const { level } = game;
  let previousHud: Hud | undefined;
  const syncHud = () => {
    const you = level.player.score,
      rival = level.rival?.score ?? null;
    const hint = playHint(level);
    const result = roundSummary(level);
    if (
      previousHud &&
      previousHud.you === you &&
      previousHud.rival === rival &&
      previousHud.hint === hint &&
      previousHud.result === result
    )
      return;
    previousHud = { you, rival, hint, result };
    onHud(previousHud);
  };
  syncHud();
  let previousTime: number | undefined;
  let accumulator = 0;
  let frameId: number;

  const frame = (now: number) => {
    accumulator += Math.min(now - (previousTime ?? now), 50) / 1000;
    previousTime = now;
    while (accumulator >= stepSeconds) {
      updateGame(game, input, stepSeconds);
      syncHud();
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
      camera.applyTo(ctx);
      game.level.draw(ctx, accumulator / stepSeconds);
    }
    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(frameId);
    stopInput();
    observer.disconnect();
    viewport?.removeEventListener("resize", fitHost);
    viewport?.removeEventListener("scroll", fitHost);
  };
}

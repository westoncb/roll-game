import { useEffect, useRef, useState } from "react";
import { settings } from "../settings";
import { Camera } from "../engine/camera";
import { gameKeys, updateGame, type GameState } from "../game";
import { listenForInput } from "../engine/input";
import { loadLevel } from "../level-loader";
import type { Level } from "../level";
import { knockoutPoints, maxHealth } from "../player/config";

type Hud = {
  you: number;
  rival: number | null;
  health: number;
  rivalHealth: number;
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

function RobotVitals({
  team,
  score,
  health
}: {
  team: "you" | "rival";
  score: number;
  health: number;
}) {
  const name = team === "you" ? "You" : "Rival";
  const fill = { transform: `scaleX(${health / maxHealth})` };
  return (
    <div className={`team-score ${team}`}>
      <div className="score-line">
        <span>{name}</span>
        <b aria-label={`${name}, ${score} points`}>{score}</b>
      </div>
      <div className="health-line">
        <div
          className="health-track"
          role="meter"
          aria-label={`${name === "You" ? "Your" : "Rival"} health`}
          aria-valuemin={0}
          aria-valuemax={maxHealth}
          aria-valuenow={health}
        >
          <span className="health-trail" style={fill} />
          <span className="health-fill" style={fill} />
        </div>
        <span className="health-value">{health} HP</span>
      </div>
    </div>
  );
}

export function Game() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
          session = startGame(host, canvas, { level }, setHud);
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
      <canvas id="game-canvas" ref={canvasRef} tabIndex={0} aria-label="Game canvas" />
      {hud && (
        <div className="duel-score" aria-label="Score and health">
          <RobotVitals team="you" score={hud.you} health={hud.health} />
          {hud.rival !== null && (
            <>
              <RobotVitals team="rival" score={hud.rival} health={hud.rivalHealth} />
              <span className="score-rules">Gem +1 · Knockout +{knockoutPoints}</span>
            </>
          )}
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
      <dialog className="pause-menu" ref={pauseMenuRef} aria-labelledby="pause-title">
        <h1 id="pause-title">Game paused</h1>
        <form method="dialog">
          <button type="submit" autoFocus>
            Resume game
          </button>
        </form>
        <a href="/editor">Level editor</a>
        <label className="pause-gravity">
          Airborne gravity
          <select
            defaultValue={settings.airGravity}
            onChange={(event) => {
              settings.airGravity =
                event.currentTarget.value === "field" ? "field" : "down";
            }}
          >
            <option value="down">Downward</option>
            <option value="field">Terrain field</option>
          </select>
        </label>
      </dialog>
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

  const { input, stopInput } = listenForInput(canvas, camera, gameKeys);
  const { level } = game;
  let previousHud: Hud | undefined;
  const syncHud = () => {
    const you = level.player.score,
      rival = level.rival?.score ?? null;
    const health = Math.ceil(level.player.health),
      rivalHealth = Math.ceil(level.rival?.health ?? 0);
    const hint = playHint(level);
    const result = roundSummary(level);
    if (
      previousHud &&
      previousHud.you === you &&
      previousHud.rival === rival &&
      previousHud.health === health &&
      previousHud.rivalHealth === rivalHealth &&
      previousHud.hint === hint &&
      previousHud.result === result
    )
      return;
    previousHud = { you, rival, health, rivalHealth, hint, result };
    onHud(previousHud);
  };
  syncHud();
  let previousTime: number | undefined;
  let accumulator = 0;
  let frameId: number | undefined;

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
      camera.shake(reducedMotion.matches ? 0 : level.shake, now / 1000);
      camera.applyTo(ctx);
      game.level.draw(ctx, accumulator / stepSeconds);
    }
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
      stopInput();
      observer.disconnect();
      viewport?.removeEventListener("resize", fitHost);
      viewport?.removeEventListener("scroll", fitHost);
    }
  };
}

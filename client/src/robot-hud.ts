import { HealthPopup } from "./health-popup";
import { maxHealth } from "./player/config";
import type { Player } from "./player/player";
import type { GameEvents } from "./game-events";
import { lerp } from "./utils/math";

const scoreGrowSeconds = 0.12;
const scoreRollSeconds = 0.48;
const scoreShrinkSeconds = 0.22;
const expandedScoreScale = 1.18;

function easedProgress(elapsed: number, duration: number) {
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return t * t * (3 - 2 * t);
}

function drawOutlinedText(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.strokeText(text, 0, y);
  ctx.fillText(text, 0, y);
}

export class RobotHud {
  private lastChange = -Infinity;
  private growthAtChange = 0;
  private fungalDelta = 0;
  private fungusSince = 0;
  private scoreFrom = 0;
  private scoreScaleFrom = 1;
  private scoredAt = -Infinity;

  constructor(
    private readonly player: Player,
    private readonly human: boolean,
    private readonly bounds: { width: number; height: number },
    private readonly addPopup: (popup: HealthPopup) => void
  ) {}

  scored(before: number, time: number) {
    if (!this.human) return;
    // If another award arrives mid-roll, pick up at the visible number and size.
    this.scoreFrom = this.rollingScore(time, before);
    this.scoreScaleFrom = this.scoreScale(time);
    this.scoredAt = time;
  }

  private rollingScore(time: number, total: number) {
    const progress = easedProgress(
      time - this.scoredAt - scoreGrowSeconds,
      scoreRollSeconds
    );
    return progress === 1 ? total : lerp(this.scoreFrom, total, progress);
  }

  private scoreScale(time: number) {
    const age = time - this.scoredAt;
    if (age < scoreGrowSeconds)
      return lerp(
        this.scoreScaleFrom,
        expandedScoreScale,
        easedProgress(age, scoreGrowSeconds)
      );
    return lerp(
      expandedScoreScale,
      1,
      easedProgress(age - scoreGrowSeconds - scoreRollSeconds, scoreShrinkSeconds)
    );
  }

  healthChanged(
    { before, after, source, position }: GameEvents["healthChanged"],
    time: number
  ) {
    const delta = after - before;
    this.growthAtChange = this.meterGrowth(time);
    this.lastChange = time;
    if (source.kind === "fungus") {
      if (this.fungalDelta === 0) this.fungusSince = time;
      this.fungalDelta += delta;
    } else {
      this.addPopup(
        new HealthPopup(position, this.player.body.radius, delta, source, time, this.bounds)
      );
    }
  }

  flushFungalDamage(time: number, roundOver: boolean) {
    if (!this.fungalDelta) return;
    if (
      this.player.inFungus &&
      this.player.health > 0 &&
      !roundOver &&
      time - this.fungusSince < 0.25
    )
      return;
    this.addPopup(
      new HealthPopup(
        this.player.body.pos,
        this.player.body.radius,
        this.fungalDelta,
        { kind: "fungus" },
        time,
        this.bounds
      )
    );
    this.fungalDelta = 0;
  }

  private meterGrowth(time: number) {
    const age = Math.max(0, time - this.lastChange);
    if (age < 0.1) return lerp(this.growthAtChange, 1, age / 0.1);
    return 1 - Math.min(1, Math.max(0, (age - 0.48) / 0.32));
  }

  draw(
    ctx: CanvasRenderingContext2D,
    time: number,
    zoom: number,
    reducedMotion: boolean,
    largestDuelScore?: number
  ) {
    const color = this.human ? "#ffaaa7" : "#82eddf";
    ctx.save();
    if (this.player.health > 0) {
      const grow = this.meterGrowth(time);
      const w = 54;
      const h = lerp(3, 7, grow);
      const [x, y] = this.player.visual.renderPosition;
      const left = Math.max(2, Math.min(this.bounds.width - w - 2, x - w / 2));
      const top = Math.max(3, y - this.player.body.radius - 8 - h);
      ctx.fillStyle = "#101921";
      ctx.fillRect(left - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = "#43505c";
      ctx.fillRect(left, top, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(left, top, (w * this.player.health) / maxHealth, h);
    }
    this.drawScore(ctx, time, zoom, color, reducedMotion, largestDuelScore);
    ctx.restore();
  }

  private drawScore(
    ctx: CanvasRenderingContext2D,
    time: number,
    zoom: number,
    color: string,
    reducedMotion: boolean,
    largestDuelScore?: number
  ) {
    const scale = Math.max(1, 0.72 / zoom);
    const total = this.player.score;
    const numberFont = "800 36px system-ui, sans-serif";
    ctx.font = numberFont;
    const width = Math.max(
      52,
      ctx.measureText(String(largestDuelScore ?? total)).width + 12
    );
    // Use equal columns, with room for the human score to grow toward the center.
    const offset =
      largestDuelScore === undefined
        ? 0
        : ((width * expandedScoreScale) / 2 + 6) * (this.human ? -1 : 1);
    ctx.translate(this.bounds.width / 2 + offset * scale, 16 * scale);
    const textScale = scale * (reducedMotion ? 1 : this.scoreScale(time));
    ctx.scale(textScale, textScale);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#101820";
    ctx.lineWidth = 4;
    ctx.font = "750 14px system-ui, sans-serif";
    ctx.fillStyle = color;
    drawOutlinedText(ctx, this.human ? "YOU" : "RIVAL", 9);

    const rowHeight = 44;
    const rowTop = 21;
    ctx.beginPath();
    ctx.rect(-width / 2, rowTop, width, rowHeight);
    ctx.clip();
    ctx.font = numberFont;
    ctx.lineWidth = 6;
    ctx.fillStyle = "#fff4de";
    const value = reducedMotion ? total : this.rollingScore(time, total);
    const whole = Math.floor(value);
    const fraction = value - whole;
    const y = rowTop + rowHeight * (0.5 - fraction);
    drawOutlinedText(ctx, String(whole), y);
    if (fraction > 0) drawOutlinedText(ctx, String(whole + 1), y + rowHeight);
  }
}

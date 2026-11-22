import { seededRandom } from "./utils/math";

const width = 1360;
const height = 720;
const spacing = 13;
const step = 3;
const colors = ["#6caca9", "#83aab7", "#8294b4"];

type Current = {
  path: Path2D;
  color: string;
  opacity: number;
  offset: number;
  speed: number;
  dash: number[];
};

// The two crossing waves bend neighboring traces around the same eddies.
function heading(x: number, y: number) {
  const ripple = 0.27 * Math.cos(x / 81 + y / 113);
  return Math.atan2(
    0.84 * Math.cos(x / 125 + 0.68 * Math.sin(y / 140)) - ripple,
    0.38 + Math.sin(y / 88 + 0.7 * Math.sin(x / 190)) + ripple
  );
}

export class FlowBackground {
  private readonly currents: Current[];

  constructor() {
    const random = seededRandom(713);
    // Group traces with the same ink and speed into one canvas stroke.
    const inks = colors.map((color) =>
      Array.from({ length: 8 }, () => ({
        path: new Path2D(),
        color,
        opacity: 0.15 + 0.12 * random(),
        offset: random() * 90,
        speed: 5 + 6 * random(),
        dash: [7 + random() * 15, 14 + random() * 24]
      }))
    );
    this.currents = inks.flat();
    const cols = Math.ceil(width / spacing);
    const rows = Math.ceil(height / spacing);
    const occupied = new Uint8Array(cols * rows);
    const cells = Array.from(occupied.keys());
    // Seed in scattered order so a sweep from one edge doesn't set the grain.
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (const cell of cells) {
      if (occupied[cell]) continue;
      let x = ((cell % cols) + random()) * spacing;
      let y = (Math.floor(cell / cols) + random()) * spacing;
      const hue = Math.sin(x / 250 + y / 145) + (random() - 0.5) * 0.45;
      const group = inks[hue < -0.35 ? 0 : hue > 0.5 ? 2 : 1];
      const { path } = group[Math.floor(random() * group.length)];
      let lastCell = cell;
      const steps = 20 + Math.floor(random() * 45);
      path.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        const angle = heading(x, y);
        const mid = heading(
          x + (Math.cos(angle) * step) / 2,
          y + (Math.sin(angle) * step) / 2
        );
        x += step * Math.cos(mid);
        y += step * Math.sin(mid);
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        const nextCell = Math.floor(y / spacing) * cols + Math.floor(x / spacing);
        if (nextCell !== lastCell && occupied[nextCell]) break;
        path.lineTo(x, y);
        occupied[lastCell] = occupied[nextCell] = 1;
        lastCell = nextCell;
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    size: { width: number; height: number },
    time: number
  ) {
    ctx.save();
    ctx.scale(size.width / width, size.height / height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.25;
    for (const current of this.currents) {
      ctx.strokeStyle = current.color;
      ctx.globalAlpha = current.opacity;
      ctx.setLineDash(current.dash);
      ctx.lineDashOffset = current.offset - current.speed * time;
      ctx.stroke(current.path);
    }
    ctx.restore();
  }
}

import type { FiberPoint, FiberSegment } from "./network";

// Each row balances inflow, nutrient uptake, and finite gem output. A row's load
// drains to zero; its source adds a load of equal magnitude tied to supply one.
class Row {
  point!: FiberPoint;
  parent?: Row;
  treeEdge?: FiberSegment;
  // Keep loop endpoints and the tree junctions connecting them. All other rows
  // have at most one retained descendant after their own children are reduced.
  keep = false;
  arms = 0;
  child?: Row;
  childG = 0;
  load = 0;
  rhs = 0;
  offset = 0;
  parentWeight = 0;
  childWeight = 0;
  // Jacobi-preconditioned conjugate gradient on the remaining junctions.
  diagonal = 0;
  residual = 0;
  direction = 0;
  product = 0;

  reset(
    p: FiberPoint,
    parent: Row | undefined,
    edge: FiberSegment | undefined,
    output: number
  ) {
    this.point = p;
    this.parent = parent;
    this.treeEdge = edge;
    this.keep = !parent;
    this.arms = 0;
    this.child = undefined;
    this.childG = 0;
    this.rhs = p.source ? output : 0;
    this.load = this.rhs;
    for (const s of p.incident) this.load += s.demand / 2;
  }
}

type Link = { a: Row; b: Row; g: number };

export class NutrientSolver {
  private readonly rows: Row[] = [];
  private readonly links: Link[] = [];
  private readonly core: Row[] = [];
  private count = 0;

  private visit(
    p: FiberPoint,
    parent: Row | undefined,
    edge: FiberSegment | undefined,
    output: number
  ) {
    p.row = this.count++;
    const r = (this.rows[p.row] ??= new Row());
    r.reset(p, parent, edge, output);
  }

  solve(points: Iterable<FiberPoint>, sources: ReadonlySet<FiberPoint>, output: number) {
    for (const p of points) {
      p.row = -1;
      p.supply = 0;
    }
    this.count = 0;
    this.core.length = this.links.length = 0;

    // Only sourced components need a solve. A spanning tree identifies pendant trees,
    // chains and the endpoints of independent loops, including parallel strands.
    for (const source of sources) {
      if (source.row >= 0) continue;
      const start = this.count;
      this.visit(source, undefined, undefined, output);
      for (let i = start; i < this.count; i++) {
        const r = this.rows[i];
        for (const s of r.point.incident) {
          const other = s.from === r.point ? s.to : s.from;
          if (other.row < 0) this.visit(other, r, s, output);
          else if (other.row > i) {
            const q = this.rows[other.row];
            if (q.treeEdge === s) continue;
            r.keep = q.keep = true;
            this.links.push({ a: r, b: q, g: s.conductance });
          }
        }
      }
    }
    // Drop references to disconnected tissue when a colony shrinks.
    this.rows.length = this.count;

    for (let i = this.count - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.arms > 1) r.keep = true;
      if (r.parent && (r.keep || r.arms)) r.parent.arms++;
    }

    // Eliminate leaves and two-terminal chains exactly. Eliminating i between p
    // and c adds g_pi*g_ic/D to their connection and distributes i's source/load.
    for (let i = this.count - 1; i >= 0; i--) {
      const r = this.rows[i],
        p = r.parent;
      if (r.keep) this.core.push(r);
      if (!p) continue;
      let g = r.treeEdge!.conductance;
      let terminal: Row | undefined = r;
      if (!r.keep) {
        const d = r.load + g + r.childG;
        r.offset = r.rhs / d;
        r.parentWeight = g / d;
        r.childWeight = r.childG / d;
        p.load += r.load * r.parentWeight;
        p.rhs += r.rhs * r.parentWeight;
        terminal = r.child;
        if (terminal) {
          terminal.load += r.load * r.childWeight;
          terminal.rhs += r.rhs * r.childWeight;
        }
        g *= r.childWeight;
      }
      if (terminal) {
        if (p.keep) this.links.push({ a: p, b: terminal, g });
        else {
          p.child = terminal;
          p.childG = g;
        }
      }
    }

    this.solveCore();
    // Back-substitute the supply along each actual strand, including fine minor trees.
    for (const r of this.rows) {
      if (!r.keep)
        r.point.supply =
          r.offset +
          r.parentWeight * r.parent!.point.supply +
          r.childWeight * (r.child?.point.supply ?? 0);
      r.point.supply = Math.max(0, Math.min(1, r.point.supply));
    }
  }

  private solveCore() {
    for (const r of this.core) r.diagonal = r.load;
    for (const { a, b, g } of this.links) {
      a.diagonal += g;
      b.diagonal += g;
    }
    let norm = 0;
    for (const r of this.core) {
      r.residual = r.rhs;
      r.direction = r.rhs / r.diagonal;
      norm += r.residual * r.direction;
    }
    const tolerance = norm * 1e-14;
    for (let i = 0; norm > tolerance && i < 2 * this.core.length; i++) {
      for (const r of this.core) r.product = r.load * r.direction;
      for (const { a, b, g } of this.links) {
        const flow = g * (a.direction - b.direction);
        a.product += flow;
        b.product -= flow;
      }
      let curvature = 0;
      for (const r of this.core) curvature += r.direction * r.product;
      if (curvature <= 0) break;
      const step = norm / curvature;
      let nextNorm = 0;
      for (const r of this.core) {
        r.point.supply += step * r.direction;
        r.residual -= step * r.product;
        nextNorm += (r.residual * r.residual) / r.diagonal;
      }
      for (const r of this.core)
        r.direction = r.residual / r.diagonal + (nextNorm / norm) * r.direction;
      norm = nextNorm;
    }
  }
}

import { vec2 } from "gl-matrix";

export type GroundEdge = {
  ground: GroundPolygon;
  index: number;
  a: vec2;
  b: vec2;
  length: number;
  tangent: vec2;
  normal: vec2;
};

export class GroundPolygon {
  readonly vertices: vec2[];
  private drawVertices: vec2[];
  readonly gravityScale: number;
  readonly edges: GroundEdge[];

  constructor(
    vertices: vec2[],
    gravityScale: number,
    private readonly extendToCanvas = false
  ) {
    vertices = vertices.filter(
      (v, i) => !vec2.exactEquals(v, vertices[(i + 1) % vertices.length])
    );
    this.gravityScale = gravityScale;
    let twiceArea = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      twiceArea += a[0] * b[1] - a[1] * b[0];
    }
    if (!twiceArea) throw new Error("A ground polygon must enclose an area.");
    // Clockwise in canvas coordinates: positive travel walks right across a floor.
    this.vertices = twiceArea > 0 ? vertices : vertices.reverse();
    this.drawVertices = this.vertices;
    this.edges = this.vertices.map((a, index) => {
      const b = this.vertices[(index + 1) % this.vertices.length];
      const tangent = vec2.subtract(vec2.create(), b, a);
      const length = vec2.length(tangent);
      vec2.scale(tangent, tangent, 1 / length);
      const normal = vec2.fromValues(tangent[1], -tangent[0]);
      return { ground: this, index, a, b, tangent, normal, length };
    });
  }

  fitExterior(min: vec2, max: vec2, extraX: number, extraY: number) {
    if (!this.extendToCanvas) return;
    this.drawVertices = this.vertices.map(([x, y]) =>
      vec2.fromValues(
        x === min[0] ? x - extraX : x === max[0] ? x + extraX : x,
        y === min[1] ? y - extraY : y === max[1] ? y + extraY : y
      )
    );
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    const first = this.drawVertices[0];
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < this.drawVertices.length; i++) {
      const vertex = this.drawVertices[i];
      ctx.lineTo(vertex[0], vertex[1]);
    }
    ctx.closePath();
    ctx.fillStyle = "#375555";
    ctx.fill();
    ctx.strokeStyle = "#90afa0";
    ctx.stroke();
  }
}

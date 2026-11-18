import { vec2 } from "gl-matrix";

export class GroundPolygon {
  readonly vertices: vec2[];
  readonly gravityScale: number;
  readonly winding: number;

  constructor(vertices: vec2[], gravityScale: number) {
    this.vertices = vertices;
    this.gravityScale = gravityScale;
    let twiceArea = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      twiceArea += a[0] * b[1] - a[1] * b[0];
    }
    if (!twiceArea) throw new Error("A ground polygon must enclose an area.");
    this.winding = Math.sign(twiceArea);
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    const first = this.vertices[0];
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < this.vertices.length; i++) {
      const vertex = this.vertices[i];
      ctx.lineTo(vertex[0], vertex[1]);
    }
    ctx.closePath();
    ctx.fillStyle = "#375555";
    ctx.fill();
    ctx.strokeStyle = "#90afa0";
    ctx.stroke();
  }
}

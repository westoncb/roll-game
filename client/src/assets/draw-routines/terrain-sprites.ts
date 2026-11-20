// Each row is one pixel high. Dots leave the underlying terrain visible.
export const pebbles = [
  ["...aa.......", "..ahhaa..aa.", ".ahssssaassa", "asssssdaassd", ".dddddd.ddd."],
  [".....aa....", "...ahhha...", "..ahssssa..", ".asssddssa.", ".assdddddd.", "aadddddddda"]
];

export const mushrooms = [
  [
    "...ccc....",
    "..cchcc...",
    ".cchcccc..",
    "ccccccccc.",
    ".dhddhhdd.",
    "....pt....",
    "....tp....",
    "....tp....",
    "...ttp...."
  ],
  [
    "......ccc....",
    ".....cchcc...",
    "....ccchccc..",
    "...ccccccccc.",
    "....ddhhddd..",
    "......tp.....",
    "..cc..pt.....",
    ".chcc.pt.....",
    "ccccc..pt....",
    ".ddhd..tp....",
    "...tp..ttp..."
  ]
];

export const buriedRocks = [
  [
    "......aaaaa.....",
    "...aaahhhssaa...",
    "..ahhssssssssa..",
    ".assssssssddssa.",
    ".assssdddddsssd.",
    "..asdddddddddd..",
    "...addd....dd..."
  ],
  [
    "......aa........",
    "....ahhsa.......",
    "..ahhsssd..aaa..",
    ".asssssdd.ahssa.",
    "..assddd..asssd.",
    "...addd....ddd.."
  ],
  ["..aaaa..........", ".ahsssaa....aa..", "..assssssa.ahsa.", "...adddddd..dd.."]
];

export const bones = [
  [
    ".bb.............",
    "bhhb.........bb.",
    ".bhhbb......bhhb",
    ".bbdbhhbb..bhbb.",
    ".....bbbhhhbb...",
    "........bbddbb..",
    "............b..."
  ],
  [
    "..bb............",
    ".bhbb..b........",
    "..bbb.bhb..b....",
    "...bhhbb..bhb...",
    "...b.bhhbbbbb..b",
    "..bb..b.bhhbbbbb",
    ".bh..bb..b..bb..",
    ".b..bh..bb......",
    "....b..bh.......",
    ".......b........"
  ]
];

export interface TerrainStamp {
  image: HTMLCanvasElement;
  transform: DOMMatrix;
}

/** Bake each palette-indexed sprite once per style. The anchor is zero at its top. */
export function terrainStamp(palette: Readonly<Record<string, string>>, anchorY: number) {
  const images = new Map<readonly string[], HTMLCanvasElement>();
  return (
    sprite: readonly string[],
    x: number,
    y: number,
    width: number,
    degrees: number,
    flip: boolean
  ): TerrainStamp => {
    let image = images.get(sprite);
    if (!image) {
      image = document.createElement("canvas");
      image.width = Math.max(...sprite.map((row) => row.length));
      image.height = sprite.length;
      const paint = image.getContext("2d")!;
      for (const [row, line] of sprite.entries()) {
        for (let col = 0; col < line.length; col++) {
          const symbol = line[col];
          if (symbol === ".") continue;
          paint.fillStyle = palette[symbol];
          paint.fillRect(col, row, 1, 1);
        }
      }
      images.set(sprite, image);
    }
    const scale = width / image.width;
    const transform = new DOMMatrix()
      .translateSelf(x, y)
      .rotateSelf(degrees)
      .scaleSelf(flip ? -scale : scale, scale)
      .translateSelf(-image.width / 2, -anchorY * image.height);
    return { image, transform };
  };
}

export function drawTerrainStamps(
  ctx: CanvasRenderingContext2D,
  stamps: readonly TerrainStamp[]
) {
  ctx.imageSmoothingEnabled = false;
  for (const { image, transform: m } of stamps) {
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
}

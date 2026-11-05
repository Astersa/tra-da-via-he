// Sinh placeholder art M1 (§3.8): hình khối đơn giản, màu lấy từ apps/web/src/theme/tokens.ts.
// Không tải gì từ internet, không dùng ảnh concept. Chạy: pnpm exec tsx scripts/gen-placeholder-art.ts [outDir]
// Kết quả tất định: chạy lại cho ra đúng từng byte. Mặc định ghi vào apps/web/public/assets.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { tokens, type TokenName } from "../apps/web/src/theme/tokens";

type RGB = [number, number, number];
interface Img {
  w: number;
  h: number;
  d: Buffer;
}

const hex = (name: TokenName): RGB => {
  const v = tokens[name];
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
};
const OUTLINE = hex("brown-900");

const blank = (w: number, h: number): Img => ({ w, h, d: Buffer.alloc(w * h * 4) });

function put(img: Img, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.d[i] = c[0];
  img.d[i + 1] = c[1];
  img.d[i + 2] = c[2];
  img.d[i + 3] = 255;
}

function rect(img: Img, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(img, xx, yy, c);
}

function frame(img: Img, x: number, y: number, w: number, h: number, c: RGB = OUTLINE): void {
  rect(img, x, y, w, 1, c);
  rect(img, x, y + h - 1, w, 1, c);
  rect(img, x, y, 1, h, c);
  rect(img, x + w - 1, y, 1, h, c);
}

// Đĩa tại tâm (cx, cy) với tâm pixel ở +0.5.
function disc(img: Img, cx: number, cy: number, r: number, c: RGB): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) put(img, x, y, c);
    }
}

// Đĩa có viền 1px màu OUTLINE.
function discOutlined(img: Img, cx: number, cy: number, r: number, c: RGB): void {
  disc(img, cx, cy, r, OUTLINE);
  disc(img, cx, cy, r - 1.2, c);
}

function tri(img: Img, p: [number, number][], c: RGB): void {
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d1 = sign(px, py, p[0]![0], p[0]![1], p[1]![0], p[1]![1]);
      const d2 = sign(px, py, p[1]![0], p[1]![1], p[2]![0], p[2]![1]);
      const d3 = sign(px, py, p[2]![0], p[2]![1], p[0]![0], p[0]![1]);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) put(img, x, y, c);
    }
}

function toPng(img: Img): Buffer {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.d);
  return PNG.sync.write(png);
}

// --- Tileset street: 6 tile 32×32 theo thứ tự tileId 0..5 (khớp gen-street-01.ts). ---
const TILE_NAMES = ["pavement", "road", "curb", "grass", "wall", "blocked"] as const;

function buildStreet(): Img {
  const img = blank(32 * TILE_NAMES.length, 32);
  const fills: RGB[] = [
    hex("pavement"),
    hex("chalk"),
    hex("awning-cream"),
    hex("tree"),
    hex("wood-500"),
    hex("leaf-dark"),
  ];
  TILE_NAMES.forEach((_, i) => {
    const ox = i * 32;
    rect(img, ox, 0, 32, 32, fills[i]!);
    frame(img, ox, 0, 32, 32);
  });
  // Tile 1 (road): vạch giữa.
  rect(img, 32 + 14, 4, 4, 10, hex("awning-cream"));
  rect(img, 32 + 14, 18, 4, 10, hex("awning-cream"));
  // Tile 3 (grass): vài tán nhỏ.
  disc(img, 64 + 10, 12, 3, hex("leaf-light"));
  disc(img, 64 + 22, 20, 3, hex("leaf-light"));
  // Tile 5 (blocked): sọc chéo đỏ cảnh báo.
  for (let k = -32; k < 32; k += 8)
    for (let t = 0; t < 32; t++) put(img, 160 + t, 0 + ((t + k + 32) % 32), hex("danger"));
  return img;
}

// --- Quán 160×160 ---
function buildShop(body: RGB, awning: boolean, shopOpen = false): Img {
  const img = blank(160, 160);
  rect(img, 8, 56, 144, 96, body);
  frame(img, 8, 56, 144, 96);
  if (awning) {
    for (let x = 4; x < 156; x++) {
      const stripe = Math.floor((x - 4) / 16) % 2 === 0 ? hex("awning-orange") : hex("awning-cream");
      rect(img, x, 16, 1, 40, stripe);
    }
    frame(img, 4, 16, 152, 40);
  }
  rect(img, 60, 96, 40, 56, hex("wood-500"));
  frame(img, 60, 96, 40, 56);
  if (shopOpen) disc(img, 80, 36, 8, hex("tea"));
  return img;
}

function buildPlotEmpty(): Img {
  const img = blank(160, 160);
  rect(img, 0, 0, 160, 160, hex("pavement"));
  for (let x = 0; x < 160; x += 12) {
    rect(img, x, 0, 6, 2, hex("chalk"));
    rect(img, x, 158, 6, 2, hex("chalk"));
  }
  for (let y = 0; y < 160; y += 12) {
    rect(img, 0, y, 2, 6, hex("chalk"));
    rect(img, 158, y, 2, 6, hex("chalk"));
  }
  return img;
}

function buildAwning(): Img {
  const img = blank(160, 160);
  for (let x = 0; x < 160; x++) {
    const stripe = Math.floor(x / 20) % 2 === 0 ? hex("awning-orange") : hex("awning-cream");
    rect(img, x, 0, 1, 160, stripe);
  }
  frame(img, 0, 0, 160, 160);
  return img;
}

// --- Nội thất ---
function buildTable(): Img {
  const img = blank(32, 32);
  rect(img, 2, 6, 28, 22, hex("wood-500"));
  frame(img, 2, 6, 28, 22);
  return img;
}

function buildStool(c: RGB): Img {
  const img = blank(32, 32);
  discOutlined(img, 16, 16, 12, c);
  return img;
}

function buildChalkboard(): Img {
  const img = blank(64, 32);
  rect(img, 2, 2, 60, 28, hex("wood-500"));
  rect(img, 5, 5, 54, 22, hex("chalk"));
  frame(img, 2, 2, 60, 28);
  return img;
}

function buildTree(): Img {
  const img = blank(64, 64);
  disc(img, 34, 46, 14, hex("leaf-dark"));
  discOutlined(img, 30, 26, 22, hex("tree"));
  disc(img, 22, 20, 6, hex("leaf-light"));
  return img;
}

function buildPlant(): Img {
  const img = blank(32, 32);
  disc(img, 16, 12, 9, hex("tree"));
  rect(img, 10, 20, 12, 10, hex("wood-500"));
  frame(img, 10, 20, 12, 10);
  return img;
}

// --- UI ---
function buildLogo(): Img {
  const img = blank(256, 96);
  rect(img, 4, 4, 248, 88, hex("wood-sign"));
  rect(img, 12, 12, 232, 72, hex("logo-gold"));
  rect(img, 12, 12, 232, 12, hex("logo-gold-light"));
  frame(img, 4, 4, 248, 88);
  frame(img, 12, 12, 232, 72);
  return img;
}

function buildCoin(): Img {
  const img = blank(32, 32);
  discOutlined(img, 16, 16, 13, hex("logo-gold"));
  disc(img, 16, 16, 5, hex("logo-gold-light"));
  return img;
}

function buildCup(): Img {
  const img = blank(32, 32);
  rect(img, 8, 10, 16, 16, hex("tea"));
  frame(img, 8, 10, 16, 16);
  rect(img, 8, 6, 16, 4, hex("panel"));
  frame(img, 8, 6, 16, 4);
  return img;
}

function buildBubble(glyph: "wave" | "cheers" | "nod"): Img {
  const img = blank(32, 32);
  discOutlined(img, 16, 16, 14, hex("panel"));
  if (glyph === "wave") {
    for (let i = 0; i < 3; i++) rect(img, 9 + i * 5, 8, 3, 12, hex("tea"));
  } else if (glyph === "cheers") {
    disc(img, 12, 16, 5, hex("tea"));
    disc(img, 20, 16, 5, hex("awning-orange"));
  } else {
    tri(img, [[8, 10], [24, 10], [16, 24]], hex("stool-blue"));
  }
  return img;
}

// --- Avatar: sheet 128×192, 4 hàng (xuống, trái, phải, lên) × 4 cột (đi 0, đi 1, đi 2, ngồi). ---
const AVATAR_W = 32;
const AVATAR_H = 48;

function buildAvatar(shirt: RGB): Img {
  const img = blank(AVATAR_W * 4, AVATAR_H * 4);
  for (let dir = 0; dir < 4; dir++) {
    for (let col = 0; col < 4; col++) {
      const ox = col * AVATAR_W;
      const oy = dir * AVATAR_H;
      const cx = ox + 16;
      const seated = col === 3;
      const bodyTop = oy + (seated ? 20 : 18);
      const bodyH = seated ? 8 : 16;
      rect(img, cx - 7, bodyTop, 14, bodyH, shirt);
      frame(img, cx - 7, bodyTop, 14, bodyH);
      if (!seated) {
        const leftY = col === 1 ? oy + 35 : oy + 34;
        const rightY = col === 2 ? oy + 35 : oy + 34;
        rect(img, cx - 5, leftY, 4, 8, OUTLINE);
        rect(img, cx + 1, rightY, 4, 8, OUTLINE);
      } else {
        rect(img, cx - 9, oy + 28, 18, 3, OUTLINE);
      }
      discOutlined(img, cx, oy + 12, 7, hex("awning-cream"));
      rect(img, cx - 7, oy + 4, 14, 4, OUTLINE); // tóc
      if (dir === 0) {
        put(img, cx - 3, oy + 12, OUTLINE);
        put(img, cx + 2, oy + 12, OUTLINE);
      } else if (dir === 1) {
        put(img, cx - 4, oy + 12, OUTLINE);
      } else if (dir === 2) {
        put(img, cx + 3, oy + 12, OUTLINE);
      }
    }
  }
  return img;
}

// --- Dựng toàn bộ ---
interface Entry {
  file: string;
  img: Img;
}

export function buildAll(): { entries: Entry[]; manifest: object } {
  const images: Entry[] = [
    { file: "shop_default_1", img: buildShop(hex("panel"), true) },
    { file: "shop_default_2", img: buildShop(hex("wood-sign"), true) },
    { file: "shop_default_3", img: buildShop(hex("wood-500"), false) },
    { file: "shop_player", img: buildShop(hex("logo-gold-light"), true, true) },
    { file: "plot_empty", img: buildPlotEmpty() },
    { file: "awning", img: buildAwning() },
    { file: "table_low", img: buildTable() },
    { file: "stool_blue", img: buildStool(hex("stool-blue")) },
    { file: "stool_red", img: buildStool(hex("stool-red")) },
    { file: "stool_orange", img: buildStool(hex("stool-orange")) },
    { file: "chalkboard", img: buildChalkboard() },
    { file: "tree", img: buildTree() },
    { file: "plant", img: buildPlant() },
    { file: "logo", img: buildLogo() },
    { file: "icon_xu", img: buildCoin() },
    { file: "icon_tea", img: buildCup() },
    { file: "emote_wave", img: buildBubble("wave") },
    { file: "emote_cheers", img: buildBubble("cheers") },
    { file: "emote_nod", img: buildBubble("nod") },
  ];
  const avatars: Entry[] = [
    { file: "avatar_01", img: buildAvatar(hex("stool-blue")) },
    { file: "avatar_02", img: buildAvatar(hex("stool-red")) },
    { file: "avatar_03", img: buildAvatar(hex("stool-orange")) },
    { file: "avatar_04", img: buildAvatar(hex("tree")) },
  ];
  const street: Entry = { file: "street", img: buildStreet() };
  const entries = [...images, ...avatars, street];
  const manifest = {
    images: images.map((e) => ({ key: e.file, url: `/assets/${e.file}.png`, width: e.img.w, height: e.img.h })),
    spritesheets: avatars.map((e) => ({
      key: e.file,
      url: `/assets/${e.file}.png`,
      frameWidth: AVATAR_W,
      frameHeight: AVATAR_H,
    })),
    tilesets: [
      {
        key: "street",
        url: "/assets/street.png",
        tileWidth: 32,
        tileHeight: 32,
        tileCount: TILE_NAMES.length,
        columns: TILE_NAMES.length,
        tileNames: [...TILE_NAMES],
      },
    ],
  };
  return { entries, manifest };
}

function main(): void {
  const outDir = resolve(process.argv[2] ?? resolve(__dirname, "../apps/web/public/assets"));
  mkdirSync(outDir, { recursive: true });
  const { entries, manifest } = buildAll();
  for (const e of entries) writeFileSync(resolve(outDir, `${e.file}.png`), toPng(e.img));
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`wrote ${entries.length} png + manifest.json to ${outDir}`);
}

if (require.main === module) main();

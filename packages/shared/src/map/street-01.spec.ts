import { describe, expect, it } from "vitest";
import committed from "./street-01.json" with { type: "json" };
import { buildStreet01, serializeMap } from "./gen-street-01.js";
import { TILE_SIZE, getPlots, getSeats, getSpawn, isWalkable, type TiledMap } from "./query.js";

// Số này lấy từ config purchasablePlots = 4 (bảng config trong IMPLEMENTATION-PLAN.md).
const PURCHASABLE_PLOTS = 4;

const map = committed as TiledMap;

const W = map.width;
const H = map.height;
const centre = (tx: number, ty: number) => ({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 });
const walkTile = (tx: number, ty: number) => isWalkable(map, centre(tx, ty).x, centre(tx, ty).y);

/** BFS theo ô 4 hướng từ một ô, trả về tập "tx,ty" đi tới được. */
function reachableFrom(start: { tx: number; ty: number }): Set<string> {
  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const queue = [start];
  while (queue.length > 0) {
    const { tx, ty } = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkTile(nx, ny)) continue;
      seen.add(key);
      queue.push({ tx: nx, ty: ny });
    }
  }
  return seen;
}

const spawn = getSpawn(map);
const spawnTile = { tx: Math.floor(spawn.x / TILE_SIZE), ty: Math.floor(spawn.y / TILE_SIZE) };
const reachable = reachableFrom(spawnTile);

describe("street-01 generator", () => {
  it("file đã commit khớp đúng đầu ra của generator", () => {
    expect(serializeMap(committed as TiledMap)).toBe(serializeMap(buildStreet01()));
  });

  it("sinh hai lần ra cùng chuỗi (tất định)", () => {
    expect(serializeMap(buildStreet01())).toBe(serializeMap(buildStreet01()));
  });

  it("kích thước 48x24 tile, tile 32 px", () => {
    expect([W, H, map.tilewidth, map.tileheight]).toEqual([48, 24, 32, 32]);
  });
});

describe("plots", () => {
  const plots = getPlots(map);

  it("có đúng 7 slot, đúng tên, vị trí và loại theo thứ tự D1,P1,D2,P2,D3,P3,P4", () => {
    const expected = [
      ["D1", 2, "RESERVED_DEFAULT"],
      ["P1", 8, "PURCHASABLE"],
      ["D2", 14, "RESERVED_DEFAULT"],
      ["P2", 20, "PURCHASABLE"],
      ["D3", 26, "RESERVED_DEFAULT"],
      ["P3", 32, "PURCHASABLE"],
      ["P4", 38, "PURCHASABLE"],
    ] as const;
    expect(plots.map((p) => [p.id, p.x / TILE_SIZE, p.kind])).toEqual(expected.map((e) => [...e]));
    for (const p of plots) {
      expect([p.y / TILE_SIZE, p.width / TILE_SIZE, p.height / TILE_SIZE]).toEqual([2, 5, 5]);
    }
  });

  it("số ô PURCHASABLE khớp config purchasablePlots", () => {
    expect(plots.filter((p) => p.kind === "PURCHASABLE")).toHaveLength(PURCHASABLE_PLOTS);
    expect(plots.filter((p) => p.kind === "RESERVED_DEFAULT")).toHaveLength(3);
  });

  it("các ô không chồng lên nhau", () => {
    const cells = new Set<string>();
    for (const p of plots) {
      for (let ty = p.y / TILE_SIZE; ty < (p.y + p.height) / TILE_SIZE; ty++) {
        for (let tx = p.x / TILE_SIZE; tx < (p.x + p.width) / TILE_SIZE; tx++) {
          expect(cells.has(`${tx},${ty}`)).toBe(false);
          cells.add(`${tx},${ty}`);
        }
      }
    }
  });

  it("mọi ô đi tới được từ spawn qua vỉa hè phía trước (ô ngay dưới tâm ô)", () => {
    for (const p of plots) {
      const entranceX = p.x / TILE_SIZE + 2;
      const entranceY = p.y / TILE_SIZE + p.height / TILE_SIZE; // hàng ngay sau khu nhà
      expect(walkTile(entranceX, entranceY), `${p.id} lối vào`).toBe(true);
      expect(reachable.has(`${entranceX},${entranceY}`), `${p.id} tới được từ spawn`).toBe(true);
    }
  });
});

describe("seats", () => {
  const seats = getSeats(map);

  it("có 28 ghế, id duy nhất, đúng dạng {slot}-S{1..4}", () => {
    expect(seats).toHaveLength(28);
    expect(new Set(seats.map((s) => s.id)).size).toBe(28);
    expect(seats.map((s) => s.id)).toEqual(
      ["D1", "P1", "D2", "P2", "D3", "P3", "P4"].flatMap((p) => [1, 2, 3, 4].map((n) => `${p}-S${n}`)),
    );
  });

  it("mỗi ghế nằm đúng tâm ô, các ô ghế không trùng nhau", () => {
    const tiles = new Set<string>();
    for (const s of seats) {
      const tx = Math.floor(s.x / TILE_SIZE);
      const ty = Math.floor(s.y / TILE_SIZE);
      expect(s.x % TILE_SIZE).toBe(TILE_SIZE / 2);
      expect(s.y % TILE_SIZE).toBe(TILE_SIZE / 2);
      expect(tiles.has(`${tx},${ty}`)).toBe(false);
      tiles.add(`${tx},${ty}`);
    }
  });

  it("mọi ghế đi vào được và đi tới được từ spawn", () => {
    for (const s of seats) {
      expect(isWalkable(map, s.x, s.y), `${s.id} đi vào được`).toBe(true);
      const tx = Math.floor(s.x / TILE_SIZE);
      const ty = Math.floor(s.y / TILE_SIZE);
      expect(reachable.has(`${tx},${ty}`), `${s.id} tới được từ spawn`).toBe(true);
    }
  });
});

describe("walkability", () => {
  it("spawn là (24,13) và đi được", () => {
    expect(spawnTile).toEqual({ tx: 24, ty: 13 });
    expect(isWalkable(map, spawn.x, spawn.y)).toBe(true);
  });

  it("khu nhà, đường, bàn và cây không đi được", () => {
    expect(walkTile(0, 0)).toBe(false); // khu nhà
    expect(walkTile(5, 4)).toBe(false); // trong ô D1
    expect(walkTile(10, 20)).toBe(false); // đường
    expect(walkTile(4, 8)).toBe(false); // bàn của D1
    expect(walkTile(1, 15)).toBe(false); // cây trước D1
  });

  it("ngoài biên không đi được", () => {
    expect(isWalkable(map, -1, 13 * TILE_SIZE)).toBe(false);
    expect(isWalkable(map, 13 * TILE_SIZE, -1)).toBe(false);
    expect(isWalkable(map, W * TILE_SIZE, 13 * TILE_SIZE)).toBe(false);
    expect(isWalkable(map, 24 * TILE_SIZE, H * TILE_SIZE)).toBe(false);
    expect(isWalkable(map, Number.NaN, 0)).toBe(false);
  });
});

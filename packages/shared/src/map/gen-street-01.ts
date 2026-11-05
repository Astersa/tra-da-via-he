// Sinh map `street-01` (§3.8, mục Map). Hàm thuần, tất định: cùng đầu vào luôn ra cùng chuỗi.
// Script scripts/gen-map.ts ghi kết quả ra street-01.json; test đối chiếu với file đã commit.

import { TILE_SIZE, type TiledMap, type TiledObject, type TiledObjectLayer, type TiledTileLayer } from "./types.js";

const WIDTH = 48;
const HEIGHT = 24;

// Thứ tự tile trong tileset "street" (firstgid = 1, gid = tileId + 1).
const TILE = { pavement: 1, road: 2, curb: 3, grass: 4, wall: 5, blocked: 6 } as const;

// Slot: 7 ô, rộng 5, cao 5, đỉnh ở y = 2. Xen kẽ D/P.
const SLOT_X = [2, 8, 14, 20, 26, 32, 38] as const;
const SLOT_NAMES = ["D1", "P1", "D2", "P2", "D3", "P3", "P4"] as const;
const SLOT_TOP = 2;
const SLOT_SIZE = 5;

// Ghế S1..S4: [dx so với x của slot, y tuyệt đối của ô].
const SEAT_OFFSETS: readonly [number, number][] = [
  [0, 8],
  [1, 9],
  [3, 9],
  [4, 8],
];
const TABLE_DX = 2; // bàn thấp ở (x+2, 8)
const TABLE_Y = 8;
const TREE_DX = -1; // cây ở (x-1, 15)
const TREE_Y = 15;
const SPAWN: [number, number] = [24, 13];

function idx(x: number, y: number): number {
  return y * WIDTH + x;
}

function centre(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

function groundGid(y: number): number {
  if (y <= 6) return TILE.wall; // khu nhà
  if (y === 7) return TILE.curb; // khoảng trống phía trước quán, đi được
  if (y <= 15) return TILE.pavement; // vỉa hè
  return TILE.road; // đường
}

export function buildStreet01(): TiledMap {
  const collision = Array.from({ length: WIDTH * HEIGHT }, () => 0);
  const ground: number[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) ground[idx(x, y)] = groundGid(y);
  }
  const block = (x: number, y: number) => {
    collision[idx(x, y)] = TILE.blocked;
  };
  // Khu nhà và đường không đi được; hàng 7 (trước quán) và vỉa hè thì đi được.
  for (let y = 0; y < HEIGHT; y++) {
    if (y <= 6 || y >= 16) for (let x = 0; x < WIDTH; x++) block(x, y);
  }

  let nextObjectId = 1;
  const plots: TiledObject[] = [];
  const seats: TiledObject[] = [];
  SLOT_NAMES.forEach((name, i) => {
    const x = SLOT_X[i]!;
    const kind = name.startsWith("D") ? "RESERVED_DEFAULT" : "PURCHASABLE";
    plots.push({
      id: nextObjectId++,
      name,
      type: "plot",
      x: x * TILE_SIZE,
      y: SLOT_TOP * TILE_SIZE,
      width: SLOT_SIZE * TILE_SIZE,
      height: SLOT_SIZE * TILE_SIZE,
      rotation: 0,
      visible: true,
      properties: [{ name: "kind", type: "string", value: kind }],
    });
    block(x + TABLE_DX, TABLE_Y);
    block(x + TREE_DX, TREE_Y);
    SEAT_OFFSETS.forEach(([dx, ty], s) => {
      seats.push({
        id: nextObjectId++,
        name: `${name}-S${s + 1}`,
        type: "seat",
        ...centre(x + dx, ty),
        width: 0,
        height: 0,
        rotation: 0,
        visible: true,
        point: true,
      });
    });
  });

  const spawnCentre = centre(SPAWN[0], SPAWN[1]);
  const spawn: TiledObject = {
    id: nextObjectId++,
    name: "spawn",
    type: "spawn",
    ...spawnCentre,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
  };

  const groundLayer: TiledTileLayer = {
    id: 1,
    name: "ground",
    type: "tilelayer",
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    opacity: 1,
    visible: true,
    data: ground,
  };
  const collisionLayer: TiledTileLayer = {
    id: 2,
    name: "collision",
    type: "tilelayer",
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    opacity: 1,
    visible: false,
    data: collision,
  };
  const objectLayer = (id: number, name: string, objects: TiledObject[]): TiledObjectLayer => ({
    id,
    name,
    type: "objectgroup",
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: "topdown",
    objects,
  });

  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    compressionlevel: -1,
    width: WIDTH,
    height: HEIGHT,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    nextlayerid: 6,
    nextobjectid: nextObjectId,
    layers: [
      groundLayer,
      collisionLayer,
      objectLayer(3, "plots", plots),
      objectLayer(4, "seats", seats),
      objectLayer(5, "spawn", [spawn]),
    ],
    tilesets: [
      {
        firstgid: 1,
        name: "street",
        tilewidth: TILE_SIZE,
        tileheight: TILE_SIZE,
        tilecount: 6,
        columns: 6,
        image: "street.png",
        imagewidth: 6 * TILE_SIZE,
        imageheight: TILE_SIZE,
        margin: 0,
        spacing: 0,
      },
    ],
  };
}

/** Chuỗi JSON đúng byte với file đã commit. */
export function serializeMap(map: TiledMap): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

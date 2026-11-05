// Truy vấn trên map Tiled đã parse. Không đọc file, không phụ thuộc Node.

import {
  TILE_SIZE,
  type Point,
  type PlotSlot,
  type Seat,
  type TiledMap,
  type TiledObject,
  type TiledObjectLayer,
  type TiledTileLayer,
} from "./types.js";

export { TILE_SIZE };
export type { Point, PlotSlot, Seat, TiledMap };

function tileLayer(map: TiledMap, name: string): TiledTileLayer {
  const layer = map.layers.find((l): l is TiledTileLayer => l.type === "tilelayer" && l.name === name);
  if (!layer) throw new Error(`map thiếu tile layer "${name}"`);
  return layer;
}

function objectLayer(map: TiledMap, name: string): TiledObjectLayer {
  const layer = map.layers.find((l): l is TiledObjectLayer => l.type === "objectgroup" && l.name === name);
  if (!layer) throw new Error(`map thiếu object layer "${name}"`);
  return layer;
}

/** Ô (px, py) có đi được không. Ngoài biên là không đi được. */
export function isWalkable(map: TiledMap, px: number, py: number): boolean {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return tileLayer(map, "collision").data[ty * map.width + tx] === 0;
}

export function getSeats(map: TiledMap): Seat[] {
  return objectLayer(map, "seats").objects.map((o: TiledObject) => {
    const plotId = o.name.split("-")[0] ?? "";
    return { id: o.name, plotId, x: o.x, y: o.y };
  });
}

export function getPlots(map: TiledMap): PlotSlot[] {
  return objectLayer(map, "plots").objects.map((o: TiledObject) => {
    const kind = o.properties?.find((p) => p.name === "kind")?.value;
    if (kind !== "RESERVED_DEFAULT" && kind !== "PURCHASABLE") {
      throw new Error(`plot ${o.name} có kind không hợp lệ: ${String(kind)}`);
    }
    return { id: o.name, kind, x: o.x, y: o.y, width: o.width, height: o.height };
  });
}

export function getSpawn(map: TiledMap): Point {
  const spawn = objectLayer(map, "spawn").objects[0];
  if (!spawn) throw new Error('map thiếu object "spawn"');
  return { x: spawn.x, y: spawn.y };
}

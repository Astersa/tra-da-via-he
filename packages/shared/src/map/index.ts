import { buildStreet01 } from "./gen-street-01.js";
import type { TiledMap } from "./types.js";

export * from "./types.js";
export * from "./query.js";

export const MAP_ID = "street-01";

/** Map street-01, tính một lần khi module nạp. */
export const street01Map: TiledMap = buildStreet01();

// Kiểu tối thiểu của Tiled JSON (map orthogonal, layer tile và object) cho map `street-01` (§3.8).
// Không phụ thuộc Node: file này và các file cùng thư mục chạy được trên trình duyệt.

export const TILE_SIZE = 32;

export interface TiledProperty {
  name: string;
  type: "string" | "int" | "float" | "bool";
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0;
  visible: true;
  point?: true;
  properties?: TiledProperty[];
}

export interface TiledTileLayer {
  id: number;
  name: string;
  type: "tilelayer";
  x: 0;
  y: 0;
  width: number;
  height: number;
  opacity: 1;
  visible: boolean;
  /** Mảng phẳng, theo hàng; gid 0 là ô trống. */
  data: number[];
}

export interface TiledObjectLayer {
  id: number;
  name: string;
  type: "objectgroup";
  x: 0;
  y: 0;
  opacity: 1;
  visible: boolean;
  draworder: "topdown";
  objects: TiledObject[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  margin: 0;
  spacing: 0;
}

export interface TiledMap {
  type: "map";
  version: "1.10";
  tiledversion: "1.10.2";
  orientation: "orthogonal";
  renderorder: "right-down";
  infinite: false;
  compressionlevel: -1;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  layers: (TiledTileLayer | TiledObjectLayer)[];
  tilesets: TiledTileset[];
}

/** Điểm đi được: pixel, luôn là tâm ô khi lấy từ map. */
export interface Point {
  x: number;
  y: number;
}

export interface PlotSlot {
  /** "D1".."D3" (RESERVED_DEFAULT), "P1".."P4" (PURCHASABLE). */
  id: string;
  kind: "RESERVED_DEFAULT" | "PURCHASABLE";
  /** Góc trên trái và kích thước, pixel. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Seat extends Point {
  /** "{plot}-S{1..4}", ví dụ "D1-S1". */
  id: string;
  plotId: string;
}

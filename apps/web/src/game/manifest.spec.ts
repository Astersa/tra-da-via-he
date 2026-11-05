import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const assetsDir = join(root, 'apps/web/public/assets');
const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf8')) as {
  images: { key: string; url: string; width: number; height: number }[];
  spritesheets: { key: string; url: string; frameWidth: number; frameHeight: number }[];
  tilesets: { key: string; url: string; tileWidth: number; tileHeight: number; tileCount: number; tileNames: string[] }[];
};
const streetJson = JSON.parse(
  readFileSync(join(root, 'packages/shared/src/map/street-01.json'), 'utf8'),
) as { tilesets: { name: string; tilewidth: number; tileheight: number; tilecount: number; image: string }[] };

// Đọc kích thước từ header IHDR của PNG (byte 16..23).
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Các key bắt buộc theo §3.8 (bảng "Asset cần có").
const REQUIRED_IMAGES = [
  'shop_default_1', 'shop_default_2', 'shop_default_3', 'shop_player', 'plot_empty', 'awning',
  'table_low', 'stool_blue', 'stool_red', 'stool_orange', 'chalkboard', 'tree', 'plant',
  'logo', 'icon_xu', 'icon_tea', 'emote_wave', 'emote_cheers', 'emote_nod',
];
const REQUIRED_TILES = ['pavement', 'road', 'curb', 'grass', 'wall', 'blocked'];
const AVATARS = ['avatar_01', 'avatar_02', 'avatar_03', 'avatar_04'];

describe('placeholder art manifest', () => {
  it('có đủ key §3.8: images, tileset street, avatar_01..04', () => {
    const imageKeys = manifest.images.map((i) => i.key);
    for (const k of REQUIRED_IMAGES) expect(imageKeys).toContain(k);
    expect(manifest.tilesets.map((t) => t.key)).toContain('street');
    const sheetKeys = manifest.spritesheets.map((s) => s.key);
    for (const a of AVATARS) expect(sheetKeys).toContain(a);
    expect(manifest.tilesets[0]!.tileNames).toEqual(REQUIRED_TILES);
  });

  it('mọi file tồn tại và đúng kích thước khai báo', () => {
    for (const i of manifest.images) {
      const p = join(assetsDir, i.url.replace('/assets/', ''));
      expect(existsSync(p), i.key).toBe(true);
      expect(pngSize(p), i.key).toEqual({ width: i.width, height: i.height });
    }
    for (const s of manifest.spritesheets) {
      const p = join(assetsDir, s.url.replace('/assets/', ''));
      expect(existsSync(p), s.key).toBe(true);
      const size = pngSize(p);
      expect(size.width % s.frameWidth, s.key).toBe(0);
      expect(size.height % s.frameHeight, s.key).toBe(0);
      // avatar: 4 hàng × 4 cột, frame 32×48
      expect(size).toEqual({ width: 4 * s.frameWidth, height: 4 * s.frameHeight });
      expect([s.frameWidth, s.frameHeight], s.key).toEqual([32, 48]);
    }
    for (const t of manifest.tilesets) {
      const p = join(assetsDir, t.url.replace('/assets/', ''));
      expect(existsSync(p), t.key).toBe(true);
      expect(pngSize(p), t.key).toEqual({ width: t.tileCount * t.tileWidth, height: t.tileHeight });
    }
  });

  it('tileset khớp street01Map (tên, kích thước ô bằng TILE_SIZE 32, số ô)', () => {
    const map = streetJson.tilesets[0]!;
    const t = manifest.tilesets[0]!;
    expect(t.key).toBe(map.name);
    expect(t.tileWidth).toBe(map.tilewidth);
    expect(t.tileHeight).toBe(map.tileheight);
    expect(t.tileWidth).toBe(32);
    expect(t.tileCount).toBe(map.tilecount);
    expect(t.tileNames.length).toBe(map.tilecount);
  });

  it('chạy lại generator cho ra đúng từng byte', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tdvh-art-'));
    execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/gen-placeholder-art.ts'), tmp], {
      cwd: root,
      stdio: 'pipe',
    });
    const names = readdirSync(assetsDir);
    expect(readdirSync(tmp).sort()).toEqual([...names].sort());
    for (const n of names) {
      expect(readFileSync(join(tmp, n)).equals(readFileSync(join(assetsDir, n))), n).toBe(true);
    }
  });
});

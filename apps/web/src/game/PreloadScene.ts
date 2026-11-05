import Phaser from 'phaser';
import { WorldScene } from './WorldScene';

export const MANIFEST_URL = '/assets/manifest.json';

export interface AssetManifest {
  images: { key: string; url: string }[];
  spritesheets: { key: string; url: string; frameWidth: number; frameHeight: number }[];
  tilesets: { key: string; url: string; tileWidth: number; tileHeight: number }[];
}

// Đọc manifest, nạp mọi asset khai báo trong đó, rồi chuyển sang WorldScene. Không có asset ngoài.
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    this.load.json('manifest', MANIFEST_URL);
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, 'Đang tải...', { fontFamily: '"Baloo 2", sans-serif', fontSize: '24px' }).setOrigin(0.5);

    const m = this.cache.json.get('manifest') as AssetManifest;
    for (const img of m.images) this.load.image(img.key, img.url);
    for (const s of m.spritesheets) this.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    for (const t of m.tilesets) this.load.spritesheet(t.key, t.url, { frameWidth: t.tileWidth, frameHeight: t.tileHeight });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.scene.start(WorldScene.KEY));
    this.load.start();
  }
}

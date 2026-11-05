import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvatarIdSchema } from '@tdvh/shared';
import { describe, expect, it } from 'vitest';
import { AVATAR_FRAME, AVATAR_OPTIONS } from './Avatar';

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../public/assets/manifest.json'), 'utf8'),
) as { spritesheets: { key: string; url: string; frameWidth: number; frameHeight: number }[] };

describe('avatar', () => {
  it('bốn nhân vật khớp AvatarIdSchema và manifest, khung 32×48', () => {
    expect(AVATAR_OPTIONS.length).toBe(4);
    for (const opt of AVATAR_OPTIONS) {
      expect(AvatarIdSchema.safeParse(opt.id).success, opt.id).toBe(true);
      const entry = manifest.spritesheets.find((s) => s.key === opt.id);
      expect(entry, opt.id).toBeDefined();
      expect(opt.url).toBe(entry!.url);
      expect([entry!.frameWidth, entry!.frameHeight]).toEqual([AVATAR_FRAME.width, AVATAR_FRAME.height]);
    }
  });

  it('mỗi nhân vật có nhãn tiếng Việt riêng để đọc bằng trình đọc màn hình', () => {
    const labels = AVATAR_OPTIONS.map((o) => o.label);
    expect(new Set(labels).size).toBe(4);
    for (const label of labels) expect(label).toMatch(/^Nhân vật \d$/);
  });
});

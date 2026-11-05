import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens, type TokenName } from '../theme/tokens';

// Đọc WCAG: độ sáng tương đối từ hex sRGB.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Mọi cặp chữ/nền mà giao diện dùng (§3.8: tối thiểu 4.5:1).
const TEXT_ON_BACKGROUND: [TokenName, TokenName][] = [
  ['brown-900', 'panel'], // chữ thường trong panel, hint, legend
  ['brown-900', 'awning-cream'], // tiêu đề panel
  ['brown-900', 'awning-orange'], // nút chính
  ['brown-900', 'wood-sign'], // nút phụ
  ['brown-900', 'sky'], // chữ trực tiếp trên nền màn
  ['danger', 'panel'], // thông báo lỗi
  ['success', 'panel'], // thông báo thành công
];

describe('tương phản chữ trên nền (§3.8)', () => {
  for (const [fg, bg] of TEXT_ON_BACKGROUND) {
    it(`${fg} trên ${bg} đạt 4.5:1`, () => {
      expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('CSS giao diện chỉ dùng biến token, không có màu hex cứng', () => {
    const css = readFileSync(join(import.meta.dirname, 'ui.css'), 'utf8');
    expect(css.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).toEqual([]);
  });
});

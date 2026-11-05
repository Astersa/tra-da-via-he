import { ERROR_CODES } from '@tdvh/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { ERROR_TEXT, NETWORK_ERROR_TEXT, errorTextFor } from './errorText';

describe('errorText', () => {
  it('có văn bản cho đúng mọi ErrorCode trong shared', () => {
    expect(Object.keys(ERROR_TEXT).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('mỗi văn bản không rỗng và kết thúc bằng dấu câu tiếng Việt', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_TEXT[code].trim().length, code).toBeGreaterThan(0);
      expect(ERROR_TEXT[code], code).toMatch(/[.!?]$/);
    }
  });

  it('ApiError trả đúng văn bản theo mã, lỗi mạng trả thông báo mạng', () => {
    expect(errorTextFor(new ApiError('DISPLAY_NAME_TAKEN', 'x', 409))).toBe(
      'Tên này đã có người dùng. Chọn tên khác nhé.',
    );
    expect(errorTextFor(new TypeError('fetch failed'))).toBe(NETWORK_ERROR_TEXT);
  });
});

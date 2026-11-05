import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { ERROR_TEXT } from './errorText';
import { withAccountRequired } from './withAccountRequired';

const accountRequired = () => new ApiError('ACCOUNT_REQUIRED', 'x', 403);

beforeEach(() => {
  useAuthStore.setState({ upgradeRequest: null });
});

afterEach(() => {
  useAuthStore.setState({ upgradeRequest: null });
  vi.restoreAllMocks();
});

describe('withAccountRequired', () => {
  it('fn thành công thì trả về kết quả và không mở form', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withAccountRequired(fn)).resolves.toBe('ok');
    expect(useAuthStore.getState().upgradeRequest).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('lỗi khác ACCOUNT_REQUIRED thì ném lại, không mở form', async () => {
    const fn = vi.fn(async () => {
      throw new ApiError('NOT_FOUND', 'x', 404);
    });
    await expect(withAccountRequired(fn)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(useAuthStore.getState().upgradeRequest).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ACCOUNT_REQUIRED mở form; nâng cấp xong gọi lại fn đúng một lần', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(accountRequired())
      .mockResolvedValueOnce('done');
    const pending = withAccountRequired(fn);

    await vi.waitFor(() => expect(useAuthStore.getState().upgradeRequest).not.toBeNull());
    const req = useAuthStore.getState().upgradeRequest!;
    expect(req.reason).toBe(ERROR_TEXT.ACCOUNT_REQUIRED);
    expect(fn).toHaveBeenCalledTimes(1);

    // Form thành công sẽ đóng rồi gọi onSuccess.
    useAuthStore.getState().closeUpgrade();
    req.onSuccess?.();

    await expect(pending).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('đóng form thì dừng: trả undefined, không báo lỗi, không gọi lại fn', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(accountRequired());
    const pending = withAccountRequired(fn);

    await vi.waitFor(() => expect(useAuthStore.getState().upgradeRequest).not.toBeNull());
    const req = useAuthStore.getState().upgradeRequest!;
    useAuthStore.getState().closeUpgrade();
    req.onCancel?.();

    await expect(pending).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sau khi nâng cấp mà fn vẫn báo ACCOUNT_REQUIRED thì ném lỗi, không lặp vô hạn', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(accountRequired());
    const pending = withAccountRequired(fn);

    await vi.waitFor(() => expect(useAuthStore.getState().upgradeRequest).not.toBeNull());
    const req = useAuthStore.getState().upgradeRequest!;
    useAuthStore.getState().closeUpgrade();
    req.onSuccess?.();

    await expect(pending).rejects.toMatchObject({ code: 'ACCOUNT_REQUIRED' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

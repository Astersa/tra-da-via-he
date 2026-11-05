import { openUpgrade } from '../store/authStore';
import { ERROR_TEXT } from './errorText';

function isAccountRequired(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ACCOUNT_REQUIRED';
}

// Gọi fn. Nếu lỗi ACCOUNT_REQUIRED thì mở form tạo tài khoản; nâng cấp xong gọi lại fn đúng một lần.
// Đóng form thì dừng và trả undefined, không báo lỗi. Lỗi khác được ném lại như cũ.
export async function withAccountRequired<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (!isAccountRequired(err)) throw err;
  }
  const upgraded = await new Promise<boolean>((resolve) => {
    openUpgrade({
      reason: ERROR_TEXT.ACCOUNT_REQUIRED,
      onSuccess: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
  if (!upgraded) return undefined;
  return fn();
}

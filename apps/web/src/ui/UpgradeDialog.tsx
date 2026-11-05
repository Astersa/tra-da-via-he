import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UpgradeReqSchema } from '@tdvh/shared';
import { useAuthStore, type UpgradeRequest } from '../store/authStore';
import { Button, Field } from './components';
import { errorTextFor } from './errorText';
import './UpgradeDialog.css';

const RULE_TEXT =
  'Tên đăng nhập 3 đến 20 ký tự: chữ thường a-z, số hoặc gạch dưới. Mật khẩu 8 đến 72 ký tự.';
const FORM_RULE_ERROR = 'Tên đăng nhập hoặc mật khẩu chưa đúng quy tắc. Xem lại yêu cầu bên trên.';
const CONFIRM_ERROR = 'Mật khẩu nhập lại chưa khớp.';

// Hộp thoại tạo tài khoản từ khách. Không có email, không có quên mật khẩu.
// Chỉ mount khi có yêu cầu mở (authStore.upgradeRequest). Mật khẩu không bao giờ được log.
export function UpgradeDialog() {
  const req = useAuthStore((s) => s.upgradeRequest);
  if (!req) return null;
  // Đóng form làm unmount nên lần mở sau luôn bắt đầu với ô trống.
  return <UpgradeForm req={req} />;
}

function UpgradeForm({ req }: { req: UpgradeRequest }) {
  const upgrade = useAuthStore((s) => s.upgrade);
  const closeUpgrade = useAuthStore((s) => s.closeUpgrade);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  function cancel() {
    closeUpgrade();
    req.onCancel?.();
  }

  // Esc đóng form (trừ khi đang gửi).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy.current) cancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    // Kiểm tra cục bộ theo đúng schema shared. Ô nhập lại không gửi lên server.
    const parsed = UpgradeReqSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError(FORM_RULE_ERROR);
      return;
    }
    if (confirm !== password) {
      setError(CONFIRM_ERROR);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await upgrade(parsed.data);
      busy.current = false;
      setPending(false);
      closeUpgrade();
      req.onSuccess?.();
    } catch (err) {
      setError(errorTextFor(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="upgrade-overlay">
      <div
        className="upgrade-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-title"
        aria-describedby="upgrade-warning"
      >
        <h2 id="upgrade-title" className="upgrade-title">
          Tạo tài khoản
        </h2>
        {req.reason && <p className="upgrade-reason">{req.reason}</p>}
        <p id="upgrade-warning" className="upgrade-warning">
          Tài khoản khách lưu trên trình duyệt này. Xóa cookie là mất nhân vật và Xu. Không có email và
          chưa có cách quên mật khẩu: quên thì nhờ admin đặt lại.
        </p>
        <form className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field id="upgrade-username" label="Tên đăng nhập">
            <input
              id="upgrade-username"
              name="username"
              className="input"
              type="text"
              autoComplete="username"
              maxLength={20}
              required
              autoFocus
              aria-describedby="upgrade-rule"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field id="upgrade-password" label="Mật khẩu">
            <input
              id="upgrade-password"
              name="password"
              className="input"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              required
              aria-describedby="upgrade-rule"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field id="upgrade-confirm" label="Nhập lại mật khẩu">
            <input
              id="upgrade-confirm"
              name="passwordConfirm"
              className="input"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <p id="upgrade-rule" className="hint">
            {RULE_TEXT}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? 'Đang tạo...' : 'Tạo tài khoản'}
          </Button>
        </form>
        <Button variant="link" onClick={cancel} disabled={pending}>
          Để sau
        </Button>
      </div>
    </div>
  );
}

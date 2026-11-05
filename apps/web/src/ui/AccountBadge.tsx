import { useState } from 'react';
import { openUpgrade, useAuthStore } from '../store/authStore';
import { Button } from './components';
import './AccountBadge.css';

// Cảnh báo dùng chung cho HUD và xác nhận đăng xuất của khách.
export const GUEST_WARNING = 'Tài khoản khách lưu trên trình duyệt này. Xóa cookie là mất nhân vật và Xu.';

// Nhãn HUD: chỉ hiện với khách. Người đã có tài khoản không thấy nút hay cảnh báo.
export function AccountBadge() {
  const kind = useAuthStore((s) => s.user?.kind);
  if (kind !== 'GUEST') return null;
  return (
    <section className="account-badge" aria-label="Tài khoản">
      <p className="account-badge-warning">{GUEST_WARNING}</p>
      <Button variant="secondary" className="account-badge-button" onClick={() => openUpgrade({})}>
        Tạo tài khoản
      </Button>
    </section>
  );
}

// Nút đăng xuất. Với khách phải xác nhận lại, kèm cùng cảnh báo.
export function LogoutButton() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (user?.kind !== 'GUEST') {
    return (
      <Button variant="secondary" onClick={() => void logout()}>
        Đăng xuất
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Đăng xuất
      </Button>
    );
  }

  // authStore.logout không ném lỗi (luôn đăng xuất phía client), nên không cần báo lỗi ở đây.
  async function onConfirm() {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="logout-confirm" role="group" aria-label="Xác nhận đăng xuất">
      <p className="account-badge-warning">{GUEST_WARNING}</p>
      <Button variant="secondary" disabled={pending} onClick={() => void onConfirm()}>
        Vẫn đăng xuất
      </Button>
      <Button variant="link" disabled={pending} onClick={() => setConfirming(false)}>
        Ở lại
      </Button>
    </div>
  );
}

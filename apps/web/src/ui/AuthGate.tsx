import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Button, Panel } from './components';
import { EntryScreen } from './EntryScreen';
import { LoginScreen } from './LoginScreen';

// Chọn màn theo trạng thái đăng nhập. Chưa vào quán thì hiện màn vào; đã vào thì hiện vùng tạm.
export function AuthGate() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const logout = useAuthStore((s) => s.logout);
  const [mode, setMode] = useState<'entry' | 'login'>('entry');

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'booting') {
    return (
      <main className="screen">
        <Panel title="Trà Đá Vỉa Hè">
          <p role="status">Đang vào quán...</p>
        </Panel>
      </main>
    );
  }

  if (status === 'boot-error') {
    return (
      <main className="screen">
        <Panel title="Trà Đá Vỉa Hè">
          <p role="alert" className="form-error">
            Chưa kết nối được tới quán.
          </p>
          <Button onClick={() => void bootstrap()}>Thử lại</Button>
        </Panel>
      </main>
    );
  }

  if (status === 'signed-in') {
    const name = profile?.displayName ?? user?.username ?? 'bạn';
    return (
      <main className="screen">
        <Panel title="Đã vào quán">
          <p>Xin chào, {name}!</p>
          <p className="hint">Phần chọn máy chủ và vào quán sẽ có ở bước sau.</p>
          <Button variant="secondary" onClick={() => void logout()}>
            Đăng xuất
          </Button>
        </Panel>
      </main>
    );
  }

  return (
    <main className="screen">
      {mode === 'entry' ? (
        <EntryScreen onLogin={() => setMode('login')} />
      ) : (
        <LoginScreen onBack={() => setMode('entry')} />
      )}
    </main>
  );
}

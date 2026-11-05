import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useConnectivityStore } from '../store/connectivityStore';
import { ColdStartScreen } from './ColdStartScreen';
import { LogoutButton } from './AccountBadge';
import { Button, Panel } from './components';
import { EntryScreen } from './EntryScreen';
import { LoginScreen } from './LoginScreen';
import { ServerList } from './ServerList';

// Chọn màn theo trạng thái đăng nhập. Chưa vào quán thì hiện màn vào; đã vào thì hiện vùng tạm.
export function AuthGate() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const waking = useConnectivityStore((s) => s.status === 'waking');
  const [mode, setMode] = useState<'entry' | 'login'>('entry');

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Khi đã bỏ chờ (boot-error) thì để màn lỗi có nút "Thử lại" của bootstrap, không hiện màn chờ.
  if (status !== 'boot-error' && waking) return <ColdStartScreen />;

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
        <div className="signed-in-stack">
          <Panel title="Đã vào quán">
            <p>Xin chào, {name}!</p>
            <LogoutButton />
          </Panel>
          <ServerList />
        </div>
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

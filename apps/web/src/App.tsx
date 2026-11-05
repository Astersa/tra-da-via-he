import { AccountBadge } from './ui/AccountBadge';
import { AuthGate } from './ui/AuthGate';
import { ChatPanel } from './ui/ChatPanel';
import { UpgradeDialog } from './ui/UpgradeDialog';
import { GameView } from './game/GameView';
import { useWorldStore } from './store/worldStore';
import './ui/ui.css';

// Chưa vào máy chủ thì hiện màn vào (AuthGate). Đã chọn máy chủ (worldStore.connect) thì hiện màn chơi kèm panel chat và HUD tài khoản.
// Hộp thoại tạo tài khoản (UpgradeDialog) mount ở đây để mở được từ cả hai màn.
// App không nằm trong ui hay game nên được import cả hai (§3.1). game/ không được import ui/ (depcruise).
export function App() {
  const status = useWorldStore((s) => s.status);
  return (
    <>
      {status === 'idle' ? (
        <AuthGate />
      ) : (
        <>
          <GameView />
          <ChatPanel />
          <AccountBadge />
        </>
      )}
      <UpgradeDialog />
    </>
  );
}

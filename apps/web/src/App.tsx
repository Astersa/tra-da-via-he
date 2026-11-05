import { AuthGate } from './ui/AuthGate';
import { ChatPanel } from './ui/ChatPanel';
import { GameView } from './game/GameView';
import { useWorldStore } from './store/worldStore';
import './ui/ui.css';

// Chưa vào máy chủ thì hiện màn vào (AuthGate). Đã chọn máy chủ (worldStore.connect) thì hiện màn chơi kèm panel chat.
// App không nằm trong ui hay game nên được import cả hai (§3.1). game/ không được import ui/ (depcruise).
export function App() {
  const status = useWorldStore((s) => s.status);
  if (status === 'idle') return <AuthGate />;
  return (
    <>
      <GameView />
      <ChatPanel />
    </>
  );
}

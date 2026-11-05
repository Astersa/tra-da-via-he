import { AuthGate } from './ui/AuthGate';
import './ui/ui.css';

// Game (Phaser) chưa được mount ở task này; M1-E5-T4 sẽ mount lại sau khi vào quán.
export function App() {
  return <AuthGate />;
}

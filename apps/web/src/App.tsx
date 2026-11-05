import { useEffect, useRef } from 'react';
import { createGame } from './game/createGame';

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = createGame(host);
    return () => {
      game.destroy(true);
    };
  }, []);

  return <div ref={hostRef} className="game-root" />;
}

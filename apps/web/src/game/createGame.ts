import Phaser from 'phaser';
import { PreloadScene } from './PreloadScene';
import { WorldScene } from './WorldScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#d8a878',
    // RESIZE: canvas lấp đầy vùng chơi (.game-host); kích thước logic = pixel CSS, WorldScene nhận sự kiện resize.
    scale: {
      mode: Phaser.Scale.RESIZE,
    },
    scene: [PreloadScene, WorldScene],
  });
}

import Phaser from 'phaser';
import { PreloadScene } from './PreloadScene';
import { WorldScene } from './WorldScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 540,
    backgroundColor: '#d8a878',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [PreloadScene, WorldScene],
  });
}

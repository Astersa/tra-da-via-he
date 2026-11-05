import Phaser from 'phaser';
import { tokens } from '../theme/tokens';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(0, 0, width, height, Phaser.Display.Color.HexStringToColor(tokens.pavement).color)
      .setOrigin(0, 0);
    this.add
      .text(width / 2, height / 2, 'Trà Đá Vỉa Hè', {
        fontFamily: 'Baloo 2, sans-serif',
        fontSize: '48px',
        color: tokens['brown-900'],
      })
      .setOrigin(0.5);
  }
}

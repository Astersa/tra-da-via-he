import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

describe('tokens', () => {
  it('tokens.ts khớp tokens.css', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    const fromCss: Record<string, string> = {};
    for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
      fromCss[m[1]!] = m[2]!.toUpperCase();
    }
    const fromTs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tokens)) fromTs[k] = v.toUpperCase();
    expect(fromTs).toEqual(fromCss);
    expect(Object.keys(fromCss).length).toBe(20);
  });
});

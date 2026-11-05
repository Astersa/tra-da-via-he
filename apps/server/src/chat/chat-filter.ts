import { BANNED_WORDS } from '@tdvh/shared';

// Replaces each banned phrase with *** (M1-E4-T5). Matching ignores case and diacritics, and only matches
// whole phrases (no letter or digit next to the match).
const MASK = '***';

// Normalized form of one code point: NFD without marks, đ -> d, lowercase.
function normalizeCp(cp: string): string {
  return cp.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gu, 'd').replace(/Đ/gu, 'd').toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

export function filterChat(text: string): string {
  const cps = Array.from(text);
  let norm = '';
  const owner: number[] = []; // normalized UTF-16 index -> original code point index
  cps.forEach((cp, i) => {
    const n = normalizeCp(cp);
    for (let k = 0; k < n.length; k++) owner.push(i);
    norm += n;
  });

  const covered = new Array<boolean>(cps.length).fill(false);
  for (const term of BANNED_WORDS) {
    const needle = Array.from(term).map(normalizeCp).join('');
    if (needle.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = norm.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const before = at > 0 ? norm.charAt(at - 1) : '';
      const after = end < norm.length ? norm.charAt(end) : '';
      if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
        for (let c = owner[at]!; c <= owner[end - 1]!; c++) covered[c] = true;
      }
      from = at + 1;
    }
  }

  let out = '';
  let inMask = false;
  cps.forEach((cp, i) => {
    if (covered[i]) {
      if (!inMask) out += MASK;
      inMask = true;
    } else {
      out += cp;
      inMask = false;
    }
  });
  return out;
}

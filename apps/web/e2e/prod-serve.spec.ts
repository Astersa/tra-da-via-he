import { expect, test, type Response } from '@playwright/test';
import { enterServer, uniqueName } from './helpers.js';

// Bản build do Nest phục vụ cùng origin, không qua Vite (M1-E6-T2). Mở trực tiếp server, không dùng baseURL của project.
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' });

const SERVER_NAME = 'Quán E2E';

interface CspViolation {
  violatedDirective: string;
  effectiveDirective: string;
  blockedURI: string;
  sourceFile: string;
}

// Phép thử eval trong try/catch của Phaser 4.2.1 (Function('') để dò khả năng eval) bị CSP chặn an toàn.
// Đây là loại duy nhất được phép: script-src, blockedURI 'eval', nguồn là bundle /assets/. Mọi vi phạm khác làm test fail.
function isAllowedPhaserEvalProbe(v: CspViolation): boolean {
  const scriptSrc = v.effectiveDirective === 'script-src' || v.violatedDirective === 'script-src';
  return scriptSrc && v.blockedURI === 'eval' && v.sourceFile.includes('/assets/');
}

test('Nest phục vụ web: canvas hiện, vào được world, không có lỗi CSP ngoài probe eval của Phaser', async ({ page }) => {
  const cspConsole: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) cspConsole.push(msg.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: CspViolation[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        blockedURI: e.blockedURI,
        sourceFile: e.sourceFile,
      });
    });
  });
  const documents: Response[] = [];
  page.on('response', (res) => {
    if (res.request().resourceType() === 'document') documents.push(res);
  });

  await enterServer(page, uniqueName('Khach'), SERVER_NAME);

  const doc = documents[0];
  expect(doc?.status()).toBe(200);
  expect(doc?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(doc?.headers()['cache-control']).toBe('no-cache');

  const violations = await page.evaluate(() => (window as unknown as { __csp: CspViolation[] }).__csp);
  expect(violations.filter((v) => !isAllowedPhaserEvalProbe(v))).toEqual([]);
  expect(cspConsole).toEqual([]);

  // Ảnh chụp để xem bằng mắt (chỉ khi E2E_SCREENSHOT trỏ tới một đường dẫn).
  if (process.env.E2E_SCREENSHOT) await page.screenshot({ path: process.env.E2E_SCREENSHOT });
});

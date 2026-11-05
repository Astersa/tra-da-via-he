/**
 * Module boundary rules (IMPLEMENTATION-PLAN.md §3.1, M0-E1-T7).
 *
 * Server: a module may import only the modules listed for it in ALLOWED.
 * The rules are generated for every module in MODULES, including modules whose
 * folders do not exist yet (shops, orders, ...), so the rule is already in
 * place when the folder is created.
 *
 * Judgement calls (not spelled out in §3.1):
 *   - `core` and `generated` (Prisma client output) may be imported by every
 *     server module. §3.1 treats core as the leaf kernel.
 *   - Files directly under apps/server/src (main.ts, app.module.ts, ...) are the
 *     composition root and are not restricted.
 */

const SERVER = 'apps/server/src';

const MODULES = [
  'core',
  'auth',
  'users',
  'economy',
  'servers',
  'session',
  'realtime',
  'world',
  'chat',
  'shops',
  'employment',
  'orders',
  'admin',
];

// Direct edges from the §3.1 mermaid diagram (A -> B means A may import B).
const ALLOWED = {
  realtime: ['orders', 'employment', 'shops', 'chat', 'world', 'session', 'economy'],
  employment: ['orders', 'shops', 'session'],
  orders: ['shops', 'session', 'economy'],
  shops: ['session', 'economy'],
  chat: ['session'],
  world: ['session', 'servers'],
  session: ['servers'],
  admin: ['economy', 'employment', 'users', 'servers', 'chat', 'session'],
  auth: ['users', 'economy'],
  servers: [],
  economy: [],
  users: [],
  core: [],
};

const serverModuleRules = MODULES.map((from) => {
  const allowed = new Set([from, 'core', 'generated', ...(ALLOWED[from] ?? [])]);
  const notAllowed = `^${SERVER}/(?!(?:${[...allowed].join('|')})/)[^/]+/`;
  return {
    name: `server-${from}-dependencies`,
    severity: 'error',
    comment: `apps/server/src/${from} may import only: ${[...allowed].join(', ')} (§3.1).`,
    from: { path: `^${SERVER}/${from}/` },
    to: { path: notAllowed },
  };
});

module.exports = {
  forbidden: [
    ...serverModuleRules,
    {
      name: 'web-game-not-ui',
      severity: 'error',
      comment: 'src/game (Phaser) must not import src/ui (React). Use src/game/bridge.ts and the store (§3.1).',
      from: { path: '^apps/web/src/game/' },
      to: { path: '^apps/web/src/ui/' },
    },
    {
      name: 'web-ui-not-game',
      severity: 'error',
      comment: 'src/ui (React) must not import src/game (Phaser). Use src/game/bridge.ts and the store (§3.1).',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/game/' },
    },
    {
      name: 'shared-not-apps',
      severity: 'error',
      comment: 'packages/shared must not import anything from apps/* (§3.1).',
      from: { path: '^packages/shared/src/' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-no-node-builtins',
      severity: 'error',
      comment: 'packages/shared runs in the browser: no Node built-in modules (§3.1).',
      from: { path: '^packages/shared/src/' },
      to: { dependencyTypes: ['core'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
};

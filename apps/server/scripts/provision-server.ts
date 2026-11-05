import { PrismaPg } from '@prisma/adapter-pg';
import { loadGameConfig } from '../src/core/game-config.js';
import { readPoolMax } from '../src/core/prisma.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ServerProvisioningService } from '../src/servers/server-provisioning.service.js';

// Usage: pnpm --filter @tdvh/server exec tsx scripts/provision-server.ts --slug=pho-co --name="Phố Cổ"
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const slug = arg('slug');
  const name = arg('name');
  if (!slug || !name) throw new Error('usage: --slug=<slug> --name=<name>');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: readPoolMax() }) });
  try {
    const svc = new ServerProvisioningService(prisma, loadGameConfig(process.env));
    const server = await svc.provision({ slug, name });
    console.log(`provisioned server id=${server.id} slug=${server.slug} status=${server.status}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

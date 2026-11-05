// Sinh packages/shared/src/map/street-01.json từ generator (§3.8, mục Map). Chạy: pnpm exec tsx scripts/gen-map.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStreet01, serializeMap } from "../packages/shared/src/map/gen-street-01.ts";

const out = resolve(__dirname, "../packages/shared/src/map/street-01.json");
writeFileSync(out, serializeMap(buildStreet01()), "utf8");
console.log(`wrote ${out}`);

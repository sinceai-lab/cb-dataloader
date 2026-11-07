import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContexts } from './context.js';
import { loadKeys } from './refs.js';
import { config } from './config.js';
import { detectSchema, loadSchemas } from './schemas.js';
import { loadCsv } from './loader.js';

// No args: load every indexed CSV. Args: CSV paths (schema detected from the header) or schema names.
if (!fs.existsSync(config.dataDir) || !fs.statSync(config.dataDir).isDirectory()) {
  console.error(
    `Data folder not found: ${config.dataDir}\n` +
      `Set DATA_DIR to the folder that contains 01_master, 02_raw_feeds, ... ` +
      `(default: raw-data/data in the repo root).`,
  );
  process.exit(1);
}
const schemas = loadSchemas();
const missing = [...schemas.values()].filter((s) => !fs.existsSync(s.source));
if (missing.length) {
  console.error(
    `${missing.length} of ${schemas.size} data files not found under ${config.dataDir}, e.g.\n` +
      missing
        .slice(0, 3)
        .map((s) => `  ${s.source}`)
        .join('\n') +
      `\nCheck DATA_DIR points at the folder that contains 01_master, 02_raw_feeds, ...`,
  );
  process.exit(1);
}
await writeContexts(schemas);
await loadKeys(schemas);
const loadedBy = process.env.LOADED_BY ?? os.userInfo().username;
const args = process.argv.slice(2);
const root = path.resolve(config.schemasDir, '..');
fs.mkdirSync(config.uploadsDir, { recursive: true });

const jobs: { name?: string; src: string }[] = args.length
  ? args.map((a) =>
      schemas.has(a)
        ? { name: a, src: path.resolve(root, schemas.get(a)!.source) }
        : { src: path.resolve(a) },
    )
  : [...schemas.values()].map((s) => ({ name: s.name, src: path.resolve(root, s.source) }));

let failed = 0;
for (const job of jobs) {
  const label = job.name ?? path.basename(job.src);
  try {
    if (!fs.existsSync(job.src))
      throw new Error(`file not found: ${job.src} (check DATA_DIR=${config.dataDir})`);
    const stored = path.join(config.uploadsDir, `${Date.now()}-${path.basename(job.src)}`);
    fs.copyFileSync(job.src, stored);
    const schema = job.name ? schemas.get(job.name)! : detectSchema(stored, path.basename(job.src), schemas);
    const r = await loadCsv(schema, { path: stored, originalname: path.basename(job.src) }, loadedBy);
    console.log(
      `${label} -> ${schema.name}: read ${r.rowsRead} loaded ${r.rowsLoaded} dropped ${r.rowsDropped} rejected ${r.rowsRejected}`,
    );
  } catch (err) {
    failed++;
    console.error(`${label}: FAILED ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);

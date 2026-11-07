import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContexts } from './context.js';
import { config } from './config.js';
import { detectSchema, loadSchemas } from './schemas.js';
import { loadCsv } from './loader.js';

// No args: load every indexed CSV. Args: CSV paths (schema detected from the header) or schema names.
const schemas = loadSchemas();
await writeContexts(schemas);
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
    if (!fs.existsSync(job.src)) throw new Error(`${job.src} not found`);
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

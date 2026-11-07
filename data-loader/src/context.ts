import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { attrName } from './entity.js';
import type { LoadableSchema } from './schemas.js';

const LOADLOG_TERMS = [
  'schema',
  'originalName',
  'storedPath',
  'sha256',
  'loadedBy',
  'loadedAt',
  'rowsRead',
  'rowsLoaded',
  'rowsDropped',
  'rowsRejected',
  'loadStatus',
  'refLoadLog',
];
// Nested Property names the loader emits; shared by every schema.
const SHARED = ['originalValue', 'unitText', 'refLoadLog'];

const write = (file: string, ctx: Record<string, string>) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ '@context': ctx }, null, 2));
};

// Ingest: <Schema>.jsonld maps each short column name to its URI (vocab + x-term).
// Read: user-context.jsonld maps the descriptive x-term to the same URI. Coraine rejects scoped
// contexts, so a term means one thing everywhere; conflicting units for a term fail the build.
export function writeContexts(schemas: Map<string, LoadableSchema>) {
  const dir = path.join(config.contextDir, 'schemas');
  fs.rmSync(dir, { recursive: true, force: true });
  const user: Record<string, string> = { '@vocab': config.vocab };
  const unitOf = new Map<string, string>();
  for (const s of schemas.values()) {
    const ctx: Record<string, string> = { '@vocab': config.vocab };
    for (const [col, spec] of Object.entries(s.properties)) {
      const term = spec['x-term'];
      if (!term) throw new Error(`${s.name}.${col} has no x-term`);
      const unit = [spec['x-unit-code'], spec['x-unit-text'], spec['x-unit-from']].join('|');
      if (unitOf.has(term) && unitOf.get(term) !== unit)
        throw new Error(`term ${term} has conflicting units`);
      unitOf.set(term, unit);
      ctx[attrName(col, term)] = config.vocab + term;
      user[term] = config.vocab + term;
    }
    for (const t of SHARED) ctx[t] = config.vocab + t;
    ctx[s.name] = config.vocab + s.name; // Coraine ignores @vocab for entity types
    write(path.join(dir, `${s.name}.jsonld`), ctx);
    user[s.name] = config.vocab + s.name;
  }
  for (const t of [...SHARED, 'LoadLog', ...LOADLOG_TERMS]) user[t] = config.vocab + t;
  write(path.join(dir, 'LoadLog.jsonld'), {
    '@vocab': config.vocab,
    LoadLog: config.vocab + 'LoadLog',
    ...Object.fromEntries(LOADLOG_TERMS.map((t) => [t, config.vocab + t])),
  });
  write(path.join(config.contextDir, 'user-context.jsonld'), user);
}

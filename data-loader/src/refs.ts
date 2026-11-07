import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'fast-csv';
import { config } from './config.js';
import type { LoadableSchema } from './schemas.js';

const keys = new Map<string, Set<string>>();

// Primary keys of every schema a Relationship can point at, read once from the source CSVs.
export async function loadKeys(schemas: Map<string, LoadableSchema>) {
  const wanted = new Set<string>(Object.values(config.altTargets).flat());
  for (const s of schemas.values()) for (const r of s.relations) wanted.add(r.target);
  for (const name of wanted) {
    const t = schemas.get(name);
    if (!t || t.primaryKey.length !== 1) continue;
    const set = new Set<string>();
    const src = path.resolve(config.schemasDir, '..', t.source);
    const stream = fs
      .createReadStream(src)
      .pipe(parse({ headers: true, delimiter: t.delimiter, ignoreEmpty: true }));
    for await (const row of stream as AsyncIterable<Record<string, string>>)
      set.add(row[t.primaryKey[0]].trim());
    keys.set(name, set);
  }
}

// The schema that owns `value`: the indexed target, else a configured alternative; null when none has it.
export function targetType(schema: string, col: string, value: unknown, primary: string): string | null {
  if (!keys.has(primary)) return primary;
  const v = String(value).trim();
  for (const t of [primary, ...(config.altTargets[`${schema}.${col}`] ?? [])])
    if (keys.get(t)?.has(v)) return t;
  return null;
}

import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { config } from './config.js';
import { attrName } from './entity.js';

export interface PropSpec {
  type?: string | string[];
  'x-term'?: string;
  'x-unit-code'?: string;
  'x-unit-text'?: string;
  'x-unit-from'?: string;
}

export interface Observation {
  subject?: { column: string; type: string };
  time: { year?: string; month?: string; date?: string };
  dimensions?: string[];
  // Attribute names the subject's own schema defines; an observation must not overwrite them.
  inherited?: Set<string>;
}

export type UnitMap = Record<string, { code?: string; text?: string }>;

export interface LoadableSchema {
  name: string;
  source: string;
  primaryKey: string[];
  properties: Record<string, PropSpec>;
  units: UnitMap;
  observation?: Observation;
  relations: { column: string; target: string }[];
  delimiter: string;
  decimalComma: boolean;
  validate: (row: unknown) => boolean;
  errors: () => string[];
}

// Only CSV sources are loadable; parquet, geojson and json-per-file are out of scope.
export function loadSchemas(): Map<string, LoadableSchema> {
  // Fresh instance per call: ajv rejects compiling the same $id twice.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  const index = JSON.parse(fs.readFileSync(path.join(config.schemasDir, 'index.json'), 'utf8'));
  const out = new Map<string, LoadableSchema>();
  const { description: _d, ...units } = JSON.parse(
    fs.readFileSync(path.join(config.schemasDir, 'units.json'), 'utf8'),
  );
  const pks = new Map<string, string[]>(
    index.schemas.map((e: { schema: string; primaryKey: string[] }) => [
      e.schema.replace(/\.json$/, ''),
      e.primaryKey,
    ]),
  );
  // Only "A.col -> B.pk" joins where pk is B's single-column key can become Relationships.
  const relOf = (name: string) =>
    (index.relationships as { from: string; to: string }[]).flatMap((r) => {
      const [from, column] = r.from.split('.');
      const m = /^(\w+)\.(\w+)$/.exec(r.to);
      const pk = m && pks.get(m[1]);
      return from === name && m && pk?.length === 1 && pk[0] === m[2] ? [{ column, target: m[1] }] : [];
    });
  for (const entry of index.schemas as { schema: string; source: string; primaryKey: string[] }[]) {
    if (!entry.source.endsWith('.csv')) continue;
    const file = path.join(config.schemasDir, entry.schema);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const semi = String(raw['x-source-format'] ?? '').includes("';'");
    const validate = ajv.compile(raw);
    const name = entry.schema.replace(/\.json$/, '');
    out.set(name, {
      name,
      // Package files live under DATA_DIR; repo-local sources (e.g. derived/) resolve from the repo root.
      source: /\/data\//.test(entry.source)
        ? path.join(config.dataDir, entry.source.replace(/^.*?\/data\//, ''))
        : path.resolve(config.schemasDir, '..', entry.source),
      primaryKey: entry.primaryKey,
      properties: raw.properties,
      units,
      observation: raw['x-observation'],
      relations: relOf(name),
      delimiter: semi ? ';' : ',',
      decimalComma: semi,
      validate: (row) => validate(row) as boolean,
      errors: () => (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`),
    });
  }
  for (const s of out.values()) {
    const base = s.observation?.subject && out.get(s.observation.subject.type);
    if (base)
      s.observation!.inherited = new Set(
        Object.entries(base.properties).map(([c, p]) => attrName(c, p['x-term'])),
      );
  }
  return out;
}

const norm = (h: string) =>
  h
    .replace(/^\uFEFF/, '')
    .replace(/^"|"$/g, '')
    .trim();

// Matches a CSV header to the schema with exactly the same column set; ties go to the schema whose
// indexed source file has the same name. Throws with the closest candidate when nothing matches.
export function detectSchema(file: string, originalName: string, schemas: Map<string, LoadableSchema>) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8192);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const line = buf.toString('utf8', 0, n).split(/\r?\n/)[0];
  const exact: LoadableSchema[] = [];
  let best = { name: '', score: 0 };
  for (const s of schemas.values()) {
    const have = new Set(line.split(s.delimiter).map(norm));
    const want = new Set(Object.keys(s.properties));
    const common = [...have].filter((h) => want.has(h)).length;
    if (common === have.size && common === want.size) exact.push(s);
    const score = common / (have.size + want.size - common);
    if (score > best.score) best = { name: s.name, score };
  }
  const base = path.basename(originalName).replace(/^\d+-/, '');
  const pick = exact.length > 1 ? exact.find((s) => path.basename(s.source) === base) : exact[0];
  if (!pick) {
    const why =
      exact.length > 1 ? `ambiguous between ${exact.map((s) => s.name).join(', ')}` : 'no schema matches';
    throw new Error(`${originalName}: ${why}; closest is ${best.name || 'none'} (${best.score.toFixed(2)})`);
  }
  return pick;
}

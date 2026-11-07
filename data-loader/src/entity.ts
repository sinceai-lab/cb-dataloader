import { targetType } from './refs.js';
import type { LoadableSchema } from './schemas.js';

// Reserved members and ngsi-ld-core-context v1.8 terms override ours, so those columns use their x-term.
export const CORE = new Set(['id', 'type', 'scope', 'mode', 'reason', 'value', 'status']);
export const attrName = (col: string, term?: string) => (CORE.has(col) && term ? term : col);

const types = (t?: string | string[]) => (Array.isArray(t) ? t : t ? [t] : []);

// Empty cell becomes null when the schema allows it, otherwise the key is left out so "required" fails.
export function coerceRow(schema: LoadableSchema, raw: Record<string, string>) {
  const row: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(raw)) {
    const t = types(schema.properties[col]?.type);
    if (val === '' || val === undefined) {
      if (t.includes('null')) row[col] = null;
      continue;
    }
    if (t.includes('boolean')) {
      const b = val.trim().toLowerCase();
      row[col] = b === 'true' ? true : b === 'false' ? false : val;
    } else if (t.includes('integer') || t.includes('number')) {
      const n = Number(schema.decimalComma ? val.replace(',', '.') : val);
      row[col] = Number.isNaN(n) ? val : n;
    } else row[col] = val;
  }
  return row;
}

const urn = (type: string, key: unknown) => `urn:ngsi-ld:${type}:${String(key).replace(/\s+/g, '_')}`;
export const slug = (v: unknown) =>
  String(v)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_|_$/g, '');

// Start of the period the row describes. undefined: schema has no time; null: unparseable.
export function observedAt(schema: LoadableSchema, row: Record<string, unknown>) {
  const t = schema.observation?.time;
  if (!t) return undefined;
  if (t.date) {
    const d = new Date(String(row[t.date]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
  }
  const y = Number(row[t.year ?? '']);
  const m = t.month ? Number(row[t.month]) : 1;
  if (!Number.isInteger(y) || y < 1000 || y > 9999 || !Number.isInteger(m) || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`;
}

export interface Unit {
  code?: string;
  text?: string;
}

// Numeric values get a unit (UN/CEFACT code and/or text) from the schema annotations or the row's unit column.
function unitOf(schema: LoadableSchema, row: Record<string, unknown>, col: string, value: unknown): Unit {
  if (typeof value !== 'number') return {};
  const spec = schema.properties[col] ?? {};
  let code = spec['x-unit-code'];
  let text = spec['x-unit-text'];
  const from = spec['x-unit-from'];
  const raw = from ? row[from] : undefined;
  if (typeof raw === 'string' && raw !== '') {
    const u = schema.units[raw];
    code = u?.code;
    text = u ? u.text : raw;
  }
  return { code, text };
}

function property(schema: LoadableSchema, row: Record<string, unknown>, col: string, value: unknown) {
  const attr: Record<string, unknown> = { type: 'Property', value };
  const { code, text } = unitOf(schema, row, col, value);
  if (code) attr.unitCode = code;
  if (text) attr.unitText = { type: 'Property', value: text };
  return attr;
}

// Joins become Relationships to the target URN; the source value is kept as a nested Property.
// A value no target owns stays a plain Property and is flagged, so no Relationship points at nothing.
function valueAttr(
  schema: LoadableSchema,
  row: Record<string, unknown>,
  col: string,
  value: unknown,
  flags: string[] = [],
) {
  const rel = schema.relations.find((r) => r.column === col);
  if (!rel) return property(schema, row, col, value);
  const target = targetType(schema.name, col, value, rel.target);
  if (!target) {
    flags.push(`${col}: no ${rel.target} with key ${String(value)}`);
    return property(schema, row, col, value);
  }
  return {
    type: 'Relationship',
    object: urn(target, value),
    originalValue: { type: 'Property', value },
  };
}

// refLoadLog and observedAt live on each attribute value, not on the entity.
function stamp(attrs: Record<string, unknown>, loadLogId: string, at?: string) {
  for (const a of Object.values(attrs) as Record<string, unknown>[]) {
    if (at) a.observedAt = at;
    a.refLoadLog = { type: 'Relationship', object: loadLogId };
  }
}

export function toEntity(
  schema: LoadableSchema,
  row: Record<string, unknown>,
  loadLogId: string,
  at?: string,
  flags: string[] = [],
) {
  const key = schema.primaryKey.map((k) => String(row[k]).replace(/\s+/g, '_')).join(':');
  const attrs: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (value !== null)
      attrs[attrName(col, schema.properties[col]?.['x-term'])] = valueAttr(schema, row, col, value, flags);
  }
  const { lat, lon } = row;
  if (typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    // GeoJSON order is [lon, lat]; replaces the plain lat/lon Properties.
    delete attrs.lat;
    delete attrs.lon;
    attrs.location = { type: 'GeoProperty', value: { type: 'Point', coordinates: [lon, lat] } };
  }
  stamp(attrs, loadLogId, at);
  return { id: `urn:ngsi-ld:${schema.name}:${key}`, type: schema.name, ...attrs };
}

// Columns that become observation attributes; the rest identify the subject, time or dimension.
export function observedColumns(schema: LoadableSchema) {
  const o = schema.observation!;
  const skip = new Set([o.subject!.column, ...Object.values(o.time), ...(o.dimensions ?? [])]);
  for (const p of Object.values(schema.properties)) if (p['x-unit-from']) skip.add(p['x-unit-from']);
  const inherited = o.inherited ?? new Set<string>();
  return Object.keys(schema.properties).filter(
    (c) => !skip.has(c) && !inherited.has(schema.properties[c]?.['x-term'] ?? c),
  );
}

export const observationTerm = (schema: LoadableSchema, col: string) =>
  schema.properties[col]?.['x-term'] ?? col;

export interface ObservedValue {
  path: string[];
  value: unknown;
  unit: Unit;
}

// One CSV row of a subject entity (e.g. a Farm and year): one value per attribute at the row's dimension path (e.g. crop).
export function toObservation(schema: LoadableSchema, row: Record<string, unknown>, at: string) {
  const o = schema.observation!;
  const path = (o.dimensions ?? []).map((d) => slug(row[d]));
  const values: Record<string, ObservedValue> = {};
  for (const col of observedColumns(schema)) {
    const value = row[col];
    if (value === null || value === undefined) continue;
    values[observationTerm(schema, col)] = { path, value, unit: unitOf(schema, row, col, value) };
  }
  return { id: urn(o.subject!.type, row[o.subject!.column]), values, at };
}

const nest = (target: Record<string, unknown>, path: string[], leaf: unknown) => {
  let node = target;
  for (const k of path.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
  node[path[path.length - 1]] = leaf;
};

// All rows of one subject and time collapse into one attribute: {pea: 7, carrots: 23}, nested per extra dimension.
// A single unit is shared by the attribute; mixed units go into a unitText object shaped like the value.
export function observedAttr(parts: ObservedValue[]) {
  if (parts.length === 1 && parts[0].path.length === 0) {
    const { value, unit } = parts[0];
    const attr: Record<string, unknown> = { type: 'Property', value };
    if (unit.code) attr.unitCode = unit.code;
    if (unit.text) attr.unitText = { type: 'Property', value: unit.text };
    return attr;
  }
  const value: Record<string, unknown> = {};
  const texts: Record<string, unknown> = {};
  const units = new Set<string>();
  for (const p of parts) {
    nest(value, p.path, p.value);
    if (p.unit.code || p.unit.text) {
      nest(texts, p.path, p.unit.text ?? p.unit.code);
      units.add(`${p.unit.code ?? ''}|${p.unit.text ?? ''}`);
    }
  }
  const attr: Record<string, unknown> = { type: 'Property', value };
  const numeric = parts.filter((p) => typeof p.value === 'number').length;
  const withUnit = parts.filter((p) => p.unit.code || p.unit.text).length;
  if (units.size === 1 && withUnit === numeric) {
    const { code, text } = parts.find((p) => p.unit.code || p.unit.text)!.unit;
    if (code) attr.unitCode = code;
    if (text) attr.unitText = { type: 'Property', value: text };
  } else if (units.size > 0) attr.unitText = { type: 'Property', value: texts };
  return attr;
}

export { stamp };

import type { LoadableSchema } from './schemas.js';

// Reserved members and ngsi-ld-core-context v1.8 terms override ours, so those columns use their x-term.
const CORE = new Set(['id', 'type', 'scope', 'mode', 'reason', 'value', 'status']);
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
const slug = (v: unknown) =>
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

// Numeric values get unitCode (UN/CEFACT) and/or a nested unitText Property from the schema annotations.
function property(schema: LoadableSchema, row: Record<string, unknown>, col: string, value: unknown) {
  const attr: Record<string, unknown> = { type: 'Property', value };
  if (typeof value !== 'number') return attr;
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
  if (code) attr.unitCode = code;
  if (text) attr.unitText = { type: 'Property', value: text };
  return attr;
}

// Joins become Relationships to the target URN; the source value is kept as a nested Property.
function valueAttr(schema: LoadableSchema, row: Record<string, unknown>, col: string, value: unknown) {
  const rel = schema.relations.find((r) => r.column === col);
  if (!rel) return property(schema, row, col, value);
  return {
    type: 'Relationship',
    object: urn(rel.target, value),
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
) {
  const key = schema.primaryKey.map((k) => String(row[k]).replace(/\s+/g, '_')).join(':');
  const attrs: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (value !== null)
      attrs[attrName(col, schema.properties[col]?.['x-term'])] = valueAttr(schema, row, col, value);
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

// One observation of a subject entity (e.g. a Site): attribute names get the dimension values appended.
export function toObservation(schema: LoadableSchema, row: Record<string, unknown>, at: string) {
  const o = schema.observation!;
  const skip = new Set([o.subject!.column, ...Object.values(o.time), ...(o.dimensions ?? [])]);
  for (const p of Object.values(schema.properties)) if (p['x-unit-from']) skip.add(p['x-unit-from']);
  const suffix = (o.dimensions ?? []).map((d) => slug(row[d])).join('_');
  const attrs: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (skip.has(col) || value === null) continue;
    const base = schema.properties[col]?.['x-term'] ?? col;
    attrs[suffix ? `${base}_${suffix}` : base] = valueAttr(schema, row, col, value);
  }
  return { id: urn(o.subject!.type, row[o.subject!.column]), attrs, at };
}

export { stamp };

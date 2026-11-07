import fs from 'node:fs';
import { parse } from 'fast-csv';
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
import { upsertErrors } from './coraine.js';

// Replays daily weather as WeatherObserved entities, --batch rows per upsert every --interval seconds.
// Usage: npm run replay -- <file.csv|file.parquet> [--interval 6] [--batch 1] [--cell GF0104] [--scenario ssp245] [--from 2027-06-01] [--to 2027-09-30] [--limit 20] [--dry-run]
const [file, ...rest] = process.argv.slice(2);
const opt = (name: string) => rest[rest.indexOf(`--${name}`) + 1];
const has = (name: string) => rest.includes(`--${name}`);
if (!file)
  throw new Error(
    'usage: replay <file.csv|file.parquet> [--interval s] [--batch n] [--cell id] [--scenario s] [--from date] [--to date] [--limit n] [--dry-run]',
  );

const MAX_BATCH = 500;
const interval = Number(has('interval') ? opt('interval') : 6) * 1000;
const limit = Number(has('limit') ? opt('limit') : Infinity);
const batch = Number(has('batch') ? opt('batch') : 1);
if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH)
  throw new Error(`--batch must be an integer from 1 to ${MAX_BATCH}`);
const dryRun = has('dry-run');
// A dry run prints one JSON array of entities per batch on stdout; progress goes to stderr.
const log = dryRun ? console.error : console.log;
const keep = (r: Row) =>
  (!has('cell') || r.cell_id === opt('cell')) &&
  (!has('scenario') || r.scenario === opt('scenario')) &&
  (!has('from') || r.date >= opt('from')) &&
  (!has('to') || r.date <= opt('to'));

interface Row {
  cell_id: string;
  date: string;
  scenario: string;
  tmean_c: number;
  tmax_c: number;
  tmin_c?: number;
  precip_mm: number;
  pet_mm: number;
}

const toRow = (r: Record<string, unknown>): Row => ({
  cell_id: String(r.cell_id),
  date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
  scenario: String(r.scenario),
  tmean_c: Number(r.tmean_c),
  tmax_c: Number(r.tmax_c),
  ...(r.tmin_c !== undefined && r.tmin_c !== null && r.tmin_c !== '' && { tmin_c: Number(r.tmin_c) }),
  precip_mm: Number(r.precip_mm),
  pet_mm: Number(r.pet_mm),
});

// The parquet is read in slices so 4M rows never sit in memory; matching rows stream out as found.
async function* rows(): AsyncGenerator<Row> {
  if (file.endsWith('.parquet')) {
    const buf = await asyncBufferFromFile(file);
    const present = new Set(
      parquetSchema(await parquetMetadataAsync(buf)).children.map((c) => c.element.name),
    );
    const wanted = ['cell_id', 'date', 'scenario', 'tmean_c', 'tmax_c', 'tmin_c', 'precip_mm', 'pet_mm'];
    const columns = wanted.filter((c) => c !== 'tmin_c' || present.has(c));
    const step = 100_000;
    for (let start = 0; ; start += step) {
      const chunk = await parquetReadObjects({ file: buf, columns, rowStart: start, rowEnd: start + step });
      if (!chunk.length) return;
      for (const r of chunk) yield toRow(r);
    }
  } else {
    const stream = fs.createReadStream(file).pipe(parse({ headers: true, ignoreEmpty: true }));
    for await (const r of stream as AsyncIterable<Record<string, string>>) yield toRow(r);
  }
}

const prop = (value: unknown, unitCode?: string) => ({
  type: 'Property',
  value,
  ...(unitCode && { unitCode }),
});

// The scenario is in the id so ssp126/ssp245/ssp585 for the same cell and date don't overwrite each other.
const entity = (r: Row) => ({
  id: `urn:ngsi-ld:WeatherObserved:${r.cell_id}:${r.scenario}:${r.date}`,
  type: 'WeatherObserved',
  cellId: prop(r.cell_id),
  dateObserved: prop(r.date),
  climateScenario: prop(r.scenario),
  temperature: prop(r.tmean_c, 'CEL'),
  temperatureMax: prop(r.tmax_c, 'CEL'),
  ...(r.tmin_c !== undefined && { temperatureMin: prop(r.tmin_c, 'CEL') }),
  precipitation: prop(r.precip_mm, 'MMT'),
  referenceEvapotranspiration: prop(r.pet_mm, 'MMT'),
});

let sent = 0;
let rejectedTotal = 0;
let flushes = 0;
const pending: Row[] = [];
async function flush() {
  if (!pending.length) return;
  if (flushes++ && !dryRun) await new Promise((res) => setTimeout(res, interval));
  const group = pending.splice(0);
  const entities = group.map(entity);
  const errors = dryRun ? [] : await upsertErrors(entities, 'user-context.jsonld');
  sent += group.length;
  rejectedTotal += errors.length;
  if (dryRun) console.log(JSON.stringify(entities));
  for (const e of errors)
    console.error(
      `  REJECTED ${e.entityId ?? '?'}: ${e.error?.title ?? ''} ${e.error?.detail ?? ''}`.trimEnd(),
    );
  const r = group[0];
  if (group.length === 1)
    log(
      `[${sent}] ${r.cell_id} ${r.scenario} ${r.date} temp ${r.tmean_c} max ${r.tmax_c} min ${r.tmin_c ?? '-'} rain ${r.precip_mm} pet ${r.pet_mm} ${errors.length ? 'REJECTED' : 'ok'}`,
    );
  else
    log(
      `[${sent}] ${group.length} rows ${r.cell_id} ${r.scenario} ${r.date} .. ${group.at(-1)!.cell_id} ${group.at(-1)!.date} ${errors.length ? `${errors.length} REJECTED` : 'ok'}`,
    );
}

let matched = 0;
for await (const r of rows()) {
  if (!keep(r)) continue;
  pending.push(r);
  matched++;
  if (pending.length >= batch) await flush();
  if (matched >= limit) break;
}
await flush();
log(
  `replayed ${sent} rows${dryRun ? ' (dry run, nothing sent)' : ''}${rejectedTotal ? `, ${rejectedTotal} rejected` : ''}`,
);

import fs from 'node:fs';
import { parse } from 'fast-csv';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { upsert } from './coraine.js';

// Replays daily weather as WeatherObserved entities, one every --interval seconds.
// Usage: npm run replay -- <file.csv|file.parquet> [--interval 6] [--cell GF0104] [--scenario ssp245] [--from 2027-06-01] [--limit 20]
const [file, ...rest] = process.argv.slice(2);
const opt = (name: string) => rest[rest.indexOf(`--${name}`) + 1];
const has = (name: string) => rest.includes(`--${name}`);
if (!file)
  throw new Error(
    'usage: replay <file.csv|file.parquet> [--interval s] [--cell id] [--scenario s] [--from date] [--limit n]',
  );

const interval = Number(has('interval') ? opt('interval') : 6) * 1000;
const limit = Number(has('limit') ? opt('limit') : Infinity);
const keep = (r: Row) =>
  (!has('cell') || r.cell_id === opt('cell')) &&
  (!has('scenario') || r.scenario === opt('scenario')) &&
  (!has('from') || r.date >= opt('from'));

interface Row {
  cell_id: string;
  date: string;
  scenario: string;
  tmean_c: number;
  tmax_c: number;
  precip_mm: number;
  pet_mm: number;
}

const toRow = (r: Record<string, unknown>): Row => ({
  cell_id: String(r.cell_id),
  date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
  scenario: String(r.scenario),
  tmean_c: Number(r.tmean_c),
  tmax_c: Number(r.tmax_c),
  precip_mm: Number(r.precip_mm),
  pet_mm: Number(r.pet_mm),
});

// The parquet is read in slices so 4M rows never sit in memory; matching rows stream out as found.
async function* rows(): AsyncGenerator<Row> {
  if (file.endsWith('.parquet')) {
    const buf = await asyncBufferFromFile(file);
    const columns = ['cell_id', 'date', 'scenario', 'tmean_c', 'tmax_c', 'precip_mm', 'pet_mm'];
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

const entity = (r: Row) => ({
  id: `urn:ngsi-ld:WeatherObserved:${r.cell_id}:${r.date}`,
  type: 'WeatherObserved',
  cellId: prop(r.cell_id),
  dateObserved: prop(r.date),
  temperature: prop(r.tmean_c, 'CEL'),
  temperatureMax: prop(r.tmax_c, 'CEL'),
  precipitation: prop(r.precip_mm, 'MMT'),
  referenceEvapotranspiration: prop(r.pet_mm, 'MMT'),
});

let sent = 0;
for await (const r of rows()) {
  if (!keep(r)) continue;
  if (sent) await new Promise((res) => setTimeout(res, interval));
  const rejected = await upsert([entity(r)], 'user-context.jsonld');
  sent++;
  console.log(
    `[${sent}] ${r.cell_id} ${r.date} temp ${r.tmean_c} max ${r.tmax_c} rain ${r.precip_mm} pet ${r.pet_mm} ${rejected ? 'REJECTED' : 'ok'}`,
  );
  if (sent >= limit) break;
}
console.log(`replayed ${sent} rows`);

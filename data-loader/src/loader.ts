import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse } from 'fast-csv';
import { config } from './config.js';
import { upsert } from './coraine.js';
import {
  coerceRow,
  observedAt,
  observedAttr,
  stamp,
  toEntity,
  toObservation,
  type ObservedValue,
} from './entity.js';
import { sendAnomalies, type Anomaly } from './anomalies.js';
import { writeLoadLog, type LoadLog } from './loadlog.js';
import type { LoadableSchema } from './schemas.js';

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });

export async function loadCsv(
  schema: LoadableSchema,
  file: { path: string; originalname: string },
  loadedBy: string,
) {
  const hash = await sha256(file.path);
  const log: LoadLog = {
    id: `urn:ngsi-ld:LoadLog:${Date.now()}-${hash.slice(0, 8)}`,
    schema: schema.name,
    originalName: file.originalname,
    storedPath: file.path,
    sha256: hash,
    loadedBy,
    loadedAt: new Date().toISOString(),
    rowsRead: 0,
    rowsLoaded: 0,
    rowsDropped: 0,
    rowsRejected: 0,
    loadStatus: 'running',
  };
  await writeLoadLog(log);

  const anomalies: Anomaly[] = [];
  const drop = (raw: Record<string, string>, errors: string[]) => {
    log.rowsDropped++;
    anomalies.push({ loadLogId: log.id, schema: schema.name, rowNumber: log.rowsRead, errors, raw });
  };
  const ctx = `schemas/${schema.name}.jsonld`;
  const send = async (batch: { entity: unknown; rows: number }[]) => {
    const rejected = await upsert(
      batch.map((b) => b.entity),
      ctx,
    );
    log.rowsRejected += rejected;
    log.rowsLoaded += batch.reduce((n, b) => n + b.rows, 0) - rejected;
  };
  const sendChunked = async (items: { entity: unknown; rows: number }[]) => {
    for (let i = 0; i < items.length; i += config.batchSize) await send(items.slice(i, i + config.batchSize));
  };
  const subject = !!schema.observation?.subject;
  const rowEntities: { entity: unknown; rows: number }[] = [];
  // Rows are grouped by subject and time (the files are not sorted by year), then written as one observation each.
  const byEntity = new Map<string, Map<string, { values: Map<string, ObservedValue[]>; rows: number }>>();
  const seen = new Set<string>();

  try {
    const stream = fs
      .createReadStream(file.path)
      .pipe(parse({ headers: true, delimiter: schema.delimiter, ignoreEmpty: true }));
    for await (const raw of stream as AsyncIterable<Record<string, string>>) {
      log.rowsRead++;
      const row = coerceRow(schema, raw);
      if (!schema.validate(row)) {
        drop(raw, schema.errors());
        continue;
      }
      const at = observedAt(schema, row);
      if (at === null) {
        drop(raw, ['unparseable observation time']);
        continue;
      }
      if (!subject) {
        rowEntities.push({ entity: toEntity(schema, row, log.id, at), rows: 1 });
        if (rowEntities.length >= config.batchSize) {
          await sendChunked(rowEntities.splice(0));
        }
        continue;
      }
      const obs = toObservation(schema, row, at!);
      const keys = Object.entries(obs.values).map(([t, v]) => `${obs.id}|${at}|${t}|${v.path.join('/')}`);
      if (keys.some((k) => seen.has(k))) {
        drop(raw, ['duplicate observation for subject, time and dimension']);
        continue;
      }
      keys.forEach((k) => seen.add(k));
      const times = byEntity.get(obs.id) ?? new Map();
      const slot = times.get(at) ?? { values: new Map(), rows: 0 };
      for (const [term, v] of Object.entries(obs.values))
        slot.values.set(term, [...(slot.values.get(term) ?? []), v]);
      slot.rows++;
      times.set(at, slot);
      byEntity.set(obs.id, times);
    }
    await sendChunked(rowEntities.splice(0));
    // Wave k holds each entity's k-th observation in time order, so history is written chronologically.
    const queues = [...byEntity].map(([id, t]) => ({
      id,
      list: [...t].sort(([x], [y]) => x.localeCompare(y)),
    }));
    for (let k = 0; queues.some((q) => k < q.list.length); k++) {
      const wave = queues
        .filter((q) => k < q.list.length)
        .map((q) => {
          const [at, slot] = q.list[k];
          const attrs = Object.fromEntries([...slot.values].map(([t, parts]) => [t, observedAttr(parts)]));
          stamp(attrs, log.id, at);
          return {
            entity: { id: q.id, type: schema.observation!.subject!.type, ...attrs },
            rows: slot.rows,
          };
        });
      await sendChunked(wave);
    }
    await sendAnomalies(anomalies);
    log.loadStatus = 'complete';
  } catch (err) {
    log.loadStatus = 'failed';
    await writeLoadLog(log);
    throw err;
  }
  await writeLoadLog(log);
  return { ...log, sampleDropped: anomalies.slice(0, 20) };
}

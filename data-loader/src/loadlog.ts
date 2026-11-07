import { upsert } from './coraine.js';

export interface LoadLog {
  id: string;
  schema: string;
  originalName: string;
  storedPath: string;
  sha256: string;
  loadedBy: string;
  loadedAt: string;
  rowsRead: number;
  rowsLoaded: number;
  rowsDropped: number;
  rowsRejected: number;
  loadStatus: 'running' | 'complete' | 'failed';
}

const prop = (value: unknown) => ({ type: 'Property', value });

export async function writeLoadLog(log: LoadLog) {
  const { id, ...rest } = log;
  const entity: Record<string, unknown> = { id, type: 'LoadLog' };
  for (const [k, v] of Object.entries(rest)) entity[k] = prop(v);
  await upsert([entity], 'schemas/LoadLog.jsonld');
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3100),
  coraineUrl: process.env.CORAINE_URL ?? `http://localhost:${process.env.CORAINE_PORT ?? 1026}`,
  contextBase: process.env.CONTEXT_BASE ?? 'http://context',
  vocab: 'https://apetit.sinceai2026.example/ns#',
  // Folder holding the CSVs (the one containing 00_apetit_original ... 07_frameworks).
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, '../../raw-data/data')),
  schemasDir: path.resolve(here, '../../schemas'),
  uploadsDir: path.resolve(here, '../uploads'),
  contextDir: path.resolve(here, '../../data-models'),
  // A Relationship column whose values may also belong to another schema (supplier_id holds farm ids).
  altTargets: { 'ErpPurchaseLine.supplier_id': ['Farm'] } as Record<string, string[]>,
  batchSize: Number(process.env.BATCH_SIZE ?? 500),
};

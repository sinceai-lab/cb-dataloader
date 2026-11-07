import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3100),
  coraineUrl: process.env.CORAINE_URL ?? `http://localhost:${process.env.CORAINE_PORT ?? 1026}`,
  contextBase: process.env.CONTEXT_BASE ?? 'http://context',
  vocab: 'https://apetit.sinceai2026.example/ns#',
  schemasDir: path.resolve(here, '../../schemas'),
  uploadsDir: path.resolve(here, '../uploads'),
  contextDir: path.resolve(here, '../../data-models'),
  batchSize: 500,
};

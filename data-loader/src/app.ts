import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { config } from './config.js';
import { detectSchema, loadSchemas } from './schemas.js';
import { writeContexts } from './context.js';
import { loadCsv } from './loader.js';

export async function createApp() {
  const schemas = loadSchemas();
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  await writeContexts(schemas);

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (_req, f, cb) => cb(null, `${Date.now()}-${f.originalname.replace(/[^\w.-]/g, '_')}`),
    }),
  });

  const app = express();
  app.get('/load', (_req, res) => res.json([...schemas.keys()].map((s) => `/load/${s}`)));

  app.post('/load', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return void res.status(400).json({ error: 'multipart field "file" required' });
      const schema = detectSchema(req.file.path, req.file.originalname, schemas);
      res.json(await loadCsv(schema, req.file, req.header('X-Loaded-By') ?? 'unknown'));
    } catch (err) {
      next(err);
    }
  });

  app.post('/load/:schema', upload.single('file'), async (req, res, next) => {
    try {
      const name = String(req.params.schema);
      const schema = schemas.get(name);
      if (!schema) return void res.status(404).json({ error: `unknown schema ${name}` });
      if (!req.file) return void res.status(400).json({ error: 'multipart field "file" required' });
      const loadedBy = req.header('X-Loaded-By') ?? 'unknown';
      res.json(await loadCsv(schema, req.file, loadedBy));
    } catch (err) {
      next(err);
    }
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
  return app;
}

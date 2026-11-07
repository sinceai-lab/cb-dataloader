import { loadSchemas } from './schemas.js';
import { writeContexts } from './context.js';

await writeContexts(loadSchemas());

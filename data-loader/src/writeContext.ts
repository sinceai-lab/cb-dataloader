import { loadSchemas } from './schemas.js';
import { writeContexts } from './context.js';

writeContexts(loadSchemas());

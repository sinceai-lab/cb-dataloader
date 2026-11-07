import { createApp } from './app.js';
import { config } from './config.js';

(await createApp()).listen(config.port, () => console.log(`data-loader on :${config.port}`));

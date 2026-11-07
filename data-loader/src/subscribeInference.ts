import { config } from './config.js';

// (Re)creates the model-inference subscription on WeatherObserved. No throttling: dropped days get filled.
// Usage: npm run subscribe:inference [-- --dry-run]   env: CORAINE_URL, NOTIFY_URL
const id = 'urn:ngsi-ld:Subscription:apetit-yield';
const notifyUrl = process.env.NOTIFY_URL ?? 'http://host.docker.internal:8600/notify';
const contextUrl = `${config.contextBase}/user-context.jsonld`;
const url = `${config.coraineUrl}/ngsi-ld/v1/subscriptions`;
const headers = {
  'Content-Type': 'application/json',
  Link: `<${contextUrl}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`,
};
const body = {
  id,
  type: 'Subscription',
  description: 'Daily weather for the Apetit yield backend (model-inference)',
  entities: [{ type: 'WeatherObserved' }],
  notification: {
    format: 'normalized',
    endpoint: { uri: notifyUrl, accept: 'application/json' },
  },
};

if (process.argv.includes('--dry-run')) {
  console.log(`POST ${url}\nLink: ${headers.Link}\n${JSON.stringify(body, null, 2)}`);
  process.exit(0);
}
const del = await fetch(`${url}/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
if (!del.ok && del.status !== 404) throw new Error(`delete ${id}: ${del.status} ${await del.text()}`);
const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`create ${id}: ${res.status} ${await res.text()}`);
console.log(`subscription ${id} -> ${notifyUrl} (${del.ok ? 'recreated' : 'created'})`);

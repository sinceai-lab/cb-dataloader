import { config } from './config.js';

const link = (ctx: string) =>
  `<${config.contextBase}/${ctx}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`;

export interface UpsertError {
  entityId?: string;
  error?: { type?: string; title?: string; detail?: string };
}

// Returns the number of entities Coraine rejected; throws on transport or whole-request failure.
export async function upsert(entities: unknown[], ctx: string, tenant?: string): Promise<number> {
  return (await upsertErrors(entities, ctx, tenant)).length;
}

// Same as upsert, but returns the 207 errors (entityId + problem details) for logging.
export async function upsertErrors(
  entities: unknown[],
  ctx: string,
  tenant?: string,
): Promise<UpsertError[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Link: link(ctx) };
  if (tenant) headers['NGSILD-Tenant'] = tenant;
  const res = await fetch(`${config.coraineUrl}/ngsi-ld/v1/entityOperations/upsert?options=update`, {
    method: 'POST',
    headers,
    body: JSON.stringify(entities),
  });
  if (res.status === 207) {
    const body = (await res.json()) as { errors?: UpsertError[] };
    return body.errors ?? [];
  }
  if (!res.ok) throw new Error(`Coraine ${res.status}: ${await res.text()}`);
  return [];
}

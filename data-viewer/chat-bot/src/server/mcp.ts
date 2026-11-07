import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpToolDef } from '../shared/types.js';

// The bearer token is fixed when the transport is built, so a refreshed token means
// a new connection rather than a mutated header.
export async function connectMcp(url: string, token?: string, tries = 10): Promise<Client> {
  const init = token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined;
  for (let i = 1; ; i++) {
    try {
      const client = new Client({ name: 'ngsi-ld-chat-bot', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url), init));
      return client;
    } catch (e) {
      if (i >= tries) throw e;
      console.warn(
        `MCP connect failed (${i}/${tries}); retrying in 3s. If the broker is down, run ./services start`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function listToolDefs(client: Client): Promise<McpToolDef[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
  }));
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  try {
    const res = await client.callTool({ name, arguments: args });
    const blocks = (res.content ?? []) as Array<{ type: string; text?: string }>;
    const content = blocks
      .map((b) => (b.type === 'text' ? b.text ?? '' : JSON.stringify(b)))
      .join('\n');
    return { content, isError: Boolean(res.isError) };
  } catch (e) {
    return { content: String(e), isError: true };
  }
}

const PERSONA = [
  'You answer questions about the Apetit climate and nature dataset (emissions inventory, sites,',
  'farms, parcels, suppliers, scenarios, catchments) held in an NGSI-LD context broker and exposed',
  'through MCP tools. Answer only from broker data; the store is read-only.',
  '',
  'The dataset is large (thousands of entities per type). Never try to load it all. Work in small steps:',
  '- Start from the type list. Pick the one or two types that can answer the question.',
  '- Count first, then sample: request a handful of entities (limit 5-10) to see the shape.',
  '- Always narrow with a filter (q, id pattern or geo/time bounds) and select only the attributes',
  '  you need. Never request every attribute of every entity.',
  '- For totals, averages or groupings over many rows, use count queries and filtered,',
  '  paged queries (limit with offset, 50 rows at most per call); aggregate across calls yourself',
  '  and state how many rows you covered. Do not page through a whole type.',
  '- If a result is truncated or you sampled, say so; do not present a sample as the full total.',
  '',
  'Entity IDs, attribute values and counts must come from a tool call; never guess them. Raw feeds',
  'contain planted errors, so flag suspicious values and cite the entity ID. LoadLog entities record',
  'what each upload read, loaded and dropped. If the data does not answer the question, say so and',
  'name the types you checked. Keep answers short and cite entity IDs for key figures.',
  '',
  'Keep calling tools until you can answer; do not end a turn by describing the next step. If a call',
  'fails or returns nothing, check the real type and attribute names with',
  'discover_context_meta_data, or adjust the filter, before concluding the data is absent.',
].join('\n');

export interface ResourceDef {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export async function listResourceDefs(client: Client): Promise<ResourceDef[]> {
  try {
    const { resources } = await client.listResources();
    return resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  } catch {
    return [];
  }
}

export async function readResourceText(client: Client, uri: string): Promise<string> {
  const res = await client.readResource({ uri });
  return ((res.contents ?? []) as Array<{ text?: unknown }>)
    .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join('\n');
}

async function readOntology(client: Client, uri: string): Promise<{ uri: string; text: string }> {
  return { uri, text: await readResourceText(client, uri) };
}

// Find the data model for an entity type among the MCP server's `ontology://` resources:
// try the exact URI first, then search each domain for `ontology://<domain>/<type>`.
export async function findOntology(
  client: Client,
  type: string,
): Promise<{ uri: string; text: string } | null> {
  const wanted = type.toLowerCase();
  try {
    const { resources } = await client.listResources();

    const exact = resources.find(
      (r) => r.uri.startsWith('ontology://') && r.uri.toLowerCase().endsWith(`/${wanted}`),
    );
    if (exact) return await readOntology(client, exact.uri);

    const domains = new Set<string>();
    for (const r of resources) {
      const m = /^ontology:\/\/([^/]+)/.exec(r.uri);
      if (m) domains.add(m[1]!);
    }
    for (const domain of domains) {
      const hit = await readOntology(client, `ontology://${domain}/${type}`).catch(() => null);
      if (hit) return hit;
    }
  } catch {
    /* no resources / not supported */
  }
  return null;
}

// The farm metadata is deliberately not inlined: it runs to tens of thousands of tokens that
// would be resent on every agent step. The model fetches it with a tool call instead.
const DISCOVERY_HINT =
  'Before answering, call discover_context_meta_data once to learn which types and attributes exist. ' +
  'Reuse that result for the rest of the conversation rather than calling it again.';

export function buildSystemPrompt(client: Client): string {
  // The MCP server ships tool-usage guidance in its `initialize` instructions; fold it
  // in so server-side changes reach the model without editing this prompt.
  const serverInstructions = client.getInstructions()?.trim();
  const base = serverInstructions ? `${PERSONA}\n\n${serverInstructions}` : PERSONA;
  return `${base}\n\n${DISCOVERY_HINT}`;
}

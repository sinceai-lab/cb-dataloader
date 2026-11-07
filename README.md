# Apetit x SinceAI 2026

Loads the Apetit CSV datasets in `raw-data/` into Coraine (an NGSI-LD context broker), validated against the JSON Schemas in `schemas/`, and lets you ask questions about the loaded data in a chat UI (`data-viewer/`).

## Prerequisites

- Docker (running) and Docker Compose
- Docker Compose v2.24 or newer (`docker compose version`)
- Node.js and npm
- An LLM API key: Gemini or Groq (see Chat with the data)
- Run the commands below from this folder unless a step says otherwise
### A note about windows 
If the readme says to run any scripts like
```
./services start coraine
./check-models
```
there should be an equivalent for windows. for example
```
.\services.cmd start coraine
.\check-models.cmd
```
## First-time setup

```
cd cb-data-loader && npm install
```

## Start
```
./services start coraine   # Coraine + Mongo + Timescale + the @context httpd (enough for loading)
./services start           # full stack: also Keycloak and APISIX
./services status          # see what is running
```

Coraine is then at http://localhost:1026, and the JSON-LD contexts (served by httpd from `data-models/`, config in `conf/`) at http://localhost:3004/user-context.jsonld. `./services upload` regenerates `data-models/user-context.jsonld` from the schemas. The full stack also gives the secured route at http://localhost:1030/coraine/ngsi-ld/v1/entities and Keycloak at http://localhost:3005 (admin / 1234).

## Quick start

```
cd data-loader && npm install    # once
./services start coraine                  # 1. broker
./services upload                         # 2. load the data
# set a key in data-viewer/.env (see Chat with the data), then:
cd data-viewer && ./services apetit       # 3. chat UI at http://localhost:3006
```

## Load data
```
./services upload                # load every CSV, in turn
./services upload Site Parcel    # load only the named schemas
LOADED_BY=jason ./services upload
```

- Each file is validated against its schema; rows with a wrong type or missing required field are logged and dropped. Value-level errors (outliers, duplicates) are kept on purpose.
- Every load writes a `LoadLog` entity (file, sha256, who, when, row counts). Loaded entities link back to it through `refLoadLog`.
- Source CSVs are copied to `data-loader/uploads/` before loading. `raw-data/` is never modified.
- Loading again is safe; entities are upserted by id.
- Check the result: `curl 'localhost:1026/ngsi-ld/v1/entities?type=Site' -H 'Link: <http://context/user-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'`

## Chat with the data

`data-viewer/` runs an MCP server and a chat UI over the Coraine started above. It is read-only and only sees what you uploaded.

1. Start Coraine (`./services start coraine`) and load data (`./services upload`).
2. Edit `data-viewer/.env`: set `CHAT_BOT_PROVIDER` to `gemini` or `groq` and fill in the matching `GEMINI_API_KEY` or `GROQ_API_KEY` (keys: https://aistudio.google.com/apikey, https://console.groq.com/keys). `GEMINI_MODEL` must be a model your key can still use (default `models/gemini-3.5-flash`).
3. Start the viewer from its folder:
   ```
   cd data-viewer
   ./check-models      # optional: confirms your keys work
   ./services apetit   # builds and starts the MCP server and chat UI
   ```
4. Open http://localhost:3006. The MCP server takes about a minute to discover the loaded types; if the first question fails, wait and retry. The MCP endpoint is http://localhost:3003/mcp (also used by Claude Code via `data-viewer/.mcp.json`).

The viewer joins the `apetit_default` Docker network, so Coraine must be running first. Stop it with `cd data-viewer && ./services apetit stop`. Reload the data first if you ran `./services reset`.

## Stop and clean up
```
./services clear-uploads   # delete the copied files in data-loader/uploads/ (LoadLog entries stay)
./services stop            # stop containers, keep the data, and clear data-loader/uploads/
./services reset           # stop containers AND delete all loaded data
(cd data-viewer && ./services apetit stop)   # stop the chat UI
```

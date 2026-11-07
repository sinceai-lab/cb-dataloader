# Apetit x SinceAI 2026

Loads the Apetit CSV datasets (the `source` paths in `schemas/index.json`, under `../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/data/`) into Coraine (an NGSI-LD context broker), validated against the JSON Schemas in `schemas/`, and lets you ask questions about the loaded data in a chat UI (`data-viewer/`).

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
cd cb-dataloader && npm install
```

## Start
```
./services start coraine   # Coraine + Mongo + Timescale + the @context httpd + weather-aggregator (enough for loading)
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
- The CSV folder defaults to `raw-data/data`; set `DATA_DIR=/path/to/data` (the folder containing `01_master`, `02_raw_feeds`, ...) to load from elsewhere.
- Source CSVs are copied to `data-loader/uploads/` before loading. The source datasets are never modified.
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

## Explore relationships with C3

[C3](https://github.com/SEAMWARE/c3) (the coraine Control Center) draws entities as boxes and Relationships as arrows. It is Linux-only, so it runs as the `c3` service (built from pinned sources in `c3/`; the first build takes a few minutes).

```
docker compose up -d --build c3
```

Open http://localhost:7900 and go to **Explore**; the broker `http://coraine:1026` is already in the list, press **Connect**.

- Tick the types to see (for example `Farm`, `Parcel`, `Catchment`) and press **Load**. Right-click an entity for its **linked entities** or its **neighbourhood**.
- Relationship arrows exist for `Parcel` -> `Farm` / `Catchment`, `ErpPurchaseLine` -> `Site` / `Material` / `Supplier` or `Farm`, `Material` / `Shipment` -> `EmissionFactor` and `GooRegistryStatement` -> `Site`.
- Entities with a location (Farm, ClimateGridCell) also show on **Map**; replayed weather updates show as live values.
- A reference that no target owns (6 `Material` rows with `default_ef_id = FARM`) is kept as a plain value, not an arrow.
- Coraine runs with `--defaultUserContext` (our `user-context.jsonld`) so C3, which sends no `@context`, sees short names, and with `--transports ws` for live values.

## Weather aggregator

`weather-aggregator/` is a small Node service in the compose file. On start it (re)creates a subscription on `WeatherObserved` entities and writes every notification it receives to a debug log.

```
docker compose up -d --build weather-aggregator   # also started by ./services start and ./services start coraine
docker logs -f apetit-weather-aggregator          # or weather-aggregator/logs/debug.log
```

### Drip in the weather

`replay` writes `--batch` `WeatherObserved` rows (default 1) into Coraine every `--interval` seconds (default 6). Each written entity triggers a notification to every subscriber.

1. Start Coraine and the aggregator: `./services start coraine`
2. Watch the log in a second terminal: `docker logs -f apetit-weather-aggregator`
3. Drip the sample (20 days for cell GF0104, about 2 minutes):
   ```
   cd data-loader
   npm run replay -- replay/weather_sample_20.csv
   ```
4. Or drip from the full daily parquet, filtered to what you need:
   ```
   npm run replay -- ../../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/data/04_climate/weather_daily_1991_2060.parquet \
       --cell GF0104 --scenario ssp245 --from 2027-06-01 --limit 100 --interval 6
   ```

| Option | Meaning |
|---|---|
| `--interval s` | seconds between upserts (default 6; `0` for a backfill) |
| `--batch n` | rows per upsert call, 1 to 500 (default 1, a drip) |
| `--cell id` | only this grid cell, e.g. `GF0104` (84 cells) |
| `--scenario s` | `historical` (to 2026), `ssp126`, `ssp245` or `ssp585` (from 2027) |
| `--from date` | first date to send, `YYYY-MM-DD` |
| `--to date` | last date to send, `YYYY-MM-DD` |
| `--limit n` | stop after n rows |
| `--dry-run` | print each batch as a JSON array instead of sending it |

- Stop early with Ctrl-C. Rows already sent stay in the broker.
- Each row becomes one `WeatherObserved` entity (`cellId`, `dateObserved`, `climateScenario`, `temperature`, `temperatureMax`, `temperatureMin` when the file has `tmin_c`, `precipitation`, `referenceEvapotranspiration`), id `urn:ngsi-ld:WeatherObserved:<cell>:<scenario>:<date>`, so scenarios don't overwrite each other. Sending the same cell, scenario and date again updates it and notifies again.
- Rejected entities in a batch (HTTP 207) are logged with their id and reason; the rest of the batch is kept.
- A cell late in the parquet takes a few seconds to find before the first row is sent.
- The replayed entities stay until you delete them or run `./services reset`. To remove one: `curl -X DELETE localhost:1026/ngsi-ld/v1/entities/urn:ngsi-ld:WeatherObserved:GF0104:ssp245:2027-06-01 -H 'Link: <http://context/user-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'`

## Pipeline: broker -> inference

`model-inference` (a separate repo, `../model-inference`) gets every `WeatherObserved` update from Coraine on `POST /notify` and serves yield estimates on `GET /predictions`.

```
./services start coraine                     # 1. broker (+ @context httpd)
./services upload                            # 2. load the data, regenerates data-models/user-context.jsonld
# 3. in ../model-inference: the inference service on port 8600
CB_URL=http://localhost:1026 .venv/bin/uvicorn service.api:app --host 0.0.0.0 --port 8600
./services subscribe-inference               # 4. (re)create urn:ngsi-ld:Subscription:apetit-yield
cd data-loader                               # 5. backfill one scenario's season from 1 March
npm run replay -- ../../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/data/04_climate/weather_daily_1991_2060.parquet \
    --scenario ssp245 --from 2027-03-01 --to 2027-10-31 --batch 500 --interval 0
```

- Coraine runs in Docker, so it calls the service at `http://host.docker.internal:8600/notify` (the default); set `NOTIFY_URL` to change it and `CORAINE_URL` for another broker. Docker Desktop should also forward to a service bound to `127.0.0.1` (not yet confirmed), so an already-running service doesn't need a restart. On Linux, bind `0.0.0.0` and Coraine also needs `extra_hosts: ["host.docker.internal:host-gateway"]`.
- `npm run subscribe:inference -- --dry-run` (in `data-loader/`) prints the body. The subscription watches `WeatherObserved` only, format `normalized`, with no throttling (dropped days get filled with typical weather).
- The inference service keys its readings by cell and date, not by scenario. Subscribe it while replaying one scenario per season; replaying ssp126 and ssp585 for the same dates would mix them.
- `CB_URL` is optional: set it to have estimates written back as `YieldPrediction` entities; their terms are in `user-context.jsonld`, so `CB_CONTEXT=http://context/user-context.jsonld` works.
- The parquet is ordered by cell, then scenario, then date, so the backfill sends each cell's season in turn (84 cells, about 20k rows). Add `--cell GF0104` to try one cell first.

## Stop and clean up
```
./services clear-uploads   # delete the copied files in data-loader/uploads/ (LoadLog entries stay)
./services stop            # stop containers, keep the data, and clear data-loader/uploads/
./services reset           # stop containers AND delete all loaded data
(cd data-viewer && ./services apetit stop)   # stop the chat UI
```

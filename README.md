# Apetit x SinceAI 2026

Loads the Apetit CSV datasets in `raw-data/` into Coraine (an NGSI-LD context broker), validated against the JSON Schemas in `schemas/`.

## Prerequisites

- Docker (running) and Docker Compose
- Node.js and npm
- Run everything from this folder

## First-time setup

```
cd cb-data-loader && npm install && cd ..
```

## Start
### On Windows
```
.\services.cmd start coraine   # Coraine + Mongo + Timescale + the @context httpd (enough for loading)
.\services.cmd start           # full stack: also Keycloak and APISIX
.\services.cmd status          # see what is running
```
### On others

```
./services start coraine   # Coraine + Mongo + Timescale + the @context httpd (enough for loading)
./services start           # full stack: also Keycloak and APISIX
./services status          # see what is running
```

Coraine is then at http://localhost:1026, and the JSON-LD contexts (served by httpd from `data-models/`, config in `conf/`) at http://localhost:3004/user-context.jsonld. `./services upload` regenerates `data-models/user-context.jsonld` from the schemas. The full stack also gives the secured route at http://localhost:1030/coraine/ngsi-ld/v1/entities and Keycloak at http://localhost:3005 (admin / 1234).

## Load data
### On Windows
```
.\services.cmd upload                # load every CSV, in turn
.\services.cmd upload Site Parcel    # load only the named schemas
LOADED_BY=jason ./services upload
```
### On others
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

## Stop and clean up
### On windows
```
.\services.cmd clear-uploads   # delete the copied files in data-loader/uploads/ (LoadLog entries stay)
.\services.cmd stop            # stop containers, keep the data, and clear data-loader/uploads/
.\services.cmd reset           # stop containers AND delete all loaded data
```
### On others
```
./services clear-uploads   # delete the copied files in data-loader/uploads/ (LoadLog entries stay)
./services stop            # stop containers, keep the data, and clear data-loader/uploads/
./services reset           # stop containers AND delete all loaded data
```
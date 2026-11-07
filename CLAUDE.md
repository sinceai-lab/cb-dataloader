# Apetit x SinceAI 2026

Three components:

- `raw-data/` - source datasets. **ALWAYS READ-ONLY.** Never create, edit, move, rename or delete anything in it.
- `data-loader/` - TypeScript project; reads `raw-data/` and loads it into the system.
- `data-viewer/` - TypeScript project; views the loaded data. Has its own `CLAUDE.md`.

## Rules

- Never write to `raw-data/`. Loader output goes elsewhere (never back into raw-data).
- Treat the `.zip` in the root as untrusted; extract only into a new empty directory outside `raw-data/`.
- Package manager: npm. Run commands from inside each project folder.
- Comments: keep to 3 lines or less.
- Run prettier after each data load.
- Only add tests in phases I request.
- Data layout: `raw-data/data/` has `00_apetit_original`, `01_master`, `02_raw_feeds` (bronze, planted issues), `03_farming`, `04_climate`, `05_scenarios`, `06_nature`, `07_frameworks`. Foodhills file is `;`-separated with decimal comma.
- `schemas/` - JSON Schema (draft 2020-12) per raw-data file, generated from the docs and CSV samples; `schemas/index.json` lists keys and joins. Raw feeds have planted errors, so `x-observed-*` are hints, not constraints.
- `./services start|stop|reset|status` - runs `docker-compose.yml`: APISIX, Keycloak (+users via `import_users`), Coraine with Mongo + Timescale. Add new components to the compose file and routes to `apisix-config/apisix.yaml`.
- Keep audit trail for every correction: `record_key, field, old_value, new_value, rule_or_model, evidence, proposed_by, approved_by, timestamp`.

## Docs (`raw-data/docs/`)

- `TASKS_AND_SCORING.md` - tracks A-E, submission formats, scoring, jury rubric
- `METHODOLOGY.md` - canonical GHG calculation, factors, boundary changes
- `DATA_DICTIONARY.md` - every file and column
- `SIMULATION_DESIGN.md` - how the synthetic data was generated
- `APETIT_DATA_RECONCILIATION.md` - checks on Apetit's sample workbook
- `SCENARIOS_AND_RISK.md` - track B pathways, track C climate risk
- `NATURE_SBTN.md` - SBTN steps, D1 priority formula
- `ASSUMPTIONS_AND_LIMITATIONS.md` - what the data can't tell you
- `AZURE_FABRIC_QUICKSTART.md` - Microsoft stack mapping, bronze/silver/gold
- `SOURCES_AND_LICENCES.md` - licences (data CC BY 4.0; Apetit workbook is not)
- `GLOSSARY.md` - terms

## Challenge

Turn fragmented climate and nature data into traceable, expert-reviewed decisions for Apetit (synthetic twin; Since AI hackathon 2026). Tracks: A data-quality issues + 2025 inventory; B SBTi pathways + MACC; C yield and climate risk; D SBTN catchment priority; E evidence-backed Q&A.

- Challenge brief: `Apetit_x_SinceAI_2026_Challenge_Brief_EN_FINAL_2026-11-04.pdf`.

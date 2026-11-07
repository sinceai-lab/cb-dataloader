"""Farm-gate footprint per farm, crop and year with organic soils (METHODOLOGY.md s5, split by source).
Run: ../model-inference/.venv/bin/python -I derived/build_farm_footprints.py, then ./services upload FarmFootprint.
Inputs: FI survey as reported; SE Foodhills plus pea norms for P, lime, sprays; organic share from the soil map."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
PKG = HERE.parent.parent / "APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
sys.path.insert(0, str(PKG / "tools"))
from ccn_tools import factors as F  # noqa: E402
from ccn_tools.farm_calculator import farm_footprint_per_ha  # noqa: E402

D = PKG / "data"
OUT = HERE / "farm_footprints.csv"
E = F.FARM_EF
N2O = E["n2o_n_to_n2o"] * E["n2o_gwp"]
GRID = 0.03  # kg CO2e/kWh, the calculator default
DIESEL = {"FI": E["diesel_ttw"] + E["diesel_wtt"], "SE": 2.45 + E["diesel_wtt"]}
CONTRACT = ["pea", "turnip_rape", "potato", "carrot", "spinach"]


def components(df: pd.DataFrame) -> pd.DataFrame:
    """kg CO2e/ha per source on mineral soil, plus the per-ha emission if the field is drained organic soil.
    df: crop, n_mineral_kg_ha, n_manure_kg_ha, p_kg_ha, diesel_l_ha, lime_t_ha, sprays, yield_t_ha,
    irr_share (0..1), lowcarbon (bool), country."""
    nmin, nman, p = df.n_mineral_kg_ha.fillna(0), df.n_manure_kg_ha.fillna(0), df.p_kg_ha.fillna(0)
    yld = df.yield_t_ha
    res_n = df.crop.map(F.RESIDUE_N_PER_T) * yld
    fert_n = np.where(df.lowcarbon, E["fert_n_prod_lowcarbon"], E["fert_n_prod"])
    out = pd.DataFrame(index=df.index)
    out["fp_fertiliser_kg_ha"] = nmin * fert_n + p * E["fert_p_prod"] + p * 2.2 * E["fert_k_prod"]
    out["fp_n2o_direct_kg_ha"] = (nmin * E["ef1_synthetic"] + (nman + res_n) * E["ef1_organic"]) * N2O
    out["fp_n2o_indirect_kg_ha"] = ((nmin * E["frac_gasf"] + nman * E["frac_gasm"]) * E["ef4_n2o_n"]
                                    + (nmin + nman + res_n) * E["frac_leach"] * E["ef5_n2o_n"]) * N2O
    out["fp_diesel_kg_ha"] = df.diesel_l_ha.fillna(0) * df.country.map(DIESEL)
    out["fp_lime_kg_ha"] = df.lime_t_ha.fillna(0) * E["lime"] * 1000
    out["fp_sprays_kg_ha"] = df.sprays.fillna(0) * E["spray_pass"]
    kwh_t = df.crop.map({c: v["kwh_t"] for c, v in F.MGMT_NORMS.items()})
    out["fp_electricity_kg_ha"] = (kwh_t * yld + df.irr_share * 180.0) * GRID
    org_co2 = np.where(df.crop == "grass_ley", E["org_soil_co2_grass_t_ha"], E["org_soil_co2_t_ha"]) * 1000
    out["organic_if_drained_kg_ha"] = org_co2 + E["org_soil_n2o_n_kg_ha"] * N2O
    return out


def organic_shares(parcels: pd.DataFrame, hist: pd.DataFrame):
    """(farm, crop, year) -> organic area share of that crop's declared parcels; farm -> share over all parcels."""
    p = parcels[["parcel_id", "farm_id", "area_ha", "soil_class_soilmap"]].assign(org=lambda x: x.soil_class_soilmap.eq("organic") * x.area_ha)
    farm = p.groupby("farm_id").agg(org=("org", "sum"), ha=("area_ha", "sum"))
    farm_share = (farm.org / farm.ha).rename("farm_share")
    h = hist[hist.status.eq("declared") & hist.crop.isin(CONTRACT)].merge(p[["parcel_id", "area_ha", "org"]], on="parcel_id")
    g = h.groupby(["farm_id", "crop", "year"]).agg(org=("org", "sum"), ha=("area_ha", "sum"))
    crop_share = (g.org / g.ha).rename("crop_share")
    return crop_share, farm_share, g.ha.rename("declared_ha")


def survey_rows() -> pd.DataFrame:
    sv = pd.read_csv(D / "03_farming/farm_survey_fi.csv")
    return pd.DataFrame({
        "farm_id": sv.farm_id, "crop": sv.crop, "year": sv.year, "fp_method": "survey", "country": "FI",
        "area_ha": sv.area_ha, "yield_t_ha": sv.yield_t_ha, "n_mineral_kg_ha": sv.n_mineral_kg_ha,
        "n_manure_kg_ha": sv.n_manure_kg_ha, "p_kg_ha": sv.p_kg_ha, "diesel_l_ha": sv.diesel_l_ha,
        "lime_t_ha": sv.lime_t_ha, "sprays": sv.sprays, "irr_share": sv.irrigated.astype(float),
        "lowcarbon": sv.fertiliser_product.fillna("").str.contains("low-carbon"),
        "reported_organic": sv.soil_type_reported.str.lower().str.startswith("organic"),
        "fertiliser_product": sv.fertiliser_product, "irrigated": sv.irrigated,
        "organic_soil": False,  # only for the parity check against the calculator
    })


def foodhills_rows() -> pd.DataFrame:
    fh = pd.read_csv(D / "03_farming/foodhills_odlingsdata_se.csv", sep=";", decimal=",")
    n = F.MGMT_NORMS["pea"]
    area = fh["areal_ha"]
    return pd.DataFrame({
        "farm_id": fh.odlar_id, "crop": "pea", "year": fh["skördeår"], "fp_method": "foodhills", "country": "SE",
        "area_ha": area, "yield_t_ha": fh["levererad_mängd_ton"] / area, "n_mineral_kg_ha": fh["kvävegiva_kg_ha"],
        "n_manure_kg_ha": 0.0, "p_kg_ha": n["p"], "diesel_l_ha": fh["diesel_l_ha"], "lime_t_ha": n["lime"],
        "sprays": n["sprays"], "irr_share": fh["bevattnad"].str.lower().eq("ja").astype(float),
        "lowcarbon": False, "reported_organic": False,
    })


def main():
    reg = pd.read_csv(D / "01_master/farm_registry.csv")
    parcels = pd.read_csv(D / "01_master/parcels.csv")
    hist = pd.read_csv(D / "03_farming/parcel_crop_history_and_plan.csv")
    cur = pd.read_csv(D / "03_farming/current_calculator_footprints.csv")
    crop_share, farm_share, _ = organic_shares(parcels, hist)

    sv = survey_rows()
    # Parity: the split must add up to the package calculator; organic soil adds exactly one term.
    c = components(sv)
    ours = c.drop(columns="organic_if_drained_kg_ha").sum(axis=1).values
    ref = farm_footprint_per_ha(sv, grid_kg_per_kwh=GRID)
    assert np.allclose(ours, ref, rtol=1e-9, atol=1e-6), f"split differs from calculator by up to {np.abs(ours - ref).max():.3g} kg/ha"
    ref_org = farm_footprint_per_ha(sv.assign(organic_soil=True), grid_kg_per_kwh=GRID)
    assert np.allclose(ref_org - ref, c.organic_if_drained_kg_ha.values), "organic-soil term differs from calculator"

    fh = foodhills_rows()
    rows = pd.concat([sv, fh], ignore_index=True)
    rows = rows[rows.yield_t_ha.gt(0) & rows.area_ha.gt(0)].reset_index(drop=True)

    key = pd.MultiIndex.from_frame(rows[["farm_id", "crop", "year"]])
    share = pd.Series(crop_share.reindex(key).values, index=rows.index)
    share = share.fillna(rows.farm_id.map(farm_share)).fillna(0.0)
    share[rows.reported_organic.astype(bool)] = 1.0
    rows["fp_organic_share"] = share.clip(0, 1)

    c = components(rows)
    parts = ["fp_fertiliser_kg_ha", "fp_n2o_direct_kg_ha", "fp_n2o_indirect_kg_ha", "fp_diesel_kg_ha",
             "fp_lime_kg_ha", "fp_sprays_kg_ha", "fp_electricity_kg_ha"]
    out = rows[["farm_id", "crop", "year", "fp_method"]].copy()
    out["fp_area_ha"] = rows.area_ha
    out["fp_yield_t_ha"] = rows.yield_t_ha
    out["fp_organic_share"] = rows.fp_organic_share
    for p in parts:
        out[p] = c[p]
    out["fp_organic_soil_kg_ha"] = rows.fp_organic_share * c.organic_if_drained_kg_ha
    mineral = c[parts].sum(axis=1)
    out["fp_total_kg_ha"] = mineral + out.fp_organic_soil_kg_ha
    out["fp_flag_kg_ha"] = out[["fp_n2o_direct_kg_ha", "fp_n2o_indirect_kg_ha", "fp_lime_kg_ha", "fp_organic_soil_kg_ha"]].sum(axis=1)
    kg = rows.yield_t_ha * 1000
    out["fp_kgco2e_per_kg"] = out.fp_total_kg_ha / kg
    out["fp_mineral_only_kgco2e_per_kg"] = mineral / kg
    out = out.merge(cur[["farm_id", "crop", "year", "carbon_footprint_kgco2e_per_kg"]].rename(
        columns={"carbon_footprint_kgco2e_per_kg": "fp_current_calc_kgco2e_per_kg"}), on=["farm_id", "crop", "year"], how="left")
    out["fp_farm_tco2e"] = out.fp_total_kg_ha * out.fp_area_ha / 1000

    dup = out.duplicated(["farm_id", "crop", "year"]).sum()
    assert dup == 0, f"{dup} duplicate farm/crop/year rows"
    num = out.select_dtypes("number").columns.difference(["year"])
    out[num] = out[num].round(4)
    out.sort_values(["farm_id", "crop", "year"]).to_csv(OUT, index=False)

    last = out.sort_values("year").groupby(["farm_id", "crop"]).tail(1)
    print(f"wrote {OUT.relative_to(HERE.parent)}: {len(out)} rows, {out.farm_id.nunique()} of {reg.farm_id.nunique()} farms (the rest grow no contract crop)")
    print(out.fp_method.value_counts().to_string())
    print("latest year per farm and crop, kg CO2e/kg (median):")
    print(last.groupby("crop")[["fp_current_calc_kgco2e_per_kg", "fp_mineral_only_kgco2e_per_kg", "fp_kgco2e_per_kg"]].median().round(3).to_string())
    print(f"farms with any organic soil in their latest rows: {(last.groupby('farm_id').fp_organic_share.max() > 0).sum()}")
    tot = last.fp_farm_tco2e.sum(); org = (last.fp_organic_soil_kg_ha * last.fp_area_ha / 1000).sum()
    print(f"latest-year total {tot:,.0f} t CO2e, of which organic soil {org:,.0f} t ({org / tot:.0%})")


if __name__ == "__main__":
    main()

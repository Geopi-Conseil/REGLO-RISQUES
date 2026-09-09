"""
Export des données QGIS vers les GeoJSON utilisés par la webmap.

À exécuter dans la console Python de QGIS (ou via un script PyQGIS externe
avec un environnement QGIS), depuis le projet source
`webmap_obligations_inondation.qgz` contenant les couches enrichies :
  - Bâti (clip commune)  -> champs zone_pprin, regime_pprin, diagnostic_vuln,
    zone_refuge, refuge_categorie, obligations_typologie, zones_intersectees,
    etage_present, etage_source, typologie_occupation, eligibilite_fprnm,
    emprise_sol_m2, emprise_fiable, annexe_max_m2, extension_hebergement_m2,
    extension_activite_m2, extension_activite_note, typologie_source
    (typologie_source distingue les bâtiments dont la typologie/étages ont
    été complétés via la BDNB, cf. docs/METHODOLOGIE.md §10, des autres,
    dérivés directement de BD TOPO®)
  - PPRi - Zonage réglementaire -> champs NOM, CODEZONE, TYPEREG
  - ERP (Acceslibre) -> champs nom, activite, classe_vulnerabilite, adresse,
    zone_pprin

Produit 4 fichiers dans data/ :
  - batiments_ppri.geojson        (bâtiments touchés par le zonage, détaillés)
  - batiments_hors_zone.geojson   (autres bâtiments, géométrie + id seulement)
  - zonage_pprin.geojson
  - erp.geojson

Toute évolution du schéma de champs doit être répercutée dans :
  - src/js/app.js (fonction renderBuildingPanel)
  - docs/METHODOLOGIE.md (dictionnaire des champs)
"""

import json
import os
import re

from qgis.core import (
    NULL,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsGeometry,
    QgsProject,
)

# ---------------------------------------------------------------------------
# Configuration : adapter les noms de couches si besoin
# ---------------------------------------------------------------------------

LAYER_BATI = "Bâti - Septèmes-les-Vallons (clip commune)"
LAYER_ZONAGE = "PPRi - Zonage réglementaire (Septèmes-les-Vallons)"
LAYER_ERP = "ERP - Septèmes-les-Vallons (Acceslibre)"

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

ZONE_COLORS = {
    "BLEU_CU": "#1565C0",
    "BLEU_AZU": "#64B5F6",
    "ORANGE_AZU": "#F57C00",
    "ROUGE": "#C62828",
    "ROUGE_CU": "#C62828",
    "VIOLET": "#8E24AA",
}

ZONE_LABELS = {
    "BLEU_CU": "Titre 1 - Zone Bleu foncé (centre urbanisé, aléa modéré)",
    "BLEU_AZU": "Titre 2 - Zone Bleu clair (zone urbanisée, aléa modéré)",
    "ORANGE_AZU": "Titre 4 - Zone Orange (aléa fort à très fort, zone urbanisée)",
    "ROUGE": "Titre 5 - Zone Rouge (aléa fort à très fort, ou zone peu/pas urbanisée)",
    "ROUGE_CU": "Titre 5 - Zone Rouge (aléa fort à très fort, ou zone peu/pas urbanisée)",
    "VIOLET": "Titre 6 - Zone Violette (aléa résiduel)",
}

# ---------------------------------------------------------------------------

proj = QgsProject.instance()
_tr = QgsCoordinateTransform(
    QgsCoordinateReferenceSystem("EPSG:2154"),
    QgsCoordinateReferenceSystem("EPSG:4326"),
    proj,
)


def clean(v):
    return None if (v is None or v == NULL) else v


def geom_to_geojson(geom, ndigits=6, simplify_tol=None):
    g = QgsGeometry(geom)
    if simplify_tol:
        g = g.simplify(simplify_tol)
    g.transform(_tr)
    gj = json.loads(g.asJson())

    def round_coords(c):
        if isinstance(c[0], list):
            return [round_coords(x) for x in c]
        return [round(c[0], ndigits), round(c[1], ndigits)]

    gj["coordinates"] = round_coords(gj["coordinates"])
    return gj


def split_zone(val):
    if not val or val.startswith("Hors zonage"):
        return None, "Hors zonage réglementaire PPRi"
    m = re.match(r"^([A-Z_]+)\s*\((.*)\)$", val)
    return (m.group(1), m.group(2)) if m else (val, val)


def find_layer(name):
    matches = [l for l in proj.mapLayers().values() if l.name() == name]
    if not matches:
        raise RuntimeError(f"Couche introuvable : {name}")
    return matches[0]


def write_geojson(path, features):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            fh,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    print(f"  -> {path} ({len(features)} entités, {os.path.getsize(path)/1e6:.2f} Mo)")


def export_bati():
    lyr = find_layer(LAYER_BATI)
    feats_zone, feats_hors = [], []
    for f in lyr.getFeatures():
        zone_code, zone_label = split_zone(clean(f["zone_pprin"]))
        if zone_code is None:
            geom = geom_to_geojson(f.geometry(), ndigits=5, simplify_tol=0.5)
            feats_hors.append(
                {"type": "Feature", "geometry": geom, "properties": {"id": clean(f["cleabs"])}}
            )
            continue
        emprise = clean(f["emprise_sol_m2"])
        geom = geom_to_geojson(f.geometry(), ndigits=6, simplify_tol=0.15)
        props = {
            "id": clean(f["cleabs"]),
            "zoneCode": zone_code,
            "zoneLabel": zone_label,
            "zoneColor": ZONE_COLORS.get(zone_code, "#9E9E9E"),
            "concerne": True,
            "regime": clean(f["regime_pprin"]),
            "diagnostic": clean(f["diagnostic_vuln"]),
            "zoneRefuge": clean(f["zone_refuge"]),
            "refugeCategorie": clean(f["refuge_categorie"]),
            "obligationsTypologie": clean(f["obligations_typologie"]),
            "zonesIntersectees": clean(f["zones_intersectees"]),
            "etagePresent": clean(f["etage_present"]),
            "etageSource": clean(f["etage_source"]),
            "typologie": clean(f["typologie_occupation"]),
            "eligibiliteFprnm": clean(f["eligibilite_fprnm"]),
            "empriseSolM2": round(emprise, 1) if emprise is not None else None,
            "empriseFiable": clean(f["emprise_fiable"]),
            "annexeMaxM2": clean(f["annexe_max_m2"]),
            "extensionHebergementM2": clean(f["extension_hebergement_m2"]),
            "extensionActiviteM2": clean(f["extension_activite_m2"]),
            "extensionActiviteNote": clean(f["extension_activite_note"]),
            "nbLogements": clean(f["nombre_de_logements"]),
            "hauteurM": clean(f["hauteur"]),
            "typologieSource": clean(f["typologie_source"]),
        }
        props = {k: v for k, v in props.items() if v is not None}
        feats_zone.append({"type": "Feature", "geometry": geom, "properties": props})

    write_geojson(os.path.join(OUTPUT_DIR, "batiments_ppri.geojson"), feats_zone)
    write_geojson(os.path.join(OUTPUT_DIR, "batiments_hors_zone.geojson"), feats_hors)


def export_zonage():
    lyr = find_layer(LAYER_ZONAGE)
    feats = []
    for f in lyr.getFeatures():
        code = clean(f["NOM"])
        props = {
            "zoneCode": code,
            "zoneLabel": ZONE_LABELS.get(code, code),
            "zoneColor": ZONE_COLORS.get(code, "#9E9E9E"),
            "codeZone": clean(f["CODEZONE"]),
            "typeReg": clean(f["TYPEREG"]),
        }
        geom = geom_to_geojson(f.geometry(), ndigits=6, simplify_tol=0.2)
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
    write_geojson(os.path.join(OUTPUT_DIR, "zonage_pprin.geojson"), feats)


def export_erp():
    lyr = find_layer(LAYER_ERP)
    feats = []
    for f in lyr.getFeatures():
        zone_raw = clean(f["zone_pprin"])
        zone_code = None
        if zone_raw and not zone_raw.startswith("Hors zonage"):
            m = re.match(r"^([A-Z_]+)", zone_raw)
            zone_code = m.group(1) if m else None
        props = {
            "nom": clean(f["nom"]),
            "activite": clean(f["activite"]),
            "classeVulnerabilite": clean(f["classe_vulnerabilite"]),
            "adresse": clean(f["adresse"]),
            "zoneCode": zone_code,
            "zoneColor": ZONE_COLORS.get(zone_code, "#9E9E9E"),
            "concerne": zone_code is not None,
        }
        props = {k: v for k, v in props.items() if v is not None}
        geom = geom_to_geojson(f.geometry(), ndigits=6)
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
    write_geojson(os.path.join(OUTPUT_DIR, "erp.geojson"), feats)


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("Export des couches vers data/ ...")
    export_bati()
    export_zonage()
    export_erp()
    print("Terminé.")

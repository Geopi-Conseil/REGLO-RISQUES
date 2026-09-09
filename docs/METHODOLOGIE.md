# Méthodologie

Ce document décrit comment les données affichées par la webmap sont
construites, pour permettre à un technicien ou un contributeur de les
vérifier, les corriger ou les reproduire sur une autre commune.

## 1. Chaîne de traitement

```
PPRi approuvé (règlement PDF + zonage réglementaire, DDTM 13)
        │
        ▼
Zonage réglementaire (WFS / DDTM) ──┐
                                     │  jointure spatiale (bâtiment le plus
BD TOPO® IGN (bâtiments) ───────────┤  contraint parmi les zones qu'il
                                     │  intersecte, cf. §2)
Acceslibre (ERP) ───────────────────┘
        │
        ▼
GeoPackage QGIS (donnees_septemes.gpkg) — couches enrichies
        │
        ▼
scripts/export_geojson.py  (reprojection EPSG:4326, nettoyage des champs)
        │
        ▼
data/*.geojson  →  consommés par src/js/app.js
```

## 2. Règle du bâtiment le plus contraignant

Un bâtiment intersecte parfois plusieurs zones réglementaires (chevauchement
de polygones à ses limites). Conformément au principe indiqué dans le
règlement du PPRi, **la zone retenue pour un bâtiment est la plus
contraignante parmi toutes celles qu'il intersecte**, selon l'ordre de
contrainte croissante :

```
Hors zonage < Violet < Bleu clair (AZU) < Bleu foncé (CU) < Orange (AZU) < Rouge / Rouge CU
```

Le champ `zones_intersectees` du GeoPackage conserve la liste complète des
zones touchées, à titre de traçabilité.

## 3. Détermination de la présence d'un étage

Faute de donnée directe et exhaustive sur le nombre de niveaux habitables,
l'outil combine deux sources, par ordre de priorité :

1. **BD TOPO® — `nombre_d_etages`** : quand disponible, une valeur ≥ 2
   indique un étage (le rez-de-chaussée est compté comme le premier niveau).
2. **Estimation par la hauteur du bâti** (`hauteur`, BD TOPO) : à défaut de
   `nombre_d_etages`, un seuil de **5,30 m** est utilisé (calibré
   empiriquement sur le bâti de la commune) — au-delà, présence d'un étage
   jugée probable, la fiabilité de cette estimation étant qualifiée de
   « modérée » dans le champ `etage_source`.

Si aucune des deux sources n'est disponible, le champ `etage_present` vaut
`"Inconnu"`.

## 4. Zone refuge

Obligation retenue : **hébergement collectif de plus de deux logements**
(`nombre_de_logements > 2`), quelle que soit la zone touchée (le règlement ne
conditionne pas cette obligation au niveau d'aléa). Le sous-texte du champ
`zone_refuge` distingue :

- un étage existant est disponible → aménagement possible sur un niveau
  existant ;
- aucun étage existant → travaux structurels nécessaires (signalé
  explicitement, car plus contraignant).

## 5. Emprise au sol et seuils de travaux

L'emprise au sol (`emprise_sol_m2`) est calculée directement depuis la
géométrie du bâtiment (aire du polygone BD TOPO), et **non** estimée. Les
bâtiments dont l'emprise est inférieure à 10 m² sont exclus du calcul des
seuils (`emprise_fiable = "Non (emprise <10m²...)"`) : à cette échelle, la
géométrie BD TOPO (petites annexes, abris) est jugée trop imprécise pour un
seuil réglementaire fiable.

Seuils appliqués (extraits verbatim du règlement, chapitre « Règles
applicables aux constructions existantes ») :

| Type de travaux | Seuil | Zones |
|---|---|---|
| Création d'annexe | 10 m² | Toutes zones sauf Violet |
| Création d'annexe | 20 m² | Zone Violet |
| Extension hébergement (résidentiel) | 20 m² supplémentaires | Toutes zones (seuil uniforme) |
| Extension activité / stockage | 20 % de l'emprise existante | Toutes zones sauf Bleu foncé (CU) |
| Extension activité / stockage | Pas de plafond en %, sous conditions de cote PHE + 20 cm | Bleu foncé (CU) uniquement |

## 6. Éligibilité au Fonds Barnier (FPRNM)

Estimation indicative basée sur la typologie d'occupation déduite de
`usage_1` / `usage_2` / `nombre_de_logements` (BD TOPO) :

- **Habitation** → éligible à 80 %, plafond 36 000 €/bien ;
- **Activité économique de moins de 20 salariés** → éligible à 20 % (taux à
  vérifier au cas par cas, l'effectif n'étant pas connu depuis les données
  géographiques) ;
- **Typologie indéterminée** → non déterminé, à qualifier sur site.

Dans tous les cas, l'éligibilité réelle suppose un bien existant avant la
date d'approbation du PPRi (22/12/2022) et reste soumise à instruction par
la DDTM.

## 7. Cotes PHE (plus hautes eaux)

**Non intégrées à ce jour** pour Septèmes-les-Vallons : la seule source
disponible est un plan scanné (PDF) sans version vectorielle exploitable
publiée. Deux tentatives de calage automatique (corrélation de forme sur
l'emprise inondée, points de repère sur les limites de la commune) n'ont pas
atteint une précision suffisante pour publier des cotes fiables au niveau du
bâtiment. Un calage manuel planche par planche, via l'outil Géoréférenceur de
QGIS, a été entamé (voir `qgis-project/`) et peut être repris et poursuivi ;
une fois complet, `scripts/export_geojson.py` pourra être étendu pour
publier un champ `cotePheM` par bâtiment (mesuré ou interpolé, avec un niveau
de confiance).

## 8. Limites connues

- 3 515 bâtiments (BD TOPO `usage_1 = Indifférencié`) restent en
  « typologie indéterminée » : la donnée source ne permet pas de distinguer
  habitation / activité pour ces bâtiments sans croisement cadastral ou
  visite terrain.
- Le calcul d'éligibilité FPRNM est indicatif ; il ne remplace pas
  l'instruction d'un dossier réel.
- Les seuils de travaux ne couvrent que les obligations relatives aux
  **biens existants** ; les règles applicables aux **projets neufs** (permis
  de construire) ne sont pas modélisées dans cet outil.

## 9. Reproduire pour une autre commune

1. Récupérer le zonage réglementaire du PPRi (WFS DDTM ou export shapefile)
   et le règlement (PDF).
2. Récupérer le bâti (BD TOPO® IGN) sur l'emprise de la commune.
3. Réaliser la jointure spatiale « zone la plus contraignante » (voir §2).
4. Adapter les seuils du §5 et les règles du §4/§6 au règlement propre à la
   commune concernée (ils varient d'un PPRi à l'autre).
5. Adapter `scripts/export_geojson.py` (noms de couches, éventuels nouveaux
   champs) et régénérer `data/*.geojson`.
6. Mettre à jour `CONFIG.center` / `CONFIG.codeInsee` dans `src/js/app.js`.

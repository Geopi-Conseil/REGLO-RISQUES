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
GeoPackage QGIS (donnees_septemes.gpkg) : couches enrichies
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

1. **BD TOPO® - `nombre_d_etages`** (ou `nb_niveau` BDNB pour les bâtiments
   enrichis, §10) : quand disponible, une valeur ≥ 2 indique un étage (le
   rez-de-chaussée est compté comme le premier niveau).
2. **Estimation par la hauteur du bâti** (`hauteur`, BD TOPO) : à défaut de
   niveau déclaré, un seuil de **5,30 m** est utilisé (calibré
   empiriquement sur le bâti de la commune). Au-delà, présence d'un étage
   jugée probable, la fiabilité de cette estimation étant qualifiée de
   « modérée » dans le champ `etage_source`.
3. **Contrôle de cohérence.** Si la source déclarative (1) indique 0 ou 1
   niveau mais que la hauteur mesurée dépasse le seuil de 5,30 m du point
   (2), la déclaration est jugée incompatible avec la géométrie réelle du
   bâtiment : un étage est retenu par prudence plutôt que de conclure à
   son absence (le champ `etage_source` explicite alors l'incohérence,
   ex. `"étage retenu par prudence (1 niveau déclaré, incohérent avec la
   hauteur mesurée 8.7 m > seuil 5.30 m)"`). Ce contrôle, ajouté après
   qu'une vérification terrain a révélé de nombreux faux « sans étage »,
   a corrigé 755 bâtiments sur la commune (dont 107 en zone réglementée,
   dont 3 faisant basculer une obligation de zone refuge du cas
   « travaux structurels nécessaires » vers « aménagement possible sur un
   niveau existant ») : les champs `nombre_d_etages` (BD TOPO) et
   `nb_niveau` (BDNB Fichiers Fonciers) se sont révélés peu fiables pour
   une part significative des bâtiments à plusieurs niveaux de la commune.
4. **Contrôle inverse (sur-déclaration).** Pour les bâtiments enrichis par
   la BDNB (§10) déclarant un nombre de logements élevé (≥ 10) mais une
   hauteur mesurée incompatible avec le nombre de niveaux déclaré (moins
   de 2,5 m par niveau en moyenne), l'enrichissement BDNB est annulé plutôt
   que de conserver une présence d'étage douteuse : la jointure spatiale
   `batiment_groupe` (§10) a très probablement rattaché au bâtiment un
   ensemble immobilier voisin plus grand que lui. La signature retenue
   pour déclencher cette annulation (et non un simple écart hauteur/
   niveaux, trop fréquent pour être fiable à lui seul) a été confirmée en
   observant plusieurs bâtiments BD TOPO distincts partageant exactement
   le même nombre de logements/niveaux déclaré (ex. 18 bâtiments partageant
   « 18 niveaux, 447 logements », manifestement le total d'un seul grand
   ensemble). Le bâtiment repasse alors en « typologie indéterminée »
   (comme s'il n'avait jamais été enrichi, §10), et sa présence d'étage est
   réévaluée uniquement par la hauteur (point 2). Correction appliquée à
   296 bâtiments sur la commune (dont 17 en zone réglementée, faisant
   basculer l'obligation de zone refuge de « OBLIGATOIRE... aménagement
   possible sur un niveau existant » vers « non requise, à qualifier sur
   site ») : c'est le sens le plus risqué à corriger, une fausse indication
   d'étage disponible pouvant laisser croire à tort qu'un refuge existe en
   cas de crue. En dessous du seuil de 10 logements déclarés, l'écart
   hauteur/niveaux reste possible sans signature fiable de rattachement
   erroné (bâtiment collectif réellement bas, mesure LiDAR imprécise...) et
   n'est pas corrigé automatiquement (voir §8).

Si aucune des sources n'est disponible, le champ `etage_present` vaut
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

Depuis l'enrichissement BDNB (§10), la typologie provient soit de BD TOPO,
soit de la BDNB (Fichiers Fonciers) : le champ `typologieSource` de chaque
bâtiment (visible dans le panneau « Détails techniques ») indique laquelle,
sans changer les règles d'éligibilité ci-dessus.

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

- Malgré l'enrichissement BDNB (§10) et son contrôle a posteriori (§3
  point 4, §10 point 6), 1 664 bâtiments restent en
  « typologie indéterminée » (aucune correspondance BDNB trouvée, ou
  bâtiment également absent des Fichiers Fonciers, cas fréquent pour de
  petites annexes ou des constructions très récentes) : la donnée source ne
  permet pas de distinguer habitation / activité pour ces bâtiments sans
  visite terrain.
- Le calcul d'éligibilité FPRNM est indicatif ; il ne remplace pas
  l'instruction d'un dossier réel.
- Les seuils de travaux ne couvrent que les obligations relatives aux
  **biens existants** ; les règles applicables aux **projets neufs** (permis
  de construire) ne sont pas modélisées dans cet outil.
- La jointure BDNB (§10) est spatiale (bâtiment ↔ `batiment_groupe` BDNB) et
  non par identifiant commun ; en cas de bâtiments très rapprochés ou d'un
  `batiment_groupe` regroupant plusieurs bâtiments BD TOPO contigus, la
  typologie/le nombre de logements attribués sont ceux du groupe BDNB dans
  son ensemble, pas nécessairement ceux du bâtiment individuel exact. Le
  contrôle du §3 (point 4) détecte et annule les cas les plus flagrants de
  cette confusion (logements déclarés ≥ 10 et hauteur incompatible), mais
  ne garantit pas d'avoir isolé tous les cas, notamment en dessous de ce
  seuil.
- Le contrôle de cohérence hauteur/niveaux (§3, point 3) corrige la
  sous-déclaration de niveaux ; le contrôle inverse (§3, point 4) corrige
  la sur-déclaration, mais seulement pour les bâtiments enrichis par la
  BDNB avec un nombre de logements déclaré ≥ 10 et une hauteur incompatible
  (signature d'un rattachement erroné à un `batiment_groupe` voisin plus
  grand). En dessous de ce seuil, ou pour les bâtiments sourcés directement
  par le champ BD TOPO `nombre_d_etages`, un écart hauteur/niveaux reste
  possible sans être corrigé automatiquement : la donnée seule ne permet
  pas de distinguer un vrai bâtiment collectif bas d'une erreur de
  déclaration ou de mesure. Plus largement, `nombre_d_etages` et
  `nb_niveau` restent des champs déclaratifs/administratifs, pas une
  mesure directe : une vérification terrain reste recommandée pour toute
  décision engageant des travaux structurels (§4).

## 9. Correction déclarative du visiteur

Pour les bâtiments concernés par le zonage réglementaire, la fiche propose
un bloc dépliable « Précisez votre bâtiment » : le visiteur qui connaît le
bâtiment mieux que les données publiques (§8) peut y indiquer la présence
d'un étage, et le type d'occupation (maison individuelle, logement
collectif avec son nombre de logements, local d'activité économique, ou
annexe non habitée).

**Fonctionnement :**

- Le calcul est entièrement effectué **côté client** (JavaScript,
  `src/js/app.js`), avec les **mêmes règles et les mêmes textes** que ceux
  déjà appliqués côté données pour un bâtiment nativement classé dans la
  même catégorie (zone refuge : §4 ; diagnostic, obligations, éligibilité
  FPRNM : §6 et les libellés déjà utilisés en §10) : une correction
  affiche donc exactement le même résultat qu'un bâtiment automatiquement
  classé de la même façon.
- La correction est **enregistrée uniquement dans le navigateur du
  visiteur** (`localStorage`, clé `reglo-risques:corrections-batiments:v1`,
  indexée par l'identifiant BD TOPO du bâtiment) : elle n'est **jamais
  envoyée à un serveur, ni partagée avec les autres visiteurs**, et ne
  modifie jamais les fichiers `data/*.geojson` sources. Elle est retrouvée
  automatiquement si le même visiteur revient sur la même fiche depuis le
  même appareil, et peut être réinitialisée à tout moment.
- Elle ne porte que sur l'étage et la typologie/logements : les champs
  déterminés par la géométrie ou la zone (emprise au sol, seuils de
  travaux, régime, zones intersectées) ne sont pas modifiables par le
  visiteur.
- Comme le reste de l'outil, cette correction n'a **aucune valeur
  réglementaire opposable** (rappelé dans le panneau) : elle aide à mieux
  comprendre le cadre applicable, elle ne remplace pas une vérification
  officielle (service urbanisme, DDTM).

## 10. Enrichissement par la BDNB (typologie, étages, logements)

BD TOPO® ne renseigne l'usage (`usage_1`) que pour une partie des
bâtiments ; les autres restent `Indifférencié`, sans typologie ni nombre de
logements exploitables (cf. §8, historique : 3 515 bâtiments sur 6 305 pour
Septèmes-les-Vallons). Pour combler ce trou **sans changer de source
principale**, ces bâtiments sont croisés avec la [Base de Données Nationale
des Bâtiments (BDNB)](https://bdnb.io/), dont la table `batiment_groupe_ffo_bat`
(source : Fichiers Fonciers, DGFiP/Cerema) fournit `usage_niveau_1_txt`,
`nb_niveau` et `nb_log` pour un grand nombre de bâtiments absents de la
classification BD TOPO.

**Méthode :**

1. Requêter l'[API BDNB Open](https://www.data.gouv.fr/dataservices/api-bdnb-open)
   (gratuite, sans clé, `https://api.bdnb.io/v1/bdnb/donnees/…`, syntaxe
   PostgREST) filtrée sur `code_commune_insee=eq.<code INSEE>` : **uniquement
   la commune concernée**, jamais un téléchargement département/national.
   Le quota gratuit (10 000 requêtes/mois) et la pagination imposée par
   l'offre Open (10 lignes par requête) suffisent largement à l'échelle
   d'une commune : environ 700 requêtes pour Septèmes-les-Vallons
   (géométries + Fichiers Fonciers), réparties dans le temps pour respecter
   le débit imposé par l'API (erreurs 429 en cas de rafale).
2. Pour chaque bâtiment `typologie_occupation = "Typologie indéterminée…"`,
   jointure spatiale (centroïde, puis repli sur la plus grande intersection)
   avec les polygones `batiment_groupe` de la BDNB.
3. Traduction de `usage_niveau_1_txt` en trois grandes catégories, alignées
   sur celles déjà utilisées côté BD TOPO (§ ci-dessus) :

   | `usage_niveau_1_txt` (BDNB) | Catégorie retenue |
   |---|---|
   | Résidentiel individuel, Résidentiel collectif, Secondaire | Habitation |
   | Tertiaire & Autres | Activité économique |
   | Dépendance | Annexe (non habitée) |

   Le nombre de logements (`nb_log`) détermine ensuite « Maison
   individuelle » (0 ou 1) vs « Logement collectif (N logements) », comme
   pour BD TOPO (§4). Le nombre de niveaux (`nb_niveau`) prend le pas sur
   l'estimation par hauteur du §3 lorsqu'il est connu (`etage_source`
   l'indique explicitement : `connu (BDNB Fichiers Fonciers nb_niveau=N)`).
4. Les champs réglementaires dérivés (`diagnostic_vuln`, `zone_refuge`,
   `refuge_categorie`, `obligations_typologie`, `eligibilite_fprnm`) sont
   alors recalculés pour ces bâtiments avec les **mêmes règles** que celles
   appliquées aux bâtiments déjà classés par BD TOPO (§3 à §6) ; aucune
   règle nouvelle n'est introduite, seule la donnée d'entrée est complétée.
   Les bâtiments hors zonage réglementaire ne sont pas concernés par cette
   étape (leur fiche ne détaille pas la typologie).
5. Traçabilité : le champ `typologie_source` distingue "BD TOPO" (implicite,
   valeur par défaut) de `"BDNB (Fichiers Fonciers, millésime 2026-02.a)"`,
   affiché dans le panneau « Détails techniques » de chaque bâtiment
   concerné.
6. **Contrôle a posteriori.** Après qu'une vérification terrain a révélé
   des incohérences hauteur/logements sur des bâtiments enrichis par la
   BDNB, un contrôle automatique (§3, point 4) annule cet enrichissement
   pour les bâtiments présentant la signature d'un rattachement erroné au
   `batiment_groupe` (296 bâtiments sur la commune, dont 17 en zone
   réglementée) ; ces bâtiments repassent en « typologie indéterminée ».

**Résultat pour Septèmes-les-Vallons (millésime BDNB 2026-02.a) :** sur les
3 515 bâtiments initialement indéterminés, 2 147 obtiennent une
correspondance BDNB exploitable dont 269 en zone réglementée PPRi (avec
obligations complètes recalculées, 68 déclenchant l'obligation de zone
refuge jusqu'alors invisible) ; 1 368 restent indéterminés. Après le
contrôle a posteriori du point 6 ci-dessus, 296 bâtiments enrichis sont
réévalués comme indéterminés (17 en zone réglementée, dont l'obligation de
zone refuge était erronément déclenchée) : au total 1 851 bâtiments
conservent une correspondance BDNB exploitable, 51 déclenchent
l'obligation de zone refuge, et 1 664 restent indéterminés (voir §8).

**Licence et attribution :** données BDNB sous Licence Ouverte / Open
Licence version 2.0 (Etalab), comme BD TOPO®. Voir `mentions-legales.html`.

## 11. Reproduire pour une autre commune

1. Récupérer le zonage réglementaire du PPRi (WFS DDTM ou export shapefile)
   et le règlement (PDF).
2. Récupérer le bâti (BD TOPO® IGN) sur l'emprise de la commune.
3. Réaliser la jointure spatiale « zone la plus contraignante » (voir §2).
4. Adapter les seuils du §5 et les règles du §4/§6 au règlement propre à la
   commune concernée (ils varient d'un PPRi à l'autre).
5. Optionnel : reproduire l'enrichissement BDNB du §10 en remplaçant le code
   INSEE (`code_commune_insee=eq.<code INSEE>`) par celui de la nouvelle
   commune.
6. Adapter `scripts/export_geojson.py` (noms de couches, éventuels nouveaux
   champs) et régénérer `data/*.geojson`.
7. Mettre à jour `CONFIG.center` / `CONFIG.codeInsee` dans `src/js/app.js`.

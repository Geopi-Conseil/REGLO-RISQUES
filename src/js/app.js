/* =========================================================================
   Mes obligations face au risque inondation - Septèmes-les-Vallons
   Application carte (Leaflet). Aucune dépendance de build : fichier chargé
   tel quel par index.html.

   Vue d'ensemble du fichier :
   1. Configuration & constantes
   2. Initialisation de la carte et des couches
   3. Chargement des données (GeoJSON)
   4. Sélection d'un bâtiment / rendu du panneau d'information
   5. Recherche d'adresse (API Adresse - BAN) et géolocalisation
   6. Légende et bascule des couches
   ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------------------------------------------------
   * 1. Configuration
   * -------------------------------------------------------------------- */

  const CONFIG = {
    // Centre approximatif de la commune et niveau de zoom initial
    center: [43.3766, 5.3805],
    zoom: 15,
    minZoom: 12,
    maxZoom: 19,
    // Code INSEE de la commune, utilisé pour restreindre la recherche d'adresse
    codeInsee: "13106",
    dataUrls: {
      zonage: "data/zonage_pprin.geojson",
      batimentsZone: "data/batiments_ppri.geojson",
      batimentsHorsZone: "data/batiments_hors_zone.geojson",
      erp: "data/erp.geojson",
    },
    // Doit rester cohérent avec les couleurs utilisées lors de l'export
    // (voir docs/METHODOLOGIE.md et scripts/export_geojson.py)
    zoneOrder: ["BLEU_CU", "BLEU_AZU", "ORANGE_AZU", "ROUGE", "ROUGE_CU", "VIOLET"],
    zoneShortNames: {
      BLEU_CU: "Bleu foncé",
      BLEU_AZU: "Bleu clair",
      ORANGE_AZU: "Orange",
      ROUGE: "Rouge",
      ROUGE_CU: "Rouge",
      VIOLET: "Violet",
    },
  };

  /* ----------------------------------------------------------------------
   * 2. Carte
   * -------------------------------------------------------------------- */

  const map = L.map("map", {
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    zoomControl: false,
  });

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const layers = {
    zonage: L.layerGroup(),
    horsZone: L.layerGroup(),
    batiments: L.layerGroup(),
    erp: L.layerGroup(),
  };
  layers.zonage.addTo(map);
  layers.batiments.addTo(map);
  layers.erp.addTo(map);
  // Les bâtiments hors zone sont masqués par défaut : ce sont 5400+ polygones
  // qui n'apportent pas d'information tant qu'on n'a pas cliqué dessus ; les
  // afficher par défaut alourdirait la carte pour un intérêt limité.
  // L'utilisateur peut les activer depuis la légende.

  let selectedLayer = null;
  const defaultStyleCache = new WeakMap();

  /* ----------------------------------------------------------------------
   * 3. Chargement des données
   * -------------------------------------------------------------------- */

  async function loadJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Échec du chargement de ${url} (${res.status})`);
    return res.json();
  }

  function styleZonage(feature) {
    return {
      color: feature.properties.zoneColor,
      weight: 1,
      fillColor: feature.properties.zoneColor,
      fillOpacity: 0.28,
    };
  }

  function styleBatiment(feature) {
    return {
      color: "#3a3f45",
      weight: 1,
      fillColor: feature.properties.zoneColor || "#9E9E9E",
      fillOpacity: 0.75,
    };
  }

  function styleHorsZone() {
    return {
      color: "#8a929c",
      weight: 0.5,
      fillColor: "#c9ced4",
      fillOpacity: 0.35,
    };
  }

  function highlightStyle() {
    return { color: "#111418", weight: 3, fillOpacity: 0.9 };
  }

  function onEachBatiment(feature, layer) {
    defaultStyleCache.set(layer, layer.options);
    layer.on("click", () => selectBuilding(layer, feature));
    layer.on("keypress", (e) => {
      if (e.originalEvent && (e.originalEvent.key === "Enter" || e.originalEvent.key === " ")) {
        selectBuilding(layer, feature);
      }
    });
  }

  // À faible zoom, les bâtiments (petits polygones) sont difficiles à
  // atteindre précisément au clic : un clic dans une zone qui ne touche
  // aucun bâtiment retombe sur le polygone de zonage. On affiche alors une
  // réponse minimale (zone + invitation à zoomer) plutôt que de ne rien
  // faire, ce qui serait déroutant pour l'utilisateur.
  function onEachZonage(feature, layer) {
    layer.on("click", (e) => {
      clearSelection();
      renderZoneFallbackPanel(feature.properties);
      setPanelExpanded(true);
      if (window.innerWidth < 860) {
        map.flyTo(e.latlng, Math.max(map.getZoom() + 2, 17), { duration: 0.5 });
      } else {
        map.setView(e.latlng, Math.max(map.getZoom() + 2, 17));
      }
    });
  }

  function renderZoneFallbackPanel(p) {
    panelCloseBtn.hidden = false;
    panelZoneDot.style.background = p.zoneColor;
    panelTitle.textContent = CONFIG.zoneShortNames[p.zoneCode]
      ? `Zone ${CONFIG.zoneShortNames[p.zoneCode]}`
      : "Zone réglementée";
    panelSubtitle.textContent = p.zoneLabel || "";
    panelBody.innerHTML = `
      <div class="intro-block">
        ${badge(CONFIG.zoneShortNames[p.zoneCode] || p.zoneCode, p.zoneColor)}
        <p>Ce point se trouve dans une zone réglementée par le PPRi. La carte
        vient de zoomer : cliquez maintenant directement sur le contour de
        votre bâtiment pour afficher ses obligations précises.</p>
      </div>
    `;
  }

  function onEachErp(feature, latlng) {
    const color = feature.properties.zoneColor || "#9E9E9E";
    const marker = L.circleMarker(latlng, {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95,
      className: "erp-marker",
    });
    marker.bindPopup(renderErpPopup(feature.properties), { maxWidth: 280 });
    return marker;
  }

  function renderErpPopup(p) {
    const zone = p.zoneCode
      ? `en zone <strong>${escapeHtml(CONFIG.zoneShortNames[p.zoneCode] || p.zoneCode)}</strong>`
      : "hors zonage réglementaire";
    return `
      <strong>${escapeHtml(p.nom || "Établissement")}</strong><br>
      ${p.activite ? escapeHtml(p.activite) + "<br>" : ""}
      ${p.adresse ? `<span class="text-muted">${escapeHtml(p.adresse)}</span><br>` : ""}
      <span>Situé ${zone} du PPRi inondation.</span>
      ${
        p.classeVulnerabilite
          ? `<br><span class="text-muted">Sensibilité : ${escapeHtml(p.classeVulnerabilite)}</span>`
          : ""
      }
      <br><a href="glossaire.html" target="_blank" rel="noopener">Comprendre les obligations ERP</a>
    `;
  }

  async function init() {
    try {
      const [zonage, batZone, batHors, erp] = await Promise.all([
        loadJSON(CONFIG.dataUrls.zonage),
        loadJSON(CONFIG.dataUrls.batimentsZone),
        loadJSON(CONFIG.dataUrls.batimentsHorsZone),
        loadJSON(CONFIG.dataUrls.erp),
      ]);

      L.geoJSON(zonage, { style: styleZonage, onEachFeature: onEachZonage }).addTo(layers.zonage);

      L.geoJSON(batHors, {
        style: styleHorsZone,
        onEachFeature: onEachBatiment,
      }).addTo(layers.horsZone);

      L.geoJSON(batZone, {
        style: styleBatiment,
        onEachFeature: onEachBatiment,
      }).addTo(layers.batiments);

      L.geoJSON(erp, { pointToLayer: onEachErp }).addTo(layers.erp);

      window.__appData = { zonage, batZone, batHors, erp };
      document.dispatchEvent(new CustomEvent("app:data-ready"));
    } catch (err) {
      console.error(err);
      showFatalError(
        "Les données cartographiques n'ont pas pu être chargées. " +
          "Vérifiez votre connexion puis rechargez la page."
      );
    }
  }

  function showFatalError(message) {
    const body = document.getElementById("panel-body");
    body.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`;
    setPanelExpanded(true);
  }

  /* ----------------------------------------------------------------------
   * 4. Sélection d'un bâtiment & panneau d'information
   * -------------------------------------------------------------------- */

  const panel = document.getElementById("info-panel");
  const panelBody = document.getElementById("panel-body");
  const panelTitle = document.getElementById("panel-title");
  const panelSubtitle = document.getElementById("panel-subtitle");
  const panelZoneDot = document.getElementById("panel-zone-dot");
  const panelHandleBtn = document.getElementById("panel-handle");
  const panelCloseBtn = document.getElementById("panel-close");

  function setPanelExpanded(expanded) {
    panel.classList.toggle("expanded", expanded);
    panelHandleBtn.setAttribute("aria-expanded", String(expanded));
  }

  panelHandleBtn.addEventListener("click", () => {
    setPanelExpanded(!panel.classList.contains("expanded"));
  });

  panelCloseBtn.addEventListener("click", () => {
    clearSelection();
    showWelcomePanel();
  });

  function clearSelection() {
    if (selectedLayer) {
      const original = defaultStyleCache.get(selectedLayer);
      if (original) selectedLayer.setStyle(original);
      selectedLayer = null;
    }
  }

  function selectBuilding(layer, feature) {
    clearSelection();
    selectedLayer = layer;
    layer.setStyle(highlightStyle());
    if (layer.bringToFront) layer.bringToFront();

    renderBuildingPanel(feature.properties);
    setPanelExpanded(true);

    // Sur mobile, on centre la carte un peu au-dessus du panneau pour que
    // le bâtiment reste visible pendant que le panneau occupe le bas d'écran.
    if (window.innerWidth < 860 && layer.getBounds) {
      const bounds = layer.getBounds();
      map.flyTo(bounds.getCenter(), Math.max(map.getZoom(), 17), { duration: 0.5 });
    } else if (layer.getBounds) {
      map.panTo(layer.getBounds().getCenter());
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badge(text, color) {
    return `<span class="badge" style="background:${color}">${escapeHtml(text)}</span>`;
  }

  function renderBuildingPanel(p) {
    panelCloseBtn.hidden = false;

    if (!p.concerne) {
      panelZoneDot.style.background = "var(--zone-hors)";
      panelTitle.textContent = "Bâtiment hors zonage PPRi";
      panelSubtitle.textContent = "Aygalades (Caravelle) et affluents";
      panelBody.innerHTML = `
        <div class="intro-block">
          <p>
            Ce bâtiment n'est <strong>pas situé dans une zone réglementée</strong>
            par le Plan de Prévention des Risques naturels d'inondation (PPRi)
            « Aygalades (Caravelle) et affluents » sur Septèmes-les-Vallons.
          </p>
          <p class="text-muted">
            Cela ne signifie pas une absence totale de risque (ruissellement,
            autres cours d'eau, aléas non cartographiés à cette échelle...).
            Pour une vue complète des risques à cette adresse, consultez
            <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noopener">Géorisques</a>.
          </p>
        </div>
      `;
      return;
    }

    panelZoneDot.style.background = p.zoneColor;
    panelTitle.textContent = CONFIG.zoneShortNames[p.zoneCode]
      ? `Zone ${CONFIG.zoneShortNames[p.zoneCode]}`
      : "Zone réglementée";
    panelSubtitle.textContent = p.zoneLabel || "";

    const sections = [];

    // --- Résumé / régime ---
    sections.push(`
      <div class="intro-block">
        ${badge(CONFIG.zoneShortNames[p.zoneCode] || p.zoneCode, p.zoneColor)}
        <p>${escapeHtml(p.regime || "Consultez le règlement du PPRi pour le régime applicable à ce bâtiment.")}</p>
      </div>
    `);

    // --- Diagnostic de vulnérabilité ---
    if (p.diagnostic) {
      sections.push(section("🔎", "Diagnostic de vulnérabilité", `<p>${escapeHtml(p.diagnostic)}</p>`));
    }

    // --- Zone refuge ---
    if (p.zoneRefuge || p.refugeCategorie) {
      const isObligatoire = (p.refugeCategorie || "").startsWith("Obligatoire");
      sections.push(
        section(
          "🛟",
          "Zone refuge",
          `<p>${escapeHtml(p.zoneRefuge || p.refugeCategorie)}</p>` +
            (isObligatoire
              ? `<p class="text-muted">Une zone refuge est un niveau du bâtiment situé au-dessus des plus hautes eaux connues, permettant d'attendre les secours en cas de crue.</p>`
              : "")
        )
      );
    }

    // --- Travaux sur l'existant / emprise au sol ---
    if (p.empriseFiable === "Oui" && (p.annexeMaxM2 || p.extensionHebergementM2 || p.extensionActiviteM2)) {
      const chips = [];
      if (p.empriseSolM2) {
        chips.push(`<div class="figure-chip"><strong>${p.empriseSolM2} m²</strong>emprise au sol actuelle</div>`);
      }
      if (p.annexeMaxM2) {
        chips.push(`<div class="figure-chip"><strong>${p.annexeMaxM2} m²</strong>annexe autorisée (création)</div>`);
      }
      if (p.extensionHebergementM2) {
        chips.push(
          `<div class="figure-chip"><strong>${p.extensionHebergementM2} m²</strong>extension hébergement</div>`
        );
      }
      if (p.extensionActiviteM2) {
        chips.push(
          `<div class="figure-chip"><strong>${p.extensionActiviteM2} m²</strong>extension activité (approx.)</div>`
        );
      } else if (p.extensionActiviteNote) {
        chips.push(`<div class="figure-chip">Extension activité : voir note</div>`);
      }
      sections.push(
        section(
          "📐",
          "Travaux sur l'existant",
          `<div class="figure-row">${chips.join("")}</div>` +
            (p.extensionActiviteNote ? `<p class="text-muted">${escapeHtml(p.extensionActiviteNote)}</p>` : "") +
            `<p class="text-muted">Seuils calculés à partir de la géométrie du bâtiment (emprise au sol réelle) ; à confirmer par un professionnel avant tout dépôt de dossier.</p>`
        )
      );
    } else if (p.empriseFiable && p.empriseFiable.startsWith("Non")) {
      sections.push(
        section(
          "📐",
          "Travaux sur l'existant",
          `<p class="text-muted">Emprise au sol trop réduite pour un calcul de seuil fiable à partir des données disponibles (annexe, abri...). Se référer directement au règlement du PPRi.</p>`
        )
      );
    }

    // --- Aides financières ---
    if (p.eligibiliteFprnm) {
      sections.push(section("💶", "Aides financières (Fonds Barnier)", `<p>${escapeHtml(p.eligibiliteFprnm)}</p>`));
    }

    // --- Obligations liées à la typologie ---
    if (p.obligationsTypologie) {
      sections.push(section("📋", "Obligations liées à ce type de bâtiment", `<p>${escapeHtml(p.obligationsTypologie)}</p>`));
    }

    // --- Détails techniques (repliés) ---
    const techRows = [];
    if (p.zonesIntersectees) techRows.push(techRow("Zones intersectées", p.zonesIntersectees));
    if (p.typologie) {
      const src = p.typologieSource ? ` (source : ${p.typologieSource})` : " (source : BD TOPO®)";
      techRows.push(techRow("Typologie", `${p.typologie}${src}`));
    }
    if (p.etagePresent) techRows.push(techRow("Étage présent", `${p.etagePresent}${p.etageSource ? " - " + p.etageSource : ""}`));
    if (p.nbLogements) techRows.push(techRow("Nombre de logements", p.nbLogements));
    if (p.hauteurM) techRows.push(techRow("Hauteur du bâti (BD TOPO)", `${p.hauteurM} m`));
    if (p.id) techRows.push(techRow("Identifiant BD TOPO", p.id));

    if (techRows.length) {
      sections.push(`
        <details class="tech-details">
          <summary>Détails techniques (pour élus, techniciens, bureaux d'études)</summary>
          <dl>${techRows.join("")}</dl>
        </details>
      `);
    }

    sections.push(`
      <p class="text-muted" style="margin-top:18px;font-size:0.8rem">
        Ces informations sont calculées automatiquement à partir du règlement du
        PPRi et de données géographiques (IGN BD TOPO). Elles n'ont pas de valeur
        réglementaire opposable : en cas de doute, contactez le service urbanisme
        de la mairie ou la DDTM des Bouches-du-Rhône. Voir la page
        <a href="mentions-legales.html">mentions légales</a>.
      </p>
    `);

    panelBody.innerHTML = sections.join("");
  }

  function section(icon, title, html) {
    return `<section class="detail-block"><h3>${icon} ${escapeHtml(title)}</h3>${html}</section>`;
  }

  function techRow(label, value) {
    return `<div class="tech-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
  }

  function showWelcomePanel() {
    panelZoneDot.style.background = "var(--color-primary)";
    panelTitle.textContent = "Mes obligations face au risque inondation";
    panelSubtitle.textContent = "Septèmes-les-Vallons - PPRi Aygalades (Caravelle) et affluents";
    panelCloseBtn.hidden = true;
    panelBody.innerHTML = `
      <div class="intro-block">
        <p>
          Cliquez sur un bâtiment sur la carte, ou recherchez une adresse
          ci-dessus, pour connaître les obligations réglementaires liées au
          risque inondation qui s'appliquent à ce bâtiment.
        </p>
        <p class="text-muted">
          Cet outil s'adresse aussi bien aux habitants qu'aux gestionnaires
          d'établissements recevant du public (ERP), d'activités économiques,
          ainsi qu'aux élus et techniciens.
        </p>
        <div class="welcome-cta">
          <a class="btn primary" href="#" id="cta-locate">📍 Me localiser</a>
          <a class="btn" href="glossaire.html">📖 Glossaire</a>
          <a class="btn" href="faq.html">❓ Questions fréquentes</a>
        </div>
      </div>
    `;
    document.getElementById("cta-locate").addEventListener("click", (e) => {
      e.preventDefault();
      geolocate();
    });
  }

  /* ----------------------------------------------------------------------
   * 5. Recherche d'adresse (API Adresse - Base Adresse Nationale) & géoloc
   * -------------------------------------------------------------------- */

  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");
  let searchDebounce = null;

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 3) {
      closeSearchResults();
      return;
    }
    searchDebounce = setTimeout(() => runAddressSearch(q), 300);
  });

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (searchInput.value.trim().length >= 3) runAddressSearch(searchInput.value.trim());
  });

  function closeSearchResults() {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
  }

  async function runAddressSearch(q) {
    try {
      const url =
        "https://api-adresse.data.gouv.fr/search/?q=" +
        encodeURIComponent(q) +
        "&citycode=" +
        CONFIG.codeInsee +
        "&limit=5";
      const res = await fetch(url);
      if (!res.ok) throw new Error("recherche indisponible");
      const data = await res.json();
      renderSearchResults(data.features || []);
    } catch (err) {
      console.warn("Recherche d'adresse indisponible :", err);
      searchResults.innerHTML = `<div style="padding:12px;font-size:0.85rem" class="text-muted">
        Recherche indisponible pour le moment. Vous pouvez cliquer directement sur la carte.
      </div>`;
      searchResults.classList.add("open");
    }
  }

  function renderSearchResults(features) {
    if (!features.length) {
      searchResults.innerHTML = `<div style="padding:12px;font-size:0.85rem" class="text-muted">
        Aucune adresse trouvée sur la commune.
      </div>`;
      searchResults.classList.add("open");
      return;
    }
    searchResults.innerHTML = features
      .map((f, i) => `<button type="button" data-idx="${i}">${escapeHtml(f.properties.label)}</button>`)
      .join("");
    searchResults.classList.add("open");
    searchResults.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = features[Number(btn.dataset.idx)];
        goToPoint(f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties.label);
        closeSearchResults();
        searchInput.value = f.properties.label;
      });
    });
  }

  function goToPoint(lat, lng, label) {
    map.flyTo([lat, lng], 18, { duration: 0.6 });
    const marker = L.marker([lat, lng], { title: label }).addTo(map);
    setTimeout(() => map.removeLayer(marker), 6000);
    tryFindBuildingAt(lat, lng);
  }

  function tryFindBuildingAt(lat, lng) {
    if (!window.turf) return;
    const pt = turf.point([lng, lat]);
    const data = window.__appData;
    if (!data) return;
    const collections = [data.batZone, data.batHors];
    for (const fc of collections) {
      for (const feature of fc.features) {
        try {
          if (turf.booleanPointInPolygon(pt, feature)) {
            const layerMatch = findLeafletLayerById(feature.properties.id);
            if (layerMatch) {
              selectBuilding(layerMatch.layer, layerMatch.feature);
            }
            return;
          }
        } catch (e) {
          /* géométrie invalide isolée : on ignore et continue */
        }
      }
    }
  }

  function findLeafletLayerById(id) {
    let found = null;
    [layers.batiments, layers.horsZone].forEach((group) => {
      group.eachLayer((sub) => {
        sub.eachLayer &&
          sub.eachLayer((leaf) => {
            if (leaf.feature && leaf.feature.properties.id === id) {
              found = { layer: leaf, feature: leaf.feature };
            }
          });
      });
    });
    return found;
  }

  function geolocate() {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        goToPoint(pos.coords.latitude, pos.coords.longitude, "Ma position");
      },
      () => {
        alert("Impossible d'accéder à votre position. Vérifiez les autorisations de localisation.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  document.getElementById("locate-btn").addEventListener("click", geolocate);

  /* ----------------------------------------------------------------------
   * 6. Légende & bascule des couches
   *
   * La légende est un simple bouton + panneau déroulant en HTML statique
   * (et non un contrôle Leaflet) : elle reste ainsi toujours à côté de la
   * recherche, sans jamais recouvrir le panneau d'information ni la carte,
   * quelle que soit la taille d'écran.
   * -------------------------------------------------------------------- */

  const legendToggle = document.getElementById("legend-toggle");
  const legendBox = document.getElementById("legend-box");

  function setLegendOpen(open) {
    legendBox.classList.toggle("open", open);
    legendToggle.setAttribute("aria-expanded", String(open));
    legendToggle.setAttribute("aria-pressed", String(open));
  }

  legendToggle.addEventListener("click", () => {
    setLegendOpen(!legendBox.classList.contains("open"));
  });

  document.addEventListener("click", (e) => {
    if (!legendBox.classList.contains("open")) return;
    if (e.target === legendToggle || legendBox.contains(e.target)) return;
    setLegendOpen(false);
  });

  const horsToggle = document.getElementById("toggle-horszone");
  const erpToggle = document.getElementById("toggle-erp");
  horsToggle.addEventListener("change", () => {
    if (horsToggle.checked) map.addLayer(layers.horsZone);
    else map.removeLayer(layers.horsZone);
  });
  erpToggle.addEventListener("change", () => {
    if (erpToggle.checked) map.addLayer(layers.erp);
    else map.removeLayer(layers.erp);
  });

  /* ----------------------------------------------------------------------
   * Menu mobile
   * -------------------------------------------------------------------- */
  const menuToggle = document.getElementById("menu-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }

  /* ----------------------------------------------------------------------
   * Démarrage
   * -------------------------------------------------------------------- */
  showWelcomePanel();
  init();
})();

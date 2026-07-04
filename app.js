const brand = {
  dark: "#1B4332",
  green: "#2D6A4F",
  pine: "#40916C",
  cream: "#F8F7F3",
  blm: "#D9A441"
};

const coloradoBounds = [[36.98, -109.06], [41.01, -102.03]];
const paddedBounds = [[33.5, -115.0], [44.5, -96.5]];

const map = L.map("map", {
  maxBounds: paddedBounds,
  maxBoundsViscosity: 0.1,
  minZoom: 6,
  maxZoom: 17
});
map.fitBounds(coloradoBounds);

// Explicit stacking order, independent of add/toggle order:
// tiles (200) < terrainPane (350) < overlayPane/GMU+land (400, default) < wildlifePane (405) < waterPane (410) < locationPane (450) < pinsPane (460)
map.createPane("terrainPane");
map.getPane("terrainPane").style.zIndex = 350;
map.getPane("terrainPane").style.pointerEvents = "none";
map.createPane("wildlifePane");
map.getPane("wildlifePane").style.zIndex = 405;
map.createPane("waterPane");
map.getPane("waterPane").style.zIndex = 410;
map.createPane("locationPane");
map.getPane("locationPane").style.zIndex = 450;
map.createPane("pinsPane");
map.getPane("pinsPane").style.zIndex = 460;

// Satellite imagery (Esri World Imagery — confirmed live, no API key
// required) as the base, with the USGS topo layer semi-transparent on
// top by default for a hybrid view. Both stay in Leaflet's default
// tilePane (z-index 200), below every custom pane above, so this never
// interferes with the terrain/land/water/wildlife stacking order.
const imageryLayer = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Esri, Maxar, Earthstar Geographics"
});
const topoLayer = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution: "USGS Topo | CPW | BLM"
});

function setBasemapMode(mode) {
  if (mode === "hybrid") {
    if (!map.hasLayer(imageryLayer)) imageryLayer.addTo(map);
    if (!map.hasLayer(topoLayer)) topoLayer.addTo(map);
    topoLayer.setOpacity(0.5);
  } else if (mode === "satellite") {
    if (!map.hasLayer(imageryLayer)) imageryLayer.addTo(map);
    if (map.hasLayer(topoLayer)) map.removeLayer(topoLayer);
  } else if (mode === "topo") {
    if (map.hasLayer(imageryLayer)) map.removeLayer(imageryLayer);
    if (!map.hasLayer(topoLayer)) topoLayer.addTo(map);
    topoLayer.setOpacity(1);
  }
}
setBasemapMode("hybrid"); // default: satellite + semi-transparent topo

document.querySelectorAll('input[name="basemapMode"]').forEach(radio => {
  radio.addEventListener("change", function () {
    if (this.checked) setBasemapMode(this.value);
  });
});

const gmuURL =
  "https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/6/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson";
const landURL =
  "https://gis.blm.gov/coarcgis/rest/services/lands/BLM_Colorado_Surface_Management_Agency/FeatureServer/1";
// USGS National Hydrography Dataset (confirmed layer IDs/fields via hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer)
const waterURL = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer";

// CPW Species Activity Mapping (SAM) — expert-digitized wildlife distribution
// data, not GPS collar telemetry. Same field schema (ACTIVITYCO/INPUT_DATE/
// EDIT_DATE) across all 300+ species layers in this service, so adding more
// species later is just adding entries here, not new query/render logic.
const wildlifeURL = "https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWSpeciesData/FeatureServer";
let WILDLIFE_SPECIES = "elk"; // driven by the species dropdown
const WILDLIFE_LAYERS = {
  elk: { migration: 40, winterRange: 43, summerRange: 36, resident: 39 }
  // add future species here (e.g. mule_deer: { migration: <id>, ... }) —
  // querying/rendering code needs no changes, just a data entry.
};

// COTREX (Colorado Trail Explorer) — statewide trail inventory (~40,000
// miles, sourced from USFS/BLM/local governments), hosted in the same
// CPWAdminData service already used for GMU boundaries. Chose this over
// USFS's own MVUM service because apps.fs.usda.gov is a self-hosted
// government ArcGIS Server with unconfirmed CORS support — a
// server-side fetch can verify the *data* exists there but can't tell
// us whether a browser can actually reach it. COTREX has real
// atv/motorcycle/ohv_gt_50 fields (confirmed via its schema), so
// motorized-vs-general trails can be split from this one query.
const cotrexTrailsURL = "https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/15";

const WILDLIFE_LABELS = { elk: "Elk", mule_deer: "Mule Deer", pronghorn: "Pronghorn" };

// Season Engine — reweights the composite "ScoutIQ Score" terrain layer.
// Only "archery" reflects biology the person explicitly specified (north
// aspect, higher elevation, water + migration proximity for September).
// The other five are directional drafts (userValidated: false) meant as a
// starting point to refine, not settled claims — flagged as such in the
// UI so they don't read with more confidence than they've earned.
const SEASON_PROFILES = {
  archery: {
    label: "Archery",
    weights: { northness: 0.30, elevation: 0.25, water: 0.25, migration: 0.20 },
    aspectPreference: "north",
    elevationPreference: "high",
    note: "September: warm temperatures push elk toward north-facing shade and higher elevation; water stays a strong daily draw before migration begins.",
    userValidated: true
  },
  muzzleloader: {
    label: "Muzzleloader",
    weights: { northness: 0.30, elevation: 0.25, water: 0.25, migration: 0.20 },
    aspectPreference: "north",
    elevationPreference: "high",
    note: "Colorado muzzleloader season falls in mid-September, close in timing to archery — using the same profile as a starting point.",
    userValidated: false
  },
  first_rifle: {
    label: "First Rifle",
    weights: { northness: 0.15, elevation: 0.20, water: 0.25, migration: 0.40 },
    aspectPreference: "north",
    elevationPreference: "high",
    note: "Cooling temperatures reduce the need for shade; rising hunting pressure and early migration make travel corridors more predictive.",
    userValidated: false
  },
  second_rifle: {
    label: "Second Rifle",
    weights: { northness: 0.10, elevation: 0.15, water: 0.20, migration: 0.55 },
    aspectPreference: "south",
    elevationPreference: "neutral",
    note: "Elk are actively migrating toward winter range; cold weather may favor sun-exposed south aspects over shade. Migration corridors become the dominant signal.",
    userValidated: false
  },
  third_rifle: {
    label: "Third Rifle",
    weights: { northness: 0.10, elevation: 0.15, water: 0.20, migration: 0.55 },
    aspectPreference: "south",
    elevationPreference: "low",
    note: "Elk are typically settling into winter range by now — lower elevation, south-facing slopes for warmth. This model doesn't yet weight proximity to mapped Winter Range polygons directly, which would sharpen this further.",
    userValidated: false
  },
  fourth_rifle: {
    label: "Fourth Rifle",
    weights: { northness: 0.05, elevation: 0.20, water: 0.15, migration: 0.60 },
    aspectPreference: "south",
    elevationPreference: "low",
    note: "Deep winter conditions; low elevation and south aspects dominate, and migration/winter range positioning matters more than daily water proximity.",
    userValidated: false
  }
};

let CURRENT_SEASON = null; // no default — the person must choose a season to generate a heat map

const speciesSelect = document.getElementById("speciesSelect");
const seasonSelect = document.getElementById("seasonSelect");
const wildlifeGroupLabel = document.getElementById("wildlifeGroupLabel");
const scoutiqLabel = document.getElementById("scoutiqLabel");

speciesSelect.addEventListener("change", function () {
  WILDLIFE_SPECIES = this.value;
  wildlifeGroupLabel.textContent = WILDLIFE_LABELS[WILDLIFE_SPECIES] || WILDLIFE_SPECIES;
  if (selectedLayer) refreshWildlifeLayers();
});

function updateScoutIQLabel() {
  scoutiqLabel.textContent = CURRENT_SEASON
    ? `ScoutIQ Score — ${SEASON_PROFILES[CURRENT_SEASON].label}`
    : "ScoutIQ Score (select a season)";
}
updateScoutIQLabel();

// Selecting a season is the trigger for the heat map — no separate radio
// click needed. Clearing the season back to the placeholder turns the
// heat map off if it was showing.
seasonSelect.addEventListener("change", function () {
  CURRENT_SEASON = this.value || null;
  updateScoutIQLabel();
  if (!selectedLayer) return; // no unit yet; selection is just stored for later
  const scoutiqRadio = document.querySelector('input[name="terrainMode"][value="scoutiq_score"]');
  if (!CURRENT_SEASON) {
    if (scoutiqRadio.checked) {
      document.querySelector('input[name="terrainMode"][value="none"]').checked = true;
      showTerrainLayer("none");
    }
    return;
  }
  if (!scoutiqRadio.disabled) {
    scoutiqRadio.checked = true;
    showTerrainLayer("scoutiq_score");
  }
});

let gmuLayer;
let selectedLayer = null;
let selectedUnit = null;
const unitLayers = {};

const unitSelect = document.getElementById("unitSelect");
const statusBox = document.getElementById("status");
const blmToggle = document.getElementById("blmToggle");
const forestToggle = document.getElementById("forestToggle");
const privateToggle = document.getElementById("privateToggle");
const streamsToggle = document.getElementById("streamsToggle");
const lakesToggle = document.getElementById("lakesToggle");
const springsToggle = document.getElementById("springsToggle");
const migrationToggle = document.getElementById("migrationToggle");
const winterRangeToggle = document.getElementById("winterRangeToggle");
const summerRangeToggle = document.getElementById("summerRangeToggle");
const residentToggle = document.getElementById("residentToggle");
const roadsToggle = document.getElementById("roadsToggle");
const ohvToggle = document.getElementById("ohvToggle");

let blmLayer = null;
let forestLayer = null;
let privateLayer = null;
let streamsLayer = null;
let lakesLayer = null;
let springsLayer = null;
let migrationLayer = null;
let winterRangeLayer = null;
let summerRangeLayer = null;
let residentLayer = null;
let roadsLayer = null;
let ohvLayer = null;

function getUnitNumber(properties) {
  return properties.GMUID || "Unknown";
}

function defaultStyle() {
  return {
    color: "#444",
    weight: 1,
    fillColor: brand.pine,
    fillOpacity: 0.08,
    opacity: 0.8
  };
}

function selectedStyle() {
  return {
    color: brand.dark,
    weight: 4,
    fillColor: brand.green,
    fillOpacity: 0.24,
    opacity: 1
  };
}

function enableLandFilters() {
  blmToggle.disabled = false;
  forestToggle.disabled = false;
  privateToggle.disabled = false;
  streamsToggle.disabled = false;
  lakesToggle.disabled = false;
  springsToggle.disabled = false;
  migrationToggle.disabled = false;
  winterRangeToggle.disabled = false;
  summerRangeToggle.disabled = false;
  residentToggle.disabled = false;
  roadsToggle.disabled = false;
  ohvToggle.disabled = false;
  statusBox.textContent = `Unit ${selectedUnit} selected. Choose land/water/wildlife filters.`;
}

function disableLandFilters() {
  blmToggle.checked = false;
  forestToggle.checked = false;
  privateToggle.checked = false;
  streamsToggle.checked = false;
  lakesToggle.checked = false;
  springsToggle.checked = false;
  migrationToggle.checked = false;
  winterRangeToggle.checked = false;
  summerRangeToggle.checked = false;
  residentToggle.checked = false;
  roadsToggle.checked = false;
  ohvToggle.checked = false;
  blmToggle.disabled = true;
  forestToggle.disabled = true;
  privateToggle.disabled = true;
  streamsToggle.disabled = true;
  lakesToggle.disabled = true;
  springsToggle.disabled = true;
  migrationToggle.disabled = true;
  winterRangeToggle.disabled = true;
  summerRangeToggle.disabled = true;
  residentToggle.disabled = true;
  roadsToggle.disabled = true;
  ohvToggle.disabled = true;
  removeLandLayers();
  removeWaterLayers();
  removeWildlifeLayers();
  removeRoadsOHVLayers();
  statusBox.textContent = "Select a unit first.";
}

function removeLandLayers() {
  if (blmLayer) map.removeLayer(blmLayer);
  if (forestLayer) map.removeLayer(forestLayer);
  if (privateLayer) map.removeLayer(privateLayer);
  blmLayer = null;
  forestLayer = null;
  privateLayer = null;
}

/* --- Land + water data loading ---
   Previously these used L.esri.featureLayer, which keeps re-querying
   whatever is in the current map viewport as you pan/zoom — not scoped
   to the selected unit at all, which is why data appeared "everywhere"
   and felt sluggish. Instead we run a single L.esri.query().intersects()
   against the selected unit's actual polygon (not just its bounding
   box) and render the one-time result as a static L.geoJSON layer.
   A request token guards against a slow query resolving after the
   person has already switched units or unchecked the toggle. */
let landRequestToken = 0;
let waterRequestToken = 0;

function queryWithinUnit(url, whereClause, boundaryLayer) {
  const geometry = boundaryLayer.toGeoJSON().geometry;
  return new Promise((resolve, reject) => {
    L.esri.query({ url })
      .intersects(geometry)
      .where(whereClause)
      .run(function (error, featureCollection) {
        if (error) reject(error);
        else resolve(featureCollection || { type: "FeatureCollection", features: [] });
      });
  });
}

function landPopupHTML(props, title) {
  return `
    <strong>${title}</strong><br>
    ${props.adm_name || "Unknown area"}<br>
    Manager: ${props.adm_manage || "Unknown"}<br>
    Acres: ${props.GIS_acres ? Math.round(props.GIS_acres).toLocaleString() : "N/A"}
  `;
}

function buildLandLayer(featureCollection, styleObj, title) {
  return L.geoJSON(featureCollection, {
    style: () => styleObj,
    onEachFeature: (feature, layer) => layer.bindPopup(landPopupHTML(feature.properties, title))
  });
}

async function refreshLandLayers() {
  removeLandLayers();
  if (!selectedLayer) return;
  const token = ++landRequestToken;
  const boundaryLayer = selectedLayer;
  const tasks = [];
  if (blmToggle.checked) {
    tasks.push(queryWithinUnit(landURL, "adm_manage = 'BLM'", boundaryLayer)
      .then(fc => ({ key: "blm", fc })).catch(error => ({ key: "blm", error })));
  }
  if (forestToggle.checked) {
    tasks.push(queryWithinUnit(landURL, "adm_manage IN ('USFS', 'USFS_NG')", boundaryLayer)
      .then(fc => ({ key: "forest", fc })).catch(error => ({ key: "forest", error })));
  }
  if (privateToggle.checked) {
    tasks.push(queryWithinUnit(landURL, "adm_manage = 'PRI'", boundaryLayer)
      .then(fc => ({ key: "private", fc })).catch(error => ({ key: "private", error })));
  }
  if (tasks.length === 0) return;
  statusBox.textContent = `Unit ${selectedUnit} — loading land data...`;
  const results = await Promise.all(tasks);
  if (token !== landRequestToken) return; // a newer request superseded this one
  results.forEach(({ key, fc, error }) => {
    if (error) { console.error(`Land layer "${key}" query failed:`, error); return; }
    if (key === "blm") {
      blmLayer = buildLandLayer(fc,
        { color: "#8A5A12", weight: 1, fillColor: brand.blm, fillOpacity: 0.35, opacity: 0.9 },
        "BLM Land").addTo(map);
    } else if (key === "forest") {
      forestLayer = buildLandLayer(fc,
        { color: "#1B4332", weight: 1, fillColor: brand.green, fillOpacity: 0.30, opacity: 0.9 },
        "National Forest").addTo(map);
    } else if (key === "private") {
      privateLayer = buildLandLayer(fc,
        { color: "#7A6A4F", weight: 1, fillColor: brand.cream, fillOpacity: 0.45, opacity: 0.9 },
        "Private Land").addTo(map);
    }
  });
  if (gmuLayer) gmuLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
  statusBox.textContent = `Unit ${selectedUnit} selected. Choose land/water filters.`;
}

/* --- Water features (USGS National Hydrography Dataset) ---
   Uses a lettered pane so water always renders above land ownership
   fills and terrain color, regardless of add order. */
function removeWaterLayers() {
  if (streamsLayer) map.removeLayer(streamsLayer);
  if (lakesLayer) map.removeLayer(lakesLayer);
  if (springsLayer) map.removeLayer(springsLayer);
  streamsLayer = null;
  lakesLayer = null;
  springsLayer = null;
}

function buildStreamsLayer(fc) {
  return L.geoJSON(fc, {
    pane: "waterPane",
    style: () => ({ color: "#2C7DA0", weight: 1.5, opacity: 0.85 }),
    onEachFeature: (feature, layer) => {
      const name = feature.properties.gnis_name || "Unnamed";
      layer.bindPopup(`<strong>Stream / River</strong><br>${name}`);
    }
  });
}

function buildLakesLayer(fc) {
  return L.geoJSON(fc, {
    pane: "waterPane",
    style: () => ({ color: "#1B4965", weight: 1, fillColor: "#61A5C2", fillOpacity: 0.5 }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const label = p.FTYPE === 436 ? "Reservoir" : "Lake / Pond";
      layer.bindPopup(`<strong>${label}</strong><br>${p.GNIS_NAME || "Unnamed"}`);
    }
  });
}

function buildSpringsLayer(fc) {
  return L.geoJSON(fc, {
    pane: "waterPane",
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 5, color: "#0B4F6C", weight: 1, fillColor: "#40916C", fillOpacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(`<strong>Spring / Seep</strong><br>${p.GNIS_NAME || "Unnamed"}`);
    }
  });
}

async function refreshWaterLayers() {
  removeWaterLayers();
  if (!selectedLayer) return;
  const token = ++waterRequestToken;
  const boundaryLayer = selectedLayer;
  const tasks = [];
  if (streamsToggle.checked) {
    tasks.push(queryWithinUnit(`${waterURL}/6`, "ftype = 460", boundaryLayer)
      .then(fc => ({ key: "streams", fc })).catch(error => ({ key: "streams", error })));
  }
  if (lakesToggle.checked) {
    tasks.push(queryWithinUnit(`${waterURL}/12`, "FTYPE IN (390, 436)", boundaryLayer)
      .then(fc => ({ key: "lakes", fc })).catch(error => ({ key: "lakes", error })));
  }
  if (springsToggle.checked) {
    tasks.push(queryWithinUnit(`${waterURL}/0`, "FTYPE = 458", boundaryLayer)
      .then(fc => ({ key: "springs", fc })).catch(error => ({ key: "springs", error })));
  }
  if (tasks.length === 0) return;
  const results = await Promise.all(tasks);
  if (token !== waterRequestToken) return;
  results.forEach(({ key, fc, error }) => {
    if (error) { console.error(`Water layer "${key}" query failed:`, error); return; }
    if (key === "streams") streamsLayer = buildStreamsLayer(fc).addTo(map);
    else if (key === "lakes") lakesLayer = buildLakesLayer(fc).addTo(map);
    else if (key === "springs") springsLayer = buildSpringsLayer(fc).addTo(map);
  });
  if (gmuLayer) gmuLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
}

/* --- Wildlife (CPW Species Activity Mapping) ---
   Unlike land/water, these are queried against a padded area around the
   unit rather than the strict polygon — a migration corridor or winter
   range that just clips the corner of a unit is exactly the context
   worth seeing continue into neighboring terrain, not a reason to cut
   it off at the boundary. Uses its own pane so it renders above land
   ownership fills but below water features. */
let wildlifeRequestToken = 0;

function queryNearUnit(url, whereClause, boundaryLayer, padFactor = 0.5) {
  const b = boundaryLayer.getBounds().pad(padFactor);
  const bboxGeometry = {
    type: "Polygon",
    coordinates: [[
      [b.getWest(), b.getSouth()],
      [b.getEast(), b.getSouth()],
      [b.getEast(), b.getNorth()],
      [b.getWest(), b.getNorth()],
      [b.getWest(), b.getSouth()]
    ]]
  };
  return new Promise((resolve, reject) => {
    L.esri.query({ url })
      .intersects(bboxGeometry)
      .where(whereClause)
      .run(function (error, featureCollection) {
        if (error) reject(error);
        else resolve(featureCollection || { type: "FeatureCollection", features: [] });
      });
  });
}

function wildlifePopupHTML(props, title) {
  const activity = props.ACTIVITYCO || "—";
  const updated = props.EDIT_DATE ? new Date(props.EDIT_DATE).toLocaleDateString() : "Unknown";
  return `
    <strong>${title}</strong><br>
    Activity code: ${activity}<br>
    Last updated: ${updated}<br>
    <span style="font-size:11px;color:#666;">CPW Species Activity Mapping (expert-mapped, not live GPS data)</span>
  `;
}

function buildWildlifeLayer(fc, styleObj, title) {
  return L.geoJSON(fc, {
    pane: "wildlifePane",
    style: () => styleObj,
    onEachFeature: (feature, layer) => layer.bindPopup(wildlifePopupHTML(feature.properties, title))
  });
}

function removeWildlifeLayers() {
  if (migrationLayer) map.removeLayer(migrationLayer);
  if (winterRangeLayer) map.removeLayer(winterRangeLayer);
  if (summerRangeLayer) map.removeLayer(summerRangeLayer);
  if (residentLayer) map.removeLayer(residentLayer);
  migrationLayer = null;
  winterRangeLayer = null;
  summerRangeLayer = null;
  residentLayer = null;
}

async function refreshWildlifeLayers() {
  removeWildlifeLayers();
  if (!selectedLayer) return;
  const layers = WILDLIFE_LAYERS[WILDLIFE_SPECIES];
  const speciesLabel = WILDLIFE_SPECIES.charAt(0).toUpperCase() + WILDLIFE_SPECIES.slice(1);
  const token = ++wildlifeRequestToken;
  const boundaryLayer = selectedLayer;
  const tasks = [];
  if (migrationToggle.checked) {
    tasks.push(queryNearUnit(`${wildlifeURL}/${layers.migration}`, "1=1", boundaryLayer)
      .then(fc => ({ key: "migration", fc })).catch(error => ({ key: "migration", error })));
  }
  if (winterRangeToggle.checked) {
    tasks.push(queryNearUnit(`${wildlifeURL}/${layers.winterRange}`, "1=1", boundaryLayer)
      .then(fc => ({ key: "winterRange", fc })).catch(error => ({ key: "winterRange", error })));
  }
  if (summerRangeToggle.checked) {
    tasks.push(queryNearUnit(`${wildlifeURL}/${layers.summerRange}`, "1=1", boundaryLayer)
      .then(fc => ({ key: "summerRange", fc })).catch(error => ({ key: "summerRange", error })));
  }
  if (residentToggle.checked) {
    tasks.push(queryNearUnit(`${wildlifeURL}/${layers.resident}`, "1=1", boundaryLayer)
      .then(fc => ({ key: "resident", fc })).catch(error => ({ key: "resident", error })));
  }
  if (tasks.length === 0) return;
  const results = await Promise.all(tasks);
  if (token !== wildlifeRequestToken) return;
  results.forEach(({ key, fc, error }) => {
    if (error) { console.error(`Wildlife layer "${key}" query failed:`, error); return; }
    if (key === "migration") {
      migrationLayer = buildWildlifeLayer(fc,
        { color: "#BC4B51", weight: 1.5, fillColor: "#BC4B51", fillOpacity: 0.25 },
        `${speciesLabel} Migration Corridor`).addTo(map);
    } else if (key === "winterRange") {
      winterRangeLayer = buildWildlifeLayer(fc,
        { color: "#4A6FA5", weight: 1, fillColor: "#4A6FA5", fillOpacity: 0.25 },
        `${speciesLabel} Winter Range`).addTo(map);
    } else if (key === "summerRange") {
      summerRangeLayer = buildWildlifeLayer(fc,
        { color: "#C9A227", weight: 1, fillColor: "#E9C46A", fillOpacity: 0.3 },
        `${speciesLabel} Summer Range`).addTo(map);
    } else if (key === "resident") {
      residentLayer = buildWildlifeLayer(fc,
        { color: "#7B2D26", weight: 1, fillColor: "#7B2D26", fillOpacity: 0.25 },
        `${speciesLabel} Resident Population Area`).addTo(map);
    }
  });
  if (gmuLayer) gmuLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
}

/* --- Trails & OHV (COTREX, via CPWAdminData layer 15) ---
   One query returns every COTREX trail in the unit; motorized vs.
   general is then split client-side based on the atv/motorcycle/
   ohv_gt_50 fields, since ArcGIS SQL string matching (exact casing,
   e.g. 'yes' vs 'Yes') isn't something we could confirm without a live
   sample of the actual values — matching a range of common truthy
   spellings client-side is safer than guessing a WHERE clause. */
let roadsOHVRequestToken = 0;

function isTrailFieldTruthy(value) {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "no" && v !== "n" && v !== "false" && v !== "0";
}

function isOHVFeature(props) {
  return isTrailFieldTruthy(props.atv) ||
    isTrailFieldTruthy(props.motorcycle) ||
    isTrailFieldTruthy(props.ohv_gt_50) ||
    isTrailFieldTruthy(props.highway_ve);
}

function trailPopupHTML(props) {
  const uses = ["hiking", "horse", "bike", "atv", "motorcycle", "ohv_gt_50"]
    .filter(k => isTrailFieldTruthy(props[k]))
    .map(k => ({ hiking: "Hiking", horse: "Horse", bike: "Bike", atv: "ATV", motorcycle: "Motorcycle", ohv_gt_50: "OHV >50\"" }[k]));
  return `
    <strong>Trail${props.name ? ": " + props.name : ""}</strong><br>
    Surface: ${props.surface || "Unknown"}<br>
    Manager: ${props.manager || "Unknown"}<br>
    Uses: ${uses.length > 0 ? uses.join(", ") : "Not specified"}
  `;
}

function ohvPopupHTML(props) {
  const vehicles = ["atv", "motorcycle", "ohv_gt_50", "highway_ve"]
    .filter(k => isTrailFieldTruthy(props[k]))
    .map(k => ({ atv: "ATV", motorcycle: "Motorcycle", ohv_gt_50: "OHV >50\"", highway_ve: "Highway Vehicle" }[k]));
  return `
    <strong>OHV Trail${props.name ? ": " + props.name : ""}</strong><br>
    Legal for: ${vehicles.length > 0 ? vehicles.join(", ") : "See raw data"}<br>
    Manager: ${props.manager || "Unknown"}
  `;
}

function buildTrailsLayer(fc) {
  return L.geoJSON(fc, {
    style: () => ({ color: "#8A5A12", weight: 1.5, opacity: 0.8, dashArray: "3,3" }),
    onEachFeature: (feature, layer) => layer.bindPopup(trailPopupHTML(feature.properties))
  });
}

function buildOHVLayer(fc) {
  return L.geoJSON(fc, {
    style: () => ({ color: "#E76F51", weight: 2, opacity: 0.9 }),
    onEachFeature: (feature, layer) => layer.bindPopup(ohvPopupHTML(feature.properties))
  });
}

function removeRoadsOHVLayers() {
  if (roadsLayer) map.removeLayer(roadsLayer);
  if (ohvLayer) map.removeLayer(ohvLayer);
  roadsLayer = null;
  ohvLayer = null;
}

async function refreshRoadsOHVLayers() {
  removeRoadsOHVLayers();
  if (!selectedLayer) return;
  if (!roadsToggle.checked && !ohvToggle.checked) return;
  const token = ++roadsOHVRequestToken;
  const boundaryLayer = selectedLayer;
  let fc;
  try {
    fc = await queryWithinUnit(cotrexTrailsURL, "1=1", boundaryLayer);
  } catch (error) {
    console.error("COTREX trails query failed:", error);
    return;
  }
  if (token !== roadsOHVRequestToken) return;
  if (roadsToggle.checked) {
    roadsLayer = buildTrailsLayer(fc).addTo(map);
  }
  if (ohvToggle.checked) {
    const ohvFeatures = fc.features.filter(f => isOHVFeature(f.properties));
    ohvLayer = buildOHVLayer({ type: "FeatureCollection", features: ohvFeatures }).addTo(map);
  }
  if (gmuLayer) gmuLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
}

/*
  selectUnit — fixed version.
  Border/edge GMUs (units whose polygon is clipped by the state line, or
  units with an irregular, non-compact shape) don't need a two-step
  flyTo -> setTimeout -> fitBounds hack. flyToBounds already fits the
  viewport to the *actual* geometry bounds in one smooth animated call,
  so oddly-shaped or edge-of-state units center correctly without any
  race condition. We also clamp maxZoom so tiny/sliver units don't
  zoom in absurdly far, and pad using pixel padding so it works
  consistently on both mobile and desktop viewport sizes.
*/
function selectUnit(unitNumber) {
  if (!unitNumber || !unitLayers[unitNumber]) return;
  if (selectedLayer) {
    gmuLayer.resetStyle(selectedLayer);
  }
  selectedUnit = unitNumber;
  selectedLayer = unitLayers[unitNumber];
  selectedLayer.setStyle(selectedStyle());
  selectedLayer.bringToFront();
  const bounds = selectedLayer.getBounds();
  // Smaller padding on narrow (mobile) viewports so small units
  // don't get zoomed out too far just to clear the sidebar.
  const isNarrow = window.innerWidth < 640;
  const pad = isNarrow ? [40, 40] : [80, 80];
  map.flyToBounds(bounds, {
    paddingTopLeft: pad,
    paddingBottomRight: pad,
    maxZoom: 11,
    duration: 1.2
  });
  enableLandFilters();
  enableTerrainControls();
  document.querySelector('input[name="terrainMode"][value="none"]').checked = true;
  if (terrainOverlay) { map.removeLayer(terrainOverlay); terrainOverlay = null; }
  refreshLandLayers();
  refreshWaterLayers();
  refreshWildlifeLayers();
  refreshRoadsOHVLayers();
  leftInfoPanelBody.innerHTML = `
    <strong>GMU ${unitNumber}</strong>
    Use the sidebar to explore terrain, land ownership, water, and wildlife layers for this unit.
  `;
  leftInfoPanel.style.display = "block";
}

blmToggle.addEventListener("change", refreshLandLayers);
forestToggle.addEventListener("change", refreshLandLayers);
privateToggle.addEventListener("change", refreshLandLayers);
streamsToggle.addEventListener("change", refreshWaterLayers);
lakesToggle.addEventListener("change", refreshWaterLayers);
springsToggle.addEventListener("change", refreshWaterLayers);
migrationToggle.addEventListener("change", refreshWildlifeLayers);
winterRangeToggle.addEventListener("change", refreshWildlifeLayers);
summerRangeToggle.addEventListener("change", refreshWildlifeLayers);
residentToggle.addEventListener("change", refreshWildlifeLayers);
roadsToggle.addEventListener("change", refreshRoadsOHVLayers);
ohvToggle.addEventListener("change", refreshRoadsOHVLayers);

fetch(gmuURL)
  .then(response => response.json())
  .then(data => {
    unitSelect.innerHTML = `<option value="">Choose a unit...</option>`;
    gmuLayer = L.geoJSON(data, {
      style: defaultStyle,
      onEachFeature: function(feature, layer) {
        const unit = String(getUnitNumber(feature.properties));
        unitLayers[unit] = layer;
        layer.bindTooltip(unit, {
          permanent: true,
          direction: "center",
          className: "unit-label"
        });
        layer.on("click", function() {
          if (pinModeActive) return; // let the map's click handler place the pin instead
          if (appMode === "plan") {
            showUnitDrawDetail(unit);
            return;
          }
          unitSelect.value = unit;
          selectUnit(unit);
        });
      }
    }).addTo(map);
    Object.keys(unitLayers)
      .sort((a, b) => Number(a) - Number(b))
      .forEach(unit => {
        const option = document.createElement("option");
        option.value = unit;
        option.textContent = `Unit ${unit}`;
        unitSelect.appendChild(option);
      });
    if (appMode === "plan") renderPlanDashboard();
  })
  .catch(error => console.error("Error loading GMU data:", error));

unitSelect.addEventListener("change", function() {
  selectUnit(this.value);
});

document.getElementById("resetBtn").addEventListener("click", function() {
  if (selectedLayer) {
    gmuLayer.resetStyle(selectedLayer);
  }
  selectedLayer = null;
  selectedUnit = null;
  unitSelect.value = "";
  disableLandFilters();
  disableTerrainControls();
  map.fitBounds(coloradoBounds);
  map.closePopup();
  leftInfoPanel.style.display = "none";
});

/* DEM elevation click sample */
const DEM_ZOOM = 12;
const DEM_TILE_SIZE = 256;
const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

function lonLatToPixelInTile(lon, lat, zoom) {
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  const xFloat = (lon + 180) / 360 * n;
  const yFloat =
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return {
    tileX: Math.floor(xFloat),
    tileY: Math.floor(yFloat),
    pixelX: Math.floor((xFloat - Math.floor(xFloat)) * DEM_TILE_SIZE),
    pixelY: Math.floor((yFloat - Math.floor(yFloat)) * DEM_TILE_SIZE)
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* ============================================================
   Pins — user-dropped markers, color-selectable, saved to
   localStorage so they survive a page reload.
   ============================================================ */
const PIN_COLORS = {
  red: "#C0392B",
  blue: "#2C7DA0",
  green: "#2D6A4F",
  amber: "#D9A441",
  purple: "#6A4C93"
};
const PIN_STORAGE_KEY = "scoutiq_pins_v1";
let selectedPinColor = "red";
let pinModeActive = false;
let pins = [];
const pinMarkers = {};

function loadPins() {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Could not load saved pins:", e);
    return [];
  }
}

function savePins() {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
  } catch (e) {
    console.error("Could not save pins:", e);
  }
}

function createPinIcon(hex) {
  const svg = `
    <svg width="26" height="35" viewBox="0 0 26 35" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 22 13 22s13-12.3 13-22C26 5.8 20.2 0 13 0z" fill="${hex}" stroke="#1B4332" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="4.5" fill="white"/>
    </svg>`;
  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [26, 35],
    iconAnchor: [13, 35],
    popupAnchor: [0, -32]
  });
}

function pinPopupHTML(pin) {
  const safeLabel = (pin.label || "").replace(/"/g, "&quot;");
  return `
    <div style="min-width:180px;">
      <input type="text" id="pinLabelInput-${pin.id}" value="${safeLabel}"
        placeholder="Label this spot..."
        style="width:100%;padding:5px 7px;margin-bottom:6px;border:1px solid #B7E4C7;border-radius:6px;box-sizing:border-box;">
      <div style="display:flex;gap:6px;">
        <button onclick="window.scoutiqSavePinLabel('${pin.id}')"
          style="flex:1;background:#2D6A4F;color:white;border:none;border-radius:6px;padding:6px;cursor:pointer;font-weight:bold;">Save</button>
        <button onclick="window.scoutiqDeletePin('${pin.id}')"
          style="flex:1;background:#C0392B;color:white;border:none;border-radius:6px;padding:6px;cursor:pointer;font-weight:bold;">Delete</button>
      </div>
    </div>
  `;
}

function addPinMarker(pin) {
  const marker = L.marker([pin.lat, pin.lng], {
    icon: createPinIcon(PIN_COLORS[pin.color] || PIN_COLORS.red),
    pane: "pinsPane",
    draggable: true
  });
  marker.bindPopup(pinPopupHTML(pin));
  marker.on("dragend", function (e) {
    const ll = e.target.getLatLng();
    pin.lat = ll.lat;
    pin.lng = ll.lng;
    savePins();
  });
  marker.addTo(map);
  pinMarkers[pin.id] = marker;
}

function addPin(lat, lng) {
  const id = "pin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  const pin = { id, lat, lng, color: selectedPinColor, label: "" };
  pins.push(pin);
  savePins();
  addPinMarker(pin);
  pinMarkers[id].openPopup();
}

window.scoutiqSavePinLabel = function (id) {
  const input = document.getElementById(`pinLabelInput-${id}`);
  const pin = pins.find(p => p.id === id);
  if (pin && input) {
    pin.label = input.value;
    savePins();
    pinMarkers[id].closePopup();
  }
};

window.scoutiqDeletePin = function (id) {
  if (pinMarkers[id]) { map.removeLayer(pinMarkers[id]); delete pinMarkers[id]; }
  pins = pins.filter(p => p.id !== id);
  savePins();
};

pins = loadPins();
pins.forEach(addPinMarker);

document.querySelectorAll('input[name="pinColor"]').forEach(radio => {
  radio.addEventListener("change", function () {
    selectedPinColor = this.value;
    document.querySelectorAll(".pinColorSwatch").forEach(el => el.classList.remove("selected"));
    this.closest(".pinColorSwatch").classList.add("selected");
  });
});

const dropPinBtn = document.getElementById("dropPinBtn");

function exitPinMode() {
  pinModeActive = false;
  dropPinBtn.classList.remove("active");
  dropPinBtn.textContent = "Drop Pin";
  map.getContainer().style.cursor = "";
}

dropPinBtn.addEventListener("click", function () {
  pinModeActive = !pinModeActive;
  dropPinBtn.classList.toggle("active", pinModeActive);
  dropPinBtn.textContent = pinModeActive ? "Click Map to Place" : "Drop Pin";
  map.getContainer().style.cursor = pinModeActive ? "crosshair" : "";
});

document.getElementById("clearPinsBtn").addEventListener("click", function () {
  if (pins.length === 0) return;
  if (!confirm("Delete all pins? This can't be undone.")) return;
  Object.values(pinMarkers).forEach(m => map.removeLayer(m));
  for (const k in pinMarkers) delete pinMarkers[k];
  pins = [];
  savePins();
});

/* ============================================================
   My Location — live device position via the browser's
   Geolocation API, with a pulsing "you are here" dot and
   accuracy circle. Off by default (requires explicit opt-in
   since it triggers a browser permission prompt).
   ============================================================ */
let locationWatchId = null;
let userLocationMarker = null;
let userAccuracyCircle = null;
let hasCenteredOnLocation = false;

function createUserLocationIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="userLocationDot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function onLocationUpdate(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const latlng = [latitude, longitude];
  if (!userLocationMarker) {
    userLocationMarker = L.marker(latlng, {
      icon: createUserLocationIcon(),
      pane: "locationPane",
      interactive: false
    }).addTo(map);
    userAccuracyCircle = L.circle(latlng, {
      radius: accuracy,
      pane: "locationPane",
      color: "#2C7DA0",
      fillColor: "#2C7DA0",
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);
  } else {
    userLocationMarker.setLatLng(latlng);
    userAccuracyCircle.setLatLng(latlng);
    userAccuracyCircle.setRadius(accuracy);
  }
  // Center only on the first fix, so the person can freely pan/zoom
  // afterward without the map yanking back to their position.
  if (!hasCenteredOnLocation) {
    hasCenteredOnLocation = true;
    map.setView(latlng, Math.max(map.getZoom(), 13));
  }
}

function onLocationError(err) {
  statusBox.textContent = `Location error: ${err.message}`;
  stopLocationWatch();
  locateBtn.classList.remove("active");
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    statusBox.textContent = "Geolocation is not supported by this browser.";
    return;
  }
  hasCenteredOnLocation = false;
  locationWatchId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  });
}

function stopLocationWatch() {
  if (locationWatchId != null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  if (userLocationMarker) { map.removeLayer(userLocationMarker); userLocationMarker = null; }
  if (userAccuracyCircle) { map.removeLayer(userAccuracyCircle); userAccuracyCircle = null; }
}

const locateBtn = document.getElementById("locateBtn");
locateBtn.addEventListener("click", function () {
  const active = locateBtn.classList.toggle("active");
  if (active) {
    startLocationWatch();
  } else {
    stopLocationWatch();
  }
});

async function getElevationMeters(lat, lon) {
  const pos = lonLatToPixelInTile(lon, lat, DEM_ZOOM);
  const url = DEM_URL
    .replace("{z}", DEM_ZOOM)
    .replace("{x}", pos.tileX)
    .replace("{y}", pos.tileY);
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = DEM_TILE_SIZE;
  canvas.height = DEM_TILE_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pixel = ctx.getImageData(pos.pixelX, pos.pixelY, 1, 1).data;
  const meters = (pixel[0] * 256 + pixel[1] + pixel[2] / 256) - 32768;
  const feet = meters * 3.28084;
  return { meters, feet };
}

map.on("click", async function(e) {
  if (pinModeActive) {
    addPin(e.latlng.lat, e.latlng.lng);
    exitPinMode();
    return;
  }
  try {
    const elevation = await getElevationMeters(e.latlng.lat, e.latlng.lng);
    L.popup()
      .setLatLng(e.latlng)
      .setContent(`
        <strong>ScoutIQ Terrain Sample</strong><br>
        Elevation: ${Math.round(elevation.feet).toLocaleString()} ft<br>
        ${Math.round(elevation.meters).toLocaleString()} m
      `)
      .openOn(map);
  } catch {
    L.popup()
      .setLatLng(e.latlng)
      .setContent("Elevation data could not be loaded here.")
      .openOn(map);
  }
});

/* ============================================================
   PHASE 2 — Terrain grid, slope, and aspect
   ============================================================ */
// Grid resolution is now tied to a real-world target cell size rather than a
// fixed column count. A fixed column count meant cell size scaled with unit
// size — on a large unit, cells could exceed 750m, which silently collapsed
// the "small" (150m) and "large" (750m) TPI windows into the same 1-cell
// radius, making Benches & Draws and Basins & Ridgelines look identical.
// Tying resolution to an actual meter target keeps the two windows distinct
// regardless of unit size, with caps to bound compute cost on very large
// or very small units.
const TARGET_CELL_SIZE_M = 100;
const MIN_GRID_COLS = 30;
const MAX_GRID_COLS = 140;
const TPI_SMALL_RADIUS_M = 150; // bench/knob scale
const TPI_LARGE_RADIUS_M = 750; // drainage/basin scale

const terrainRadios = document.querySelectorAll(".terrainRadio");
let terrainOverlay = null;
const terrainGridCache = {}; // keyed by unit id, so switching units doesn't recompute

/* --- DEM tile caching (replaces per-click re-fetching) --- */
const tileImageCache = new Map(); // "tileX_tileY" -> Promise<ImageData>

function getTileImageData(tileX, tileY) {
  const key = `${tileX}_${tileY}`;
  if (tileImageCache.has(key)) return tileImageCache.get(key);
  const url = DEM_URL
    .replace("{z}", DEM_ZOOM)
    .replace("{x}", tileX)
    .replace("{y}", tileY);
  const promise = loadImage(url).then(img => {
    const canvas = document.createElement("canvas");
    canvas.width = DEM_TILE_SIZE;
    canvas.height = DEM_TILE_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, DEM_TILE_SIZE, DEM_TILE_SIZE);
  });
  tileImageCache.set(key, promise);
  return promise;
}

async function getElevationCached(lat, lon) {
  const pos = lonLatToPixelInTile(lon, lat, DEM_ZOOM);
  const imageData = await getTileImageData(pos.tileX, pos.tileY);
  const idx = (pos.pixelY * DEM_TILE_SIZE + pos.pixelX) * 4;
  const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
  return (r * 256 + g + b / 256) - 32768; // meters
}

/* --- Point-in-polygon test against a Leaflet layer (handles holes + multipolygons) --- */
function ringDepth(a) {
  return Array.isArray(a) ? 1 + ringDepth(a[0]) : 0;
}

function normalizeToPolygons(latlngs) {
  const depth = ringDepth(latlngs);
  if (depth === 1) return [[latlngs]];       // single ring
  if (depth === 2) return [latlngs];         // rings with holes
  return latlngs;                            // multipolygon
}

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng;
    const yj = ring[j].lat, xj = ring[j].lng;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInLayer(lat, lng, layer) {
  const polygons = normalizeToPolygons(layer.getLatLngs());
  for (const poly of polygons) {
    if (!pointInRing(lat, lng, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lat, lng, poly[h])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

/* --- Build elevation grid over the selected unit --- */
async function buildElevationGrid(layer) {
  const bounds = layer.getBounds();
  const south = bounds.getSouth(), north = bounds.getNorth();
  const west = bounds.getWest(), east = bounds.getEast();
  const centerLat = (south + north) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  const widthMeters = (east - west) * metersPerDegLon;
  const heightMeters = (north - south) * metersPerDegLat;
  let cols = Math.round(widthMeters / TARGET_CELL_SIZE_M);
  cols = Math.max(MIN_GRID_COLS, Math.min(MAX_GRID_COLS, cols));
  const cellSizeMeters = widthMeters / cols;
  let rows = Math.max(2, Math.round(heightMeters / cellSizeMeters));
  rows = Math.min(MAX_GRID_COLS, rows); // cap total cell count on very tall/narrow units
  const lngStep = (east - west) / cols;
  const latStep = (north - south) / rows;
  const grid = [];
  const fetches = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const lat = north - (r + 0.5) * latStep;
      const lng = west + (c + 0.5) * lngStep;
      const inside = isPointInLayer(lat, lng, layer);
      const cell = { lat, lng, inside, elev: null, slope: null, aspect: null };
      grid[r][c] = cell;
      if (inside) {
        fetches.push(getElevationCached(lat, lng).then(e => { cell.elev = e; }));
      }
    }
  }
  await Promise.all(fetches);
  return { grid, rows, cols, bounds: { south, north, west, east } };
}

/* --- Slope + aspect via Horn's method (standard 3x3-kernel GIS approach) --- */
function computeSlopeAspect(gridData) {
  const { grid, rows, cols, bounds } = gridData;
  const centerLat = (bounds.north + bounds.south) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  const latStep = (bounds.north - bounds.south) / rows;
  const lngStep = (bounds.east - bounds.west) / cols;
  const cellSizeX = lngStep * metersPerDegLon;
  const cellSizeY = latStep * metersPerDegLat;
  function elevAt(r, c, fallback) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return fallback;
    const cell = grid[r][c];
    return (cell.inside && cell.elev != null) ? cell.elev : fallback;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.inside || cell.elev == null) continue;
      const e = cell.elev;
      const a = elevAt(r - 1, c - 1, e), b = elevAt(r - 1, c, e), cc = elevAt(r - 1, c + 1, e);
      const d = elevAt(r, c - 1, e), f = elevAt(r, c + 1, e);
      const g = elevAt(r + 1, c - 1, e), h = elevAt(r + 1, c, e), i = elevAt(r + 1, c + 1, e);
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cellSizeX);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * cellSizeY);
      cell.slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
      let aspectDeg = Math.atan2(dzdy, -dzdx) * 180 / Math.PI;
      if (aspectDeg < 0) aspectDeg = 90 - aspectDeg;
      else if (aspectDeg > 90) aspectDeg = 360 - aspectDeg + 90;
      else aspectDeg = 90 - aspectDeg;
      cell.aspect = aspectDeg; // compass degrees, 0/360 = N, 90 = E, 180 = S, 270 = W
    }
  }
}

/* --- Shared cell-size helper (meters per grid cell, used by TPI/curvature) --- */
function getCellSizeMeters(gridData) {
  const { rows, cols, bounds } = gridData;
  const centerLat = (bounds.north + bounds.south) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
  const latStep = (bounds.north - bounds.south) / rows;
  const lngStep = (bounds.east - bounds.west) / cols;
  const cellSizeX = lngStep * metersPerDegLon;
  const cellSizeY = latStep * metersPerDegLat;
  return { cellSizeX, cellSizeY, cellSizeAvg: (cellSizeX + cellSizeY) / 2 };
}

/* Computes small/large TPI window radii (in grid cells) together, so the
   large window is always at least 2 cells wider than the small one — even
   on very large units where cell size alone might round both down to the
   same 1-cell window and make the two layers look identical. */
function getTPIRadiiCells(gridData) {
  const { cellSizeAvg } = getCellSizeMeters(gridData);
  const small = Math.max(1, Math.round(TPI_SMALL_RADIUS_M / cellSizeAvg));
  const large = Math.max(small + 2, Math.round(TPI_LARGE_RADIUS_M / cellSizeAvg));
  return { small, large };
}

/* --- TPI (Terrain Position Index) ---
   Positive = sits above its surroundings (ridge, knob, bench).
   Negative = sits below its surroundings (drainage, basin, bowl).
   radiusCells controls how far out "surroundings" reaches. */
function computeTPI(gridData, radiusCells, key) {
  const { grid, rows, cols } = gridData;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.inside || cell.elev == null) { cell[key] = null; continue; }
      let sum = 0, count = 0;
      for (let dr = -radiusCells; dr <= radiusCells; dr++) {
        for (let dc = -radiusCells; dc <= radiusCells; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const n = grid[rr][cc];
          if (n.inside && n.elev != null) { sum += n.elev; count++; }
        }
      }
      cell[key] = count >= 3 ? cell.elev - (sum / count) : null;
    }
  }
}

/* --- Curvature (discrete Laplacian) ---
   Positive = convex (ridge/knob, sheds water/game).
   Negative = concave (bowl/drainage, collects water and moisture). */
function computeCurvature(gridData) {
  const { grid, rows, cols } = gridData;
  const { cellSizeX, cellSizeY } = getCellSizeMeters(gridData);
  const cellSize = (cellSizeX + cellSizeY) / 2;
  function elevAt(r, c, fallback) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return fallback;
    const cell = grid[r][c];
    return (cell.inside && cell.elev != null) ? cell.elev : fallback;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.inside || cell.elev == null) { cell.curvature = null; continue; }
      const zC = cell.elev;
      const zN = elevAt(r - 1, c, zC);
      const zS = elevAt(r + 1, c, zC);
      const zE = elevAt(r, c + 1, zC);
      const zW = elevAt(r, c - 1, zC);
      cell.curvature = (4 * zC - (zN + zS + zE + zW)) / (cellSize * cellSize);
    }
  }
}

const FIELD_KEY_MAP = { tpi_small: "tpiSmall", tpi_large: "tpiLarge", curvature: "curvature" };
const DIVERGING_NEG = "#1B4332";  // below-average surroundings (valley/bowl)
const DIVERGING_ZERO = "#F8F7F3"; // average / flat
const DIVERGING_POS = "#D9A441";  // above-average surroundings (ridge/knob)

function divergingColor(value, maxAbs, negColor, zeroColor, posColor) {
  if (value == null || !maxAbs) return "transparent";
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  return t < 0 ? lerpColor(zeroColor, negColor, -t) : lerpColor(zeroColor, posColor, t);
}

function lerpColor(hex1, hex2, t) {
  const c1 = parseInt(hex1.slice(1), 16), c2 = parseInt(hex2.slice(1), 16);
  const r = Math.round(((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t);
  const g = Math.round(((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t);
  const b = Math.round((c1 & 255) + ((c2 & 255) - (c1 & 255)) * t);
  return `rgb(${r},${g},${b})`;
}

function elevationColor(elev, min, max) {
  const t = max > min ? (elev - min) / (max - min) : 0;
  if (t < 0.4) return lerpColor("#1B4332", "#74C69D", t / 0.4);
  if (t < 0.75) return lerpColor("#74C69D", "#D9A441", (t - 0.4) / 0.35);
  return lerpColor("#D9A441", "#F8F7F3", (t - 0.75) / 0.25);
}

function slopeColor(deg) {
  if (deg == null) return "transparent";
  if (deg < 15) return lerpColor("#2D6A4F", "#D9A441", deg / 15);
  if (deg < 30) return lerpColor("#D9A441", "#C0392B", (deg - 15) / 15);
  return lerpColor("#C0392B", "#5C1A12", Math.min(1, (deg - 30) / 20));
}

function aspectColor(deg) {
  if (deg == null) return "transparent";
  return `hsl(${deg}, 65%, 50%)`; // compass hue wheel: color itself encodes direction
}

function scoutiqColor(score, min, max) {
  if (score == null || max <= min) return "transparent";
  const t = (score - min) / (max - min);
  if (t < 0.5) return lerpColor("#F8F7F3", "#E9C46A", t / 0.5);
  return lerpColor("#E9C46A", "#7B2D26", (t - 0.5) / 0.5);
}

/* ============================================================
   ScoutIQ Score — composite seasonal heat map
   Combines terrain already in the grid (aspect, elevation) with
   distance to water and distance to the selected species' migration
   corridor, weighted per season via SEASON_PROFILES.
   ============================================================ */
function pointToSegmentDistanceMeters(lat, lng, latA, lngA, latB, lngB) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  const px = (lng - lngA) * metersPerDegLon, py = (lat - latA) * metersPerDegLat;
  const dx = (lngB - lngA) * metersPerDegLon, dy = (latB - latA) * metersPerDegLat;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? (px * dx + py * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const ddx = px - t * dx, ddy = py - t * dy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function pointDistanceMeters(lat1, lng1, lat2, lng2) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(lat1 * Math.PI / 180);
  const dy = (lat2 - lat1) * metersPerDegLat, dx = (lng2 - lng1) * metersPerDegLon;
  return Math.sqrt(dx * dx + dy * dy);
}

function minDistToLineOrRing(lat, lng, coords, closed) {
  let min = Infinity;
  const n = coords.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = coords[i], b = coords[(i + 1) % n];
    const d = pointToSegmentDistanceMeters(lat, lng, a[1], a[0], b[1], b[0]);
    if (d < min) min = d;
  }
  return min;
}

function pointInGeoJSONRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeoJSONPolygon(lat, lng, rings) {
  if (!pointInGeoJSONRing(lat, lng, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInGeoJSONRing(lat, lng, rings[h])) return false; // inside a hole
  }
  return true;
}

// Distance in meters from a point to a single geometry. Points strictly
// inside a polygon (e.g. standing inside a lake or migration corridor)
// return 0 rather than distance-to-boundary, which would otherwise
// overstate distance for large polygons on a coarse grid.
function distanceToGeometry(lat, lng, geom) {
  if (geom.type === "Polygon") {
    if (pointInGeoJSONPolygon(lat, lng, geom.coordinates)) return 0;
    let min = Infinity;
    geom.coordinates.forEach(ring => { min = Math.min(min, minDistToLineOrRing(lat, lng, ring, true)); });
    return min;
  }
  if (geom.type === "MultiPolygon") {
    let min = Infinity;
    for (const poly of geom.coordinates) {
      if (pointInGeoJSONPolygon(lat, lng, poly)) return 0;
      poly.forEach(ring => { min = Math.min(min, minDistToLineOrRing(lat, lng, ring, true)); });
    }
    return min;
  }
  if (geom.type === "LineString") return minDistToLineOrRing(lat, lng, geom.coordinates, false);
  if (geom.type === "MultiLineString") {
    let min = Infinity;
    geom.coordinates.forEach(line => { min = Math.min(min, minDistToLineOrRing(lat, lng, line, false)); });
    return min;
  }
  if (geom.type === "Point") return pointDistanceMeters(lat, lng, geom.coordinates[1], geom.coordinates[0]);
  if (geom.type === "MultiPoint") {
    let min = Infinity;
    geom.coordinates.forEach(([lng2, lat2]) => { min = Math.min(min, pointDistanceMeters(lat, lng, lat2, lng2)); });
    return min;
  }
  return Infinity;
}

function getGeometryBBox(geom) {
  if (!geom || !geom.coordinates) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  function visit(coords, depth) {
    if (depth === 0) {
      const lng = coords[0], lat = coords[1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    } else {
      coords.forEach(c => visit(c, depth - 1));
    }
  }
  const depthByType = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  const depth = depthByType[geom.type];
  if (depth === undefined) return null;
  visit(geom.coordinates, depth);
  return isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : null;
}

function buildFeatureIndex(featureCollection) {
  const entries = [];
  for (const f of featureCollection.features) {
    if (!f.geometry) continue;
    const bbox = getGeometryBBox(f.geometry);
    if (bbox) entries.push({ geometry: f.geometry, bbox });
  }
  return entries;
}

// Distance to the nearest indexed feature, using each feature's
// bounding box (expanded by cutoffMeters) to skip exact segment math
// for anything obviously too far away to matter. Without this,
// checking every grid cell (up to ~19,600 of them) against every
// vertex of every stream/corridor in a unit is slow enough to hang
// the browser on units with a dense stream network — this is what was
// causing the "crash." Since scores use exponential decay, anything
// past a few decay-constants out contributes ~0 anyway, so an
// approximate cutoff costs no real accuracy.
function minDistanceToFeatureIndex(lat, lng, index, cutoffMeters) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(lat * Math.PI / 180) || 1;
  const latPad = cutoffMeters / metersPerDegLat;
  const lngPad = cutoffMeters / metersPerDegLon;
  let min = Infinity;
  for (const entry of index) {
    const b = entry.bbox;
    if (lat < b.minLat - latPad || lat > b.maxLat + latPad ||
        lng < b.minLng - lngPad || lng > b.maxLng + lngPad) continue;
    const d = distanceToGeometry(lat, lng, entry.geometry);
    if (d < min) min = d;
    if (min === 0) break;
  }
  return min;
}

// Fetches water/migration geometry (padded around the unit, same as the
// map toggles) once per unit and caches per-cell distances on the grid.
// These don't depend on season — only the weighting in
// computeScoutIQScore does — so switching seasons re-scores instantly
// without any new network requests.
async function ensureWaterProximity(gridData, boundaryLayer) {
  if (gridData.waterProximityComputed) return;
  const empty = { type: "FeatureCollection", features: [] };
  const [streamsFC, lakesFC, springsFC] = await Promise.all([
    queryNearUnit(`${waterURL}/6`, "ftype = 460", boundaryLayer, 0.3).catch(() => empty),
    queryNearUnit(`${waterURL}/12`, "FTYPE IN (390, 436)", boundaryLayer, 0.3).catch(() => empty),
    queryNearUnit(`${waterURL}/0`, "FTYPE = 458", boundaryLayer, 0.3).catch(() => empty)
  ]);
  const combined = { type: "FeatureCollection", features: [...streamsFC.features, ...lakesFC.features, ...springsFC.features] };
  const index = buildFeatureIndex(combined);
  gridData.grid.forEach(row => row.forEach(cell => {
    cell.waterDistance = (cell.inside && cell.elev != null)
      ? minDistanceToFeatureIndex(cell.lat, cell.lng, index, 2000) // ~5x the 400m decay constant
      : null;
  }));
  gridData.waterProximityComputed = true;
}

async function ensureMigrationProximity(gridData, boundaryLayer) {
  if (gridData.migrationProximityComputed && gridData.migrationSpeciesUsed === WILDLIFE_SPECIES) return;
  const layers = WILDLIFE_LAYERS[WILDLIFE_SPECIES];
  const empty = { type: "FeatureCollection", features: [] };
  const fc = layers
    ? await queryNearUnit(`${wildlifeURL}/${layers.migration}`, "1=1", boundaryLayer, 0.5).catch(() => empty)
    : empty;
  const index = buildFeatureIndex(fc);
  gridData.grid.forEach(row => row.forEach(cell => {
    cell.migrationDistance = (cell.inside && cell.elev != null)
      ? minDistanceToFeatureIndex(cell.lat, cell.lng, index, 3000) // ~5x the 600m decay constant
      : null;
  }));
  gridData.migrationProximityComputed = true;
  gridData.migrationSpeciesUsed = WILDLIFE_SPECIES;
}

function computeScoutIQScore(gridData, profile) {
  const { grid, rows, cols } = gridData;
  let minElev = Infinity, maxElev = -Infinity;
  grid.forEach(row => row.forEach(cell => {
    if (cell.inside && cell.elev != null) {
      minElev = Math.min(minElev, cell.elev);
      maxElev = Math.max(maxElev, cell.elev);
    }
  }));
  const elevRange = (maxElev - minElev) || 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.inside || cell.elev == null) { cell.scoutiqScore = null; continue; }
      const elevPct = (cell.elev - minElev) / elevRange;
      const elevationScore = profile.elevationPreference === "high" ? elevPct
        : profile.elevationPreference === "low" ? (1 - elevPct)
        : 0.5;
      // North/south aspect preference, damped toward neutral on
      // near-flat ground where aspect is directionally meaningless.
      let aspectScore = 0.5;
      if (cell.aspect != null && cell.slope != null) {
        const northness = (Math.cos(cell.aspect * Math.PI / 180) + 1) / 2;
        const raw = profile.aspectPreference === "north" ? northness
          : profile.aspectPreference === "south" ? (1 - northness)
          : 0.5;
        const slopeDamping = Math.max(0, Math.min(1, cell.slope / 10));
        aspectScore = 0.5 + (raw - 0.5) * slopeDamping;
      }
      const waterScore = cell.waterDistance != null ? Math.exp(-cell.waterDistance / 400) : 0;
      const migrationScore = cell.migrationDistance != null ? Math.exp(-cell.migrationDistance / 600) : 0;
      const w = profile.weights;
      cell.scoutiqScore =
        w.elevation * elevationScore +
        w.northness * aspectScore +
        w.water * waterScore +
        w.migration * migrationScore;
    }
  }
}

/* --- Render grid to a clipped raster overlay --- */
function renderTerrainCanvas(gridData, mode) {
  const { grid, rows, cols } = gridData;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  let minV = Infinity, maxV = -Infinity, maxAbs = 0;
  const fieldKey = FIELD_KEY_MAP[mode];
  if (mode === "elevation" || mode === "scoutiq_score") {
    const field = mode === "elevation" ? "elev" : "scoutiqScore";
    grid.forEach(row => row.forEach(cell => {
      if (cell.inside && cell[field] != null) {
        minV = Math.min(minV, cell[field]);
        maxV = Math.max(maxV, cell[field]);
      }
    }));
  } else if (fieldKey) {
    grid.forEach(row => row.forEach(cell => {
      if (cell.inside && cell[fieldKey] != null) {
        maxAbs = Math.max(maxAbs, Math.abs(cell[fieldKey]));
      }
    }));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell.inside || cell.elev == null) { ctx.clearRect(c, r, 1, 1); continue; }
      let color;
      if (mode === "elevation") color = elevationColor(cell.elev, minV, maxV);
      else if (mode === "slope") color = slopeColor(cell.slope);
      else if (mode === "aspect") color = aspectColor(cell.aspect);
      else if (mode === "scoutiq_score") color = scoutiqColor(cell.scoutiqScore, minV, maxV);
      else if (fieldKey) color = divergingColor(cell[fieldKey], maxAbs, DIVERGING_NEG, DIVERGING_ZERO, DIVERGING_POS);
      ctx.fillStyle = color;
      ctx.fillRect(c, r, 1, 1);
    }
  }
  return canvas.toDataURL();
}

let terrainRequestToken = 0;

async function showTerrainLayer(mode) {
  const token = ++terrainRequestToken;
  if (terrainOverlay) { map.removeLayer(terrainOverlay); terrainOverlay = null; }
  if (mode === "none" || !selectedLayer) return;
  statusBox.textContent = "Computing terrain grid...";
  const boundaryLayer = selectedLayer;
  const unitAtRequest = selectedUnit;
  let gridData = terrainGridCache[unitAtRequest];
  if (!gridData) {
    gridData = await buildElevationGrid(boundaryLayer);
    if (token !== terrainRequestToken) return; // superseded by a newer mode/unit change
    computeSlopeAspect(gridData);
    terrainGridCache[unitAtRequest] = gridData;
  }
  if (mode === "tpi_small" && !gridData.tpiSmallComputed) {
    const { small } = getTPIRadiiCells(gridData);
    computeTPI(gridData, small, "tpiSmall");
    gridData.tpiSmallComputed = true;
  }
  if (mode === "tpi_large" && !gridData.tpiLargeComputed) {
    const { large } = getTPIRadiiCells(gridData);
    computeTPI(gridData, large, "tpiLarge");
    gridData.tpiLargeComputed = true;
  }
  if (mode === "curvature" && !gridData.curvatureComputed) {
    computeCurvature(gridData);
    gridData.curvatureComputed = true;
  }
  if (mode === "scoutiq_score") {
    if (!CURRENT_SEASON) {
      statusBox.textContent = "Select a season above to generate the ScoutIQ heat map.";
      if (terrainOverlay) { map.removeLayer(terrainOverlay); terrainOverlay = null; }
      return;
    }
    statusBox.textContent = "Computing ScoutIQ score (water + migration proximity)...";
    await ensureWaterProximity(gridData, boundaryLayer);
    if (token !== terrainRequestToken) return;
    await ensureMigrationProximity(gridData, boundaryLayer);
    if (token !== terrainRequestToken) return;
    computeScoutIQScore(gridData, SEASON_PROFILES[CURRENT_SEASON]);
  }
  if (token !== terrainRequestToken) return;
  const dataUrl = renderTerrainCanvas(gridData, mode);
  terrainOverlay = L.imageOverlay(dataUrl, selectedLayer.getBounds(), {
    opacity: 0.75,
    interactive: false,
    pane: "terrainPane"
  }).addTo(map);
  if (gmuLayer) gmuLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
  statusBox.textContent = `Unit ${selectedUnit} — showing ${mode}.`;
}

terrainRadios.forEach(radio => {
  radio.addEventListener("change", function () {
    if (this.checked) showTerrainLayer(this.value);
  });
});

function enableTerrainControls() {
  terrainRadios.forEach(r => r.disabled = false);
}

function disableTerrainControls() {
  terrainRadios.forEach(r => { r.disabled = true; r.checked = (r.value === "none"); });
  if (terrainOverlay) { map.removeLayer(terrainOverlay); terrainOverlay = null; }
}

/* ============================================================
   Info icons — explain what each color scale means
   ============================================================ */
const infoContent = {
  blm: {
    title: "BLM Land",
    desc: "Federally managed public land (Bureau of Land Management). Generally open to hunting access.",
    swatch: "#D9A441"
  },
  forest: {
    title: "National Forest",
    desc: "USFS-managed public land. Generally open to hunting access, though road and vehicle rules can differ from BLM.",
    swatch: "#2D6A4F"
  },
  private: {
    title: "Private Land",
    desc: "Privately owned. Access requires landowner permission unless otherwise posted.",
    swatch: "#F8F7F3"
  },
  streams: {
    title: "Streams & Rivers",
    desc: "Perennial, intermittent, and ephemeral streams and rivers from the USGS National Hydrography Dataset. Water and travel corridors, and often a good starting point for locating drainages.",
    swatch: "#2C7DA0"
  },
  lakes: {
    title: "Lakes & Ponds",
    desc: "Natural lakes/ponds and reservoirs from the USGS National Hydrography Dataset.",
    swatch: "#61A5C2"
  },
  springs: {
    title: "Springs",
    desc: "Mapped springs and seeps from the USGS National Hydrography Dataset. Reliable water sources, especially valuable late season or in dry country away from major streams.",
    swatch: "#40916C"
  },
  migration: {
    title: "Elk Migration Corridors",
    desc: "Routes elk travel between seasonal ranges. Data is expert-mapped by CPW wildlife managers and biologists, not live GPS tracking — treat as a reliable general pattern rather than an exact real-time path.",
    swatch: "#BC4B51"
  },
  winterRange: {
    title: "Elk Winter Range",
    desc: "Areas elk typically occupy in winter, generally lower elevation and south-facing where snow is shallower and forage stays accessible.",
    swatch: "#4A6FA5"
  },
  summerRange: {
    title: "Elk Summer Range",
    desc: "Areas elk typically occupy in summer, generally higher elevation with better forage and cooler temperatures.",
    swatch: "#E9C46A"
  },
  residentHerd: {
    title: "Elk Resident Herds",
    desc: "Areas where elk populations stay year-round rather than migrating seasonally — useful if you'd rather scout animals that won't move out of the unit.",
    swatch: "#7B2D26"
  },
  roads: {
    title: "Trails",
    desc: "Colorado's statewide trail inventory (COTREX), sourced from USFS, BLM, and local agencies — includes hiking, equestrian, bike, and motorized routes together. Useful for gauging general access and traffic near a spot.",
    swatch: "#8A5A12"
  },
  ohv: {
    title: "OHV / ATV Trails",
    desc: "The subset of COTREX trails flagged for ATV, motorcycle, or other OHV use. This is a best-effort match against the raw data's use-type fields — check a trail's popup to see its actual recorded uses if something looks off.",
    swatch: "#E76F51"
  },
  elevation: {
    title: "Elevation",
    desc: "Relative elevation across the selected unit, scaled from that unit's own low point to its high point (not a fixed statewide scale).",
    gradient: ["#1B4332", "#74C69D", "#D9A441", "#F8F7F3"],
    labels: ["Low", "", "", "High"]
  },
  slope: {
    title: "Slope",
    desc: "Steepness of terrain in degrees, calculated from the elevation grid.",
    gradient: ["#2D6A4F", "#D9A441", "#C0392B", "#5C1A12"],
    labels: ["0°", "15°", "30°", "45°+"]
  },
  aspect: {
    title: "Aspect",
    desc: "The compass direction a slope faces. Color encodes direction directly — useful for spotting north-facing (cooler, later snowmelt) vs. south-facing (earlier green-up) slopes.",
    compass: true
  },
  tpi_small: {
    title: "Benches & Draws",
    desc: "Local terrain shape within about 150m. Amber areas sit above their immediate surroundings — flat benches and finger ridges elk often bed on. Green areas sit below — small draws and drainage bottoms used as travel routes and cover.",
    diverging: true,
    labels: ["Draw", "Flat", "Bench"]
  },
  tpi_large: {
    title: "Basins & Ridgelines",
    desc: "Broader terrain shape within about 750m. Amber traces major ridgelines and divides — travel routes and glassing terrain. Green traces whole drainage basins — typically more sheltered, with better feed and water access.",
    diverging: true,
    labels: ["Basin", "Flat", "Ridgeline"]
  },
  curvature: {
    title: "Bowls & Knobs",
    desc: "Whether ground curves inward or bulges outward. Green bowls collect moisture and often hold better feed and cooler cover. Amber knobs shed water and tend to be firmer, more exposed — useful for glassing or as escape terrain.",
    diverging: true,
    labels: ["Bowl", "Flat", "Knob"]
  }
};

const infoPopover = document.getElementById("infoPopover");
let currentInfoKey = null;

function buildScoutIQPopoverContent() {
  if (!CURRENT_SEASON) {
    return `<strong>ScoutIQ Score</strong><span>Select a season from the dropdown at the top of the panel to generate a seasonal heat map combining terrain, water, and migration proximity.</span>`;
  }
  const profile = SEASON_PROFILES[CURRENT_SEASON];
  const w = profile.weights;
  let html = `<strong>ScoutIQ Score — ${profile.label}</strong><span>${profile.note}</span>`;
  html += `<div class="infoGradientBar" style="background:linear-gradient(to right, #F8F7F3, #E9C46A, #7B2D26);"></div>`;
  html += `<div class="infoGradientLabels"><span>Low</span><span>Medium</span><span>High</span></div>`;
  html += `<div style="margin-top:6px;font-size:11px;color:#666;">Weights: aspect ${Math.round(w.northness * 100)}%, elevation ${Math.round(w.elevation * 100)}%, water ${Math.round(w.water * 100)}%, migration ${Math.round(w.migration * 100)}%</div>`;
  if (!profile.userValidated) {
    html += `<div style="margin-top:6px;font-size:11px;color:#8A5A12;">Draft weighting — a starting point, not yet confirmed field logic for this season.</div>`;
  }
  return html;
}

function buildPopoverContent(key) {
  if (key === "scoutiq_score") return buildScoutIQPopoverContent();
  const info = infoContent[key];
  if (!info) return "";
  let html = `<strong>${info.title}</strong><span>${info.desc}</span>`;
  if (info.gradient) {
    const stops = info.gradient.join(",");
    html += `<div class="infoGradientBar" style="background:linear-gradient(to right, ${stops});"></div>`;
    html += `<div class="infoGradientLabels">${info.labels.map(l => `<span>${l}</span>`).join("")}</div>`;
  } else if (info.compass) {
    html += `<div class="infoGradientBar" style="background:linear-gradient(to right, hsl(0,65%,50%), hsl(90,65%,50%), hsl(180,65%,50%), hsl(270,65%,50%), hsl(360,65%,50%));"></div>`;
    html += `<div class="infoGradientLabels"><span>N</span><span>E</span><span>S</span><span>W</span><span>N</span></div>`;
  } else if (info.diverging) {
    html += `<div class="infoGradientBar" style="background:linear-gradient(to right, ${DIVERGING_NEG}, ${DIVERGING_ZERO}, ${DIVERGING_POS});"></div>`;
    html += `<div class="infoGradientLabels">${info.labels.map(l => `<span>${l}</span>`).join("")}</div>`;
  } else if (info.swatch) {
    html += `<div class="infoSwatch" style="background:${info.swatch};"></div>`;
  }
  return html;
}

function showInfoPopover(key, iconEl) {
  if (currentInfoKey === key && infoPopover.style.display === "block") {
    hideInfoPopover();
    return;
  }
  currentInfoKey = key;
  infoPopover.innerHTML = buildPopoverContent(key);
  infoPopover.style.display = "block";
  infoPopover.style.visibility = "hidden";
  const iconRect = iconEl.getBoundingClientRect();
  const popRect = infoPopover.getBoundingClientRect();
  let left = iconRect.right - popRect.width;
  let top = iconRect.bottom + 8;
  left = Math.max(10, Math.min(left, window.innerWidth - popRect.width - 10));
  if (top + popRect.height > window.innerHeight - 10) {
    top = iconRect.top - popRect.height - 8; // flip above the icon if no room below
  }
  infoPopover.style.left = left + "px";
  infoPopover.style.top = top + "px";
  infoPopover.style.visibility = "visible";
}

function hideInfoPopover() {
  infoPopover.style.display = "none";
  currentInfoKey = null;
}

document.addEventListener("click", function (e) {
  if (e.target.classList.contains("infoBtn")) {
    e.stopPropagation();
    showInfoPopover(e.target.dataset.info, e.target);
  } else if (!e.target.closest("#infoPopover")) {
    hideInfoPopover();
  }
});

window.addEventListener("resize", hideInfoPopover);
document.getElementById("filterBar").addEventListener("scroll", hideInfoPopover);
map.on("movestart", hideInfoPopover);

/* ============================================================
   Plan Your Hunt — draw odds dashboard, sharing the same map
   and GMU polygons as the Scout Tool.

   REAL DATA — extracted and parsed from CPW's 2025 Primary ELK
   Post Draw Report (Draw Recap PDF). Covers six general-public
   season types (Archery, Muzzleloader, First-Fourth Rifle) across
   every GMU that had a corresponding limited-draw hunt code in
   2025. Private-land-only, youth-only, Ranching for Wildlife, and
   other specialty hunt types are intentionally excluded, since
   they don't map cleanly onto these six general seasons.

   Only one year (2025) is loaded so far, so year-over-year trend
   arrows aren't meaningful yet — getDrawTrend() returns a plain
   dash for single-year data rather than a fabricated direction.

   A GMU with no entry here had no elk hunt code in this dataset
   for that species/season/residency combination — it renders as
   genuine "no data" on the map and table, not a placeholder.
   ============================================================ */
const SAMPLE_DRAW_DATA = [{"id":"E-1-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE001O1A","gmus":[1],"quota":2,"applicants":132,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":18}]},{"id":"E-1-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE001O1A","gmus":[1],"quota":2,"applicants":226,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":22,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-2-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE002O1A","gmus":[2],"quota":10,"applicants":396,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":11},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":100},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":25}]},{"id":"E-2-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE002O1A","gmus":[2],"quota":10,"applicants":447,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":27,"pctDrawn":0},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":30,"pctDrawn":0},{"points":31,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":31}]},{"id":"E-3-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE003O1M","gmus":[3],"quota":10,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-3-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE003O1M","gmus":[3],"quota":10,"applicants":21,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":33},{"points":5,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-3-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE003V1A","gmus":[3],"quota":100,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE004O1A","gmus":[4],"quota":400,"applicants":637,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":95},{"points":3,"pctDrawn":65},{"points":4,"pctDrawn":67},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-4-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE004O1A","gmus":[4],"quota":400,"applicants":550,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":92},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-4-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE004O1M","gmus":[4],"quota":100,"applicants":287,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":50},{"points":6,"pctDrawn":50},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-4-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE004O1M","gmus":[4],"quota":100,"applicants":189,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":67},{"points":9,"pctDrawn":67},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-6-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE006O1M","gmus":[6],"quota":400,"applicants":421,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE006O1M","gmus":[6],"quota":400,"applicants":300,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":98},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE006O1R","gmus":[6],"quota":750,"applicants":1203,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":99},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":11,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE006O1R","gmus":[6],"quota":750,"applicants":459,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":93},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE006O4R","gmus":[6],"quota":80,"applicants":201,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE006O4R","gmus":[6],"quota":80,"applicants":35,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-6-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE006V1A","gmus":[6],"quota":1240,"applicants":1200,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-7-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE007O1A","gmus":[7],"quota":1110,"applicants":1739,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":98},{"points":2,"pctDrawn":95},{"points":3,"pctDrawn":94},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE007O1A","gmus":[7],"quota":1110,"applicants":733,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":95},{"points":3,"pctDrawn":83},{"points":4,"pctDrawn":86},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-10-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE010O1A","gmus":[10],"quota":15,"applicants":393,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":7},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":11},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":100},{"points":24,"pctDrawn":100},{"points":25,"pctDrawn":67},{"points":26,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":23}]},{"id":"E-10-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE010O1A","gmus":[10],"quota":15,"applicants":372,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":0},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":30,"pctDrawn":100},{"points":31,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":30}]},{"id":"E-11-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE011O1M","gmus":[11],"quota":100,"applicants":105,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-11-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE011O1M","gmus":[11],"quota":100,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-11-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE011V1A","gmus":[11],"quota":750,"applicants":632,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE012O1A","gmus":[12],"quota":550,"applicants":728,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":88},{"points":3,"pctDrawn":75},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":33},{"points":10,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-12-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE012O1A","gmus":[12],"quota":550,"applicants":822,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":86},{"points":6,"pctDrawn":82},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-12-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE012O1M","gmus":[12],"quota":100,"applicants":248,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":95},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-12-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE012O1M","gmus":[12],"quota":100,"applicants":188,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":50},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":17,"pctDrawn":100},{"points":23,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-14-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE014O1M","gmus":[14],"quota":100,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":75},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-14-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE014O1M","gmus":[14],"quota":100,"applicants":126,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":87},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-14-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE014V1A","gmus":[14],"quota":600,"applicants":671,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE015O1M","gmus":[15],"quota":200,"applicants":236,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-15-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE015O1M","gmus":[15],"quota":200,"applicants":210,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-15-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE015O1R","gmus":[15],"quota":200,"applicants":326,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-15-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE015O1R","gmus":[15],"quota":200,"applicants":186,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":89},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-15-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE015O4R","gmus":[15],"quota":95,"applicants":150,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE015O4R","gmus":[15],"quota":95,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE015V1A","gmus":[15],"quota":620,"applicants":553,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-16-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE016O4R","gmus":[16],"quota":75,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-17-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE017O4R","gmus":[17],"quota":65,"applicants":37,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-17-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE017O4R","gmus":[17],"quota":65,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE018O1M","gmus":[18],"quota":350,"applicants":345,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-18-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE018O1M","gmus":[18],"quota":350,"applicants":295,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE018O1R","gmus":[18],"quota":605,"applicants":888,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":27,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-18-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE018O1R","gmus":[18],"quota":605,"applicants":448,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":18,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE018O4R","gmus":[18],"quota":605,"applicants":347,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE018O4R","gmus":[18],"quota":605,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE018V1A","gmus":[18],"quota":420,"applicants":517,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-20-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE020O1A","gmus":[20],"quota":105,"applicants":386,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":88}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-20-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE020O1A","gmus":[20],"quota":105,"applicants":163,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":76},{"points":8,"pctDrawn":67},{"points":9,"pctDrawn":50},{"points":10,"pctDrawn":67},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-21-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE021O1M","gmus":[21],"quota":175,"applicants":203,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-21-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE021O1M","gmus":[21],"quota":175,"applicants":249,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-21-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE021V1A","gmus":[21],"quota":1150,"applicants":1142,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-25-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE025O1M","gmus":[25],"quota":150,"applicants":181,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-25-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE025O1M","gmus":[25],"quota":150,"applicants":172,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":93},{"points":3,"pctDrawn":86},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-25-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE025V1A","gmus":[25],"quota":1030,"applicants":992,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-27-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE027O1R","gmus":[27],"quota":40,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-27-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE027O1R","gmus":[27],"quota":40,"applicants":54,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-27-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE027O4R","gmus":[27],"quota":30,"applicants":34,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-27-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE027O4R","gmus":[27],"quota":30,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-28-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE028O1M","gmus":[28],"quota":245,"applicants":366,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE028O1M","gmus":[28],"quota":245,"applicants":164,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE028O1R","gmus":[28],"quota":230,"applicants":614,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE028O1R","gmus":[28],"quota":230,"applicants":194,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":88},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE028O4R","gmus":[28],"quota":190,"applicants":349,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-28-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE028O4R","gmus":[28],"quota":190,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-28-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE028V1A","gmus":[28],"quota":370,"applicants":376,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-29-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE029O1A","gmus":[29],"quota":30,"applicants":145,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-29-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE029O1A","gmus":[29],"quota":30,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-33-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE033O1A","gmus":[33],"quota":800,"applicants":735,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":14,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-33-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE033O1A","gmus":[33],"quota":800,"applicants":934,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":92},{"points":4,"pctDrawn":89},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":50},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-33-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE033O1M","gmus":[33],"quota":100,"applicants":236,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-33-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE033O1M","gmus":[33],"quota":100,"applicants":172,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":82},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-35-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE035O1R","gmus":[35],"quota":200,"applicants":352,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":86},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-35-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE035O1R","gmus":[35],"quota":200,"applicants":198,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":91},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-35-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE035O4R","gmus":[35],"quota":40,"applicants":77,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-35-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE035O4R","gmus":[35],"quota":40,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-35-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE035V1A","gmus":[35],"quota":290,"applicants":410,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-36-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE036O4R","gmus":[36],"quota":40,"applicants":76,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-36-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE036O4R","gmus":[36],"quota":40,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-38-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE038V1A","gmus":[38],"quota":30,"applicants":37,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-39-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE039O1A","gmus":[39],"quota":100,"applicants":288,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-39-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE039O1A","gmus":[39],"quota":100,"applicants":113,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-40-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE040O1A","gmus":[40],"quota":65,"applicants":324,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":20,"pctDrawn":100},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":10}]},{"id":"E-40-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE040O1A","gmus":[40],"quota":65,"applicants":174,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":100},{"points":24,"pctDrawn":100},{"points":25,"pctDrawn":100},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":23}]},{"id":"E-40-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE040O1M","gmus":[40],"quota":35,"applicants":125,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":17,"pctDrawn":100},{"points":18,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":11}]},{"id":"E-40-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE040O1M","gmus":[40],"quota":35,"applicants":53,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100},{"points":29,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":26}]},{"id":"E-40-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE040O1R","gmus":[40],"quota":30,"applicants":399,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":7},{"points":7,"pctDrawn":3},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":11},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":18,"pctDrawn":100},{"points":21,"pctDrawn":100},{"points":23,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":14}]},{"id":"E-40-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE040O1R","gmus":[40],"quota":30,"applicants":165,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":0},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":31,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":31}]},{"id":"E-40-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EE040O2R","gmus":[40],"quota":25,"applicants":269,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":5},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":10},{"points":11,"pctDrawn":5},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":83},{"points":14,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":12}]},{"id":"E-40-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EE040O2R","gmus":[40],"quota":25,"applicants":92,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":20,"pctDrawn":100},{"points":22,"pctDrawn":0},{"points":24,"pctDrawn":100},{"points":26,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":20}]},{"id":"E-40-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EE040O3R","gmus":[40],"quota":25,"applicants":215,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":16,"pctDrawn":50}],"priorMinPoints":[{"year":2025,"minPoints":10}]},{"id":"E-40-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EE040O3R","gmus":[40],"quota":25,"applicants":113,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":27}]},{"id":"E-40-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE040O4R","gmus":[40],"quota":20,"applicants":113,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":50},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":9}]},{"id":"E-40-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE040O4R","gmus":[40],"quota":20,"applicants":84,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":100},{"points":25,"pctDrawn":100},{"points":27,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":24}]},{"id":"E-41-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE041O1A","gmus":[41],"quota":2000,"applicants":759,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE041O1A","gmus":[41],"quota":2000,"applicants":1579,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE043O1R","gmus":[43],"quota":225,"applicants":273,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-43-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE043O1R","gmus":[43],"quota":225,"applicants":125,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-43-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE043O4R","gmus":[43],"quota":75,"applicants":152,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-43-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE043O4R","gmus":[43],"quota":75,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE043V1A","gmus":[43],"quota":520,"applicants":505,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE044O1A","gmus":[44],"quota":800,"applicants":902,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-44-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE044O1A","gmus":[44],"quota":800,"applicants":1115,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":93},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-46-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE046O1A","gmus":[46],"quota":60,"applicants":171,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-46-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE046O1A","gmus":[46],"quota":60,"applicants":64,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":28,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE048O1A","gmus":[48],"quota":110,"applicants":279,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE048O1A","gmus":[48],"quota":110,"applicants":141,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-49-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE049O1A","gmus":[49],"quota":170,"applicants":762,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":97},{"points":9,"pctDrawn":75},{"points":10,"pctDrawn":89},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-49-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE049O1A","gmus":[49],"quota":170,"applicants":362,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":18,"pctDrawn":100},{"points":27,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":12}]},{"id":"E-50-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE050O1A","gmus":[50],"quota":80,"applicants":208,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":67},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-50-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE050O1A","gmus":[50],"quota":80,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":64}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-51-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE051O1A","gmus":[51],"quota":120,"applicants":300,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-51-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE051O1A","gmus":[51],"quota":120,"applicants":70,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":89},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-52-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE052O1A","gmus":[52],"quota":325,"applicants":255,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE052O1A","gmus":[52],"quota":325,"applicants":341,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-53-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE053V1A","gmus":[53],"quota":650,"applicants":784,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-54-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE054O1A","gmus":[54],"quota":200,"applicants":365,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":75},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE054O1A","gmus":[54],"quota":200,"applicants":485,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":80},{"points":6,"pctDrawn":60},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-55-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE055O1A","gmus":[55],"quota":335,"applicants":625,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":86},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE055O1A","gmus":[55],"quota":335,"applicants":468,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":89},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-56-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE056O1A","gmus":[56],"quota":110,"applicants":188,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-56-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE056O1A","gmus":[56],"quota":110,"applicants":161,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":84},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE057O1A","gmus":[57],"quota":180,"applicants":447,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":89},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-57-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE057O1A","gmus":[57],"quota":180,"applicants":233,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":86}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-59-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE059V1A","gmus":[59],"quota":220,"applicants":199,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-60-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE060O4R","gmus":[60],"quota":60,"applicants":104,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-60-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE060O4R","gmus":[60],"quota":60,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-60-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE060V1A","gmus":[60],"quota":20,"applicants":40,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-61-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE061O1A","gmus":[61],"quota":90,"applicants":989,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":5},{"points":6,"pctDrawn":4},{"points":7,"pctDrawn":2},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":7},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":5},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":3},{"points":14,"pctDrawn":5},{"points":15,"pctDrawn":5},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":100},{"points":18,"pctDrawn":90},{"points":19,"pctDrawn":100},{"points":20,"pctDrawn":50},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":17}]},{"id":"E-61-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE061O1A","gmus":[61],"quota":90,"applicants":715,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100},{"points":29,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":27}]},{"id":"E-62-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE062O4R","gmus":[62],"quota":100,"applicants":316,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE062O4R","gmus":[62],"quota":100,"applicants":58,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE062V1A","gmus":[62],"quota":1300,"applicants":1264,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-63-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE063V1A","gmus":[63],"quota":330,"applicants":324,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE064O1R","gmus":[64],"quota":450,"applicants":361,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-64-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE064O1R","gmus":[64],"quota":450,"applicants":431,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":99},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-64-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE064O4R","gmus":[64],"quota":100,"applicants":181,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE064O4R","gmus":[64],"quota":100,"applicants":59,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE064V1A","gmus":[64],"quota":640,"applicants":755,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-66-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE066O1A","gmus":[66],"quota":150,"applicants":523,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":94},{"points":6,"pctDrawn":94},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-66-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE066O1A","gmus":[66],"quota":150,"applicants":495,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":17,"pctDrawn":100},{"points":18,"pctDrawn":100},{"points":19,"pctDrawn":100},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":15}]},{"id":"E-67-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE067O1A","gmus":[67],"quota":100,"applicants":290,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":97},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-67-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE067O1A","gmus":[67],"quota":100,"applicants":305,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":50},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-68-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE068V1A","gmus":[68],"quota":610,"applicants":607,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-69-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE069O1A","gmus":[69],"quota":115,"applicants":593,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":88},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":0},{"points":11,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-69-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE069O1A","gmus":[69],"quota":115,"applicants":273,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":18,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-76-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE076O1A","gmus":[76],"quota":160,"applicants":818,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":96},{"points":11,"pctDrawn":93},{"points":12,"pctDrawn":89},{"points":13,"pctDrawn":67},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":17,"pctDrawn":75},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":9}]},{"id":"E-76-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE076O1A","gmus":[76],"quota":160,"applicants":771,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":100},{"points":20,"pctDrawn":89},{"points":21,"pctDrawn":86},{"points":22,"pctDrawn":67},{"points":23,"pctDrawn":75},{"points":24,"pctDrawn":100},{"points":25,"pctDrawn":100},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":19}]},{"id":"E-79-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE079V1A","gmus":[79],"quota":220,"applicants":236,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-80-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE080O1A","gmus":[80],"quota":2000,"applicants":1049,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE080O1A","gmus":[80],"quota":2000,"applicants":2975,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-82-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE082O1M","gmus":[82],"quota":75,"applicants":88,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-82-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE082O1M","gmus":[82],"quota":75,"applicants":91,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-82-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE082O1R","gmus":[82],"quota":300,"applicants":313,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE082O1R","gmus":[82],"quota":300,"applicants":175,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE082O4R","gmus":[82],"quota":100,"applicants":132,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-82-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE082O4R","gmus":[82],"quota":100,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE082V1A","gmus":[82],"quota":170,"applicants":237,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-83-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE083O1M","gmus":[83],"quota":75,"applicants":84,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE083O1M","gmus":[83],"quota":75,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-83-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE083O1R","gmus":[83],"quota":175,"applicants":268,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE083O1R","gmus":[83],"quota":175,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EE083O2R","gmus":[83],"quota":200,"applicants":287,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-83-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EE083O2R","gmus":[83],"quota":200,"applicants":60,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-83-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EE083O3R","gmus":[83],"quota":200,"applicants":437,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":0},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EE083O3R","gmus":[83],"quota":200,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE083O4R","gmus":[83],"quota":100,"applicants":309,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":4300},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE083O4R","gmus":[83],"quota":100,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":12}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-83-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE083V1A","gmus":[83],"quota":100,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-85-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE085O1M","gmus":[85],"quota":120,"applicants":168,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-85-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE085O1M","gmus":[85],"quota":120,"applicants":150,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":17,"pctDrawn":100},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-85-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE085O1R","gmus":[85],"quota":85,"applicants":338,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":14,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-85-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE085O1R","gmus":[85],"quota":85,"applicants":161,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-85-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE085O4R","gmus":[85],"quota":125,"applicants":230,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-85-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE085O4R","gmus":[85],"quota":125,"applicants":81,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-85-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE085V1A","gmus":[85],"quota":600,"applicants":794,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-86-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE086O1M","gmus":[86],"quota":115,"applicants":123,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE086O1M","gmus":[86],"quota":115,"applicants":115,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":75},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE086O1R","gmus":[86],"quota":170,"applicants":351,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE086O1R","gmus":[86],"quota":170,"applicants":135,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":92},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE086O4R","gmus":[86],"quota":90,"applicants":136,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-86-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE086O4R","gmus":[86],"quota":90,"applicants":17,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-86-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE086V1A","gmus":[86],"quota":330,"applicants":325,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-104-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE104O1A","gmus":[104],"quota":35,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-104-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE104O1A","gmus":[104],"quota":35,"applicants":7,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-128-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE128O1M","gmus":[128],"quota":25,"applicants":1,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-133-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EE133O1M","gmus":[133],"quota":10,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-133-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EE133O1M","gmus":[133],"quota":10,"applicants":7,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-161-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE161O4R","gmus":[161],"quota":100,"applicants":121,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-161-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE161O4R","gmus":[161],"quota":100,"applicants":34,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-171-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE171O4R","gmus":[171],"quota":60,"applicants":32,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-171-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE171O4R","gmus":[171],"quota":60,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-201-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE201O1A","gmus":[201],"quota":10,"applicants":396,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":20},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":26}]},{"id":"E-201-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE201O1A","gmus":[201],"quota":10,"applicants":482,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":0},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":30,"pctDrawn":0},{"points":31,"pctDrawn":0},{"points":32,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":32}]},{"id":"E-371-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EE371O1R","gmus":[371],"quota":90,"applicants":183,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EE371O1R","gmus":[371],"quota":90,"applicants":71,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EE371O4R","gmus":[371],"quota":55,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EE371O4R","gmus":[371],"quota":55,"applicants":3,"year":2025,"drawCurve":[{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-391-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE391O1A","gmus":[391],"quota":50,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-391-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE391O1A","gmus":[391],"quota":50,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-461-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE461O1A","gmus":[461],"quota":50,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-481-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE481O1A","gmus":[481],"quota":110,"applicants":233,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-481-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE481O1A","gmus":[481],"quota":110,"applicants":123,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":83},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-500-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE500O1A","gmus":[500],"quota":110,"applicants":367,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":75},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-500-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE500O1A","gmus":[500],"quota":110,"applicants":192,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":93},{"points":7,"pctDrawn":70},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-501-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE501O1A","gmus":[501],"quota":70,"applicants":364,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":91},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-501-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE501O1A","gmus":[501],"quota":70,"applicants":172,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-521-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE521O1A","gmus":[521],"quota":750,"applicants":420,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-521-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE521O1A","gmus":[521],"quota":750,"applicants":1297,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":27,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-551-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE551O1A","gmus":[551],"quota":190,"applicants":298,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":93},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-551-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE551O1A","gmus":[551],"quota":190,"applicants":253,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":92},{"points":5,"pctDrawn":75},{"points":6,"pctDrawn":50},{"points":8,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-561-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE561O1A","gmus":[561],"quota":80,"applicants":131,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-561-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE561O1A","gmus":[561],"quota":80,"applicants":66,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-851-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EE851O1A","gmus":[851],"quota":8,"applicants":48,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":25},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":50},{"points":11,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-851-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE851O1A","gmus":[851],"quota":8,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":17}]},{"id":"E-1-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF001O1M","gmus":[1],"quota":5,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-1-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF001O1M","gmus":[1],"quota":5,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-1-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF001O1R","gmus":[1],"quota":10,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-1-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF001O2R","gmus":[1],"quota":25,"applicants":49,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-1-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF001O3R","gmus":[1],"quota":20,"applicants":48,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-1-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF001O4R","gmus":[1],"quota":25,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-1-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF001O4R","gmus":[1],"quota":25,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-2-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF002O1M","gmus":[2],"quota":5,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-2-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF002O1M","gmus":[2],"quota":5,"applicants":4,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-2-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF002O1R","gmus":[2],"quota":35,"applicants":120,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":89},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":14,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-2-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF002O1R","gmus":[2],"quota":35,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-2-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF002O2R","gmus":[2],"quota":30,"applicants":101,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-2-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF002O2R","gmus":[2],"quota":30,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-2-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF002O3R","gmus":[2],"quota":30,"applicants":103,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-2-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF002O3R","gmus":[2],"quota":30,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":25,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-2-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF002O4R","gmus":[2],"quota":30,"applicants":94,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":70},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-2-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF002O4R","gmus":[2],"quota":30,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-3-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF003O1R","gmus":[3],"quota":250,"applicants":850,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":95},{"points":3,"pctDrawn":89},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-3-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF003O1R","gmus":[3],"quota":250,"applicants":288,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":38},{"points":3,"pctDrawn":67},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-3-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF003O2R","gmus":[3],"quota":250,"applicants":162,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-3-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF003O2R","gmus":[3],"quota":250,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-3-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF003O3R","gmus":[3],"quota":250,"applicants":349,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-3-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF003O3R","gmus":[3],"quota":250,"applicants":154,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-3-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF003O4R","gmus":[3],"quota":350,"applicants":236,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-3-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF003O4R","gmus":[3],"quota":350,"applicants":49,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF004O2R","gmus":[4],"quota":250,"applicants":260,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF004O2R","gmus":[4],"quota":250,"applicants":106,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF004O3R","gmus":[4],"quota":250,"applicants":128,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF004O3R","gmus":[4],"quota":250,"applicants":76,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-5-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF005O2R","gmus":[5],"quota":50,"applicants":77,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-5-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF005O2R","gmus":[5],"quota":50,"applicants":34,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-5-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF005O3R","gmus":[5],"quota":50,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-5-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF005O3R","gmus":[5],"quota":50,"applicants":16,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-6-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF006O2R","gmus":[6],"quota":1400,"applicants":652,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-6-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF006O2R","gmus":[6],"quota":1400,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-6-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF006O3R","gmus":[6],"quota":225,"applicants":216,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-6-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF006O3R","gmus":[6],"quota":225,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-7-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF007O1M","gmus":[7],"quota":375,"applicants":556,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-7-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF007O1M","gmus":[7],"quota":375,"applicants":93,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":80},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-7-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF007O2R","gmus":[7],"quota":180,"applicants":834,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":98},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-7-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF007O2R","gmus":[7],"quota":180,"applicants":67,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-7-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF007O3R","gmus":[7],"quota":170,"applicants":656,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF007O3R","gmus":[7],"quota":170,"applicants":63,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF007O4R","gmus":[7],"quota":75,"applicants":176,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF007O4R","gmus":[7],"quota":75,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-10-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF010O1M","gmus":[10],"quota":5,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-10-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF010O1M","gmus":[10],"quota":5,"applicants":16,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-10-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF010O1R","gmus":[10],"quota":75,"applicants":117,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-10-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF010O1R","gmus":[10],"quota":75,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-10-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF010O2R","gmus":[10],"quota":50,"applicants":117,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-10-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF010O2R","gmus":[10],"quota":50,"applicants":17,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-10-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF010O3R","gmus":[10],"quota":50,"applicants":148,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-10-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF010O3R","gmus":[10],"quota":50,"applicants":54,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":83}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-10-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF010O4R","gmus":[10],"quota":90,"applicants":137,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-10-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF010O4R","gmus":[10],"quota":90,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF011O1R","gmus":[11],"quota":750,"applicants":1156,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF011O1R","gmus":[11],"quota":750,"applicants":661,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF011O2R","gmus":[11],"quota":500,"applicants":220,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF011O2R","gmus":[11],"quota":500,"applicants":122,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF011O3R","gmus":[11],"quota":500,"applicants":346,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF011O3R","gmus":[11],"quota":500,"applicants":168,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF011O4R","gmus":[11],"quota":1000,"applicants":373,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-11-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF011O4R","gmus":[11],"quota":1000,"applicants":227,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF012O2R","gmus":[12],"quota":750,"applicants":524,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF012O2R","gmus":[12],"quota":750,"applicants":247,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF012O3R","gmus":[12],"quota":750,"applicants":359,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF012O3R","gmus":[12],"quota":750,"applicants":211,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF014O1R","gmus":[14],"quota":50,"applicants":94,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":86},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF014O1R","gmus":[14],"quota":50,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":33},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF014O2R","gmus":[14],"quota":50,"applicants":96,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-14-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF014O2R","gmus":[14],"quota":50,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF014O3R","gmus":[14],"quota":50,"applicants":67,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF014O3R","gmus":[14],"quota":50,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-14-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF014O4R","gmus":[14],"quota":25,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-14-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF014O4R","gmus":[14],"quota":25,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-15-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF015O2R","gmus":[15],"quota":385,"applicants":326,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF015O2R","gmus":[15],"quota":385,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF015O3R","gmus":[15],"quota":255,"applicants":259,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-15-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF015O3R","gmus":[15],"quota":255,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-16-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF016O3R","gmus":[16],"quota":160,"applicants":81,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-16-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF016O3R","gmus":[16],"quota":160,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-17-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF017O3R","gmus":[17],"quota":340,"applicants":150,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-17-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF017O3R","gmus":[17],"quota":340,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF018O2R","gmus":[18],"quota":315,"applicants":511,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-18-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF018O2R","gmus":[18],"quota":315,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF018O3R","gmus":[18],"quota":395,"applicants":591,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-18-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF018O3R","gmus":[18],"quota":395,"applicants":48,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-19-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF019O2R","gmus":[19],"quota":50,"applicants":129,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":50}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-19-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF019O2R","gmus":[19],"quota":50,"applicants":17,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-19-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF019O3R","gmus":[19],"quota":30,"applicants":125,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-19-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF019O3R","gmus":[19],"quota":30,"applicants":7,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-19-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF019O4R","gmus":[19],"quota":20,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-20-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF020O1M","gmus":[20],"quota":10,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-20-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF020O1M","gmus":[20],"quota":10,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-20-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF020O2R","gmus":[20],"quota":10,"applicants":152,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-20-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF020O2R","gmus":[20],"quota":10,"applicants":10,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-20-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF020O3R","gmus":[20],"quota":10,"applicants":144,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":80},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-20-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF020O3R","gmus":[20],"quota":10,"applicants":7,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-20-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF020O4R","gmus":[20],"quota":10,"applicants":117,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-20-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF020O4R","gmus":[20],"quota":10,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-21-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF021O1R","gmus":[21],"quota":75,"applicants":308,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-21-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF021O1R","gmus":[21],"quota":75,"applicants":134,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-21-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF021O2R","gmus":[21],"quota":200,"applicants":635,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-21-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF021O2R","gmus":[21],"quota":200,"applicants":238,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-21-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF021O3R","gmus":[21],"quota":100,"applicants":358,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-21-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF021O3R","gmus":[21],"quota":100,"applicants":149,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-21-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF021O4R","gmus":[21],"quota":100,"applicants":267,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-21-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF021O4R","gmus":[21],"quota":100,"applicants":48,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-25-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF025O1R","gmus":[25],"quota":150,"applicants":163,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-25-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF025O1R","gmus":[25],"quota":150,"applicants":108,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-25-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF025O2R","gmus":[25],"quota":125,"applicants":206,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-25-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF025O2R","gmus":[25],"quota":125,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-25-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF025O3R","gmus":[25],"quota":50,"applicants":146,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-25-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF025O3R","gmus":[25],"quota":50,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":75},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-25-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF025O4R","gmus":[25],"quota":25,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-25-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF025O4R","gmus":[25],"quota":25,"applicants":13,"year":2025,"drawCurve":[{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-27-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF027O2R","gmus":[27],"quota":190,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-27-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF027O3R","gmus":[27],"quota":120,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-27-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF027O3R","gmus":[27],"quota":120,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-28-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF028O2R","gmus":[28],"quota":210,"applicants":421,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF028O2R","gmus":[28],"quota":210,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-28-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF028O3R","gmus":[28],"quota":230,"applicants":393,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-28-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF028O3R","gmus":[28],"quota":230,"applicants":23,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-29-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF029O1M","gmus":[29],"quota":20,"applicants":49,"year":2025,"drawCurve":[{"points":0,"pctDrawn":85},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-29-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF029O1R","gmus":[29],"quota":10,"applicants":41,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-29-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF029O2R","gmus":[29],"quota":35,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-29-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF029O2R","gmus":[29],"quota":35,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-29-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF029O3R","gmus":[29],"quota":35,"applicants":92,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-29-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF029O3R","gmus":[29],"quota":35,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-29-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF029O4R","gmus":[29],"quota":10,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-30-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF030O3R","gmus":[30],"quota":250,"applicants":294,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-30-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF030O3R","gmus":[30],"quota":250,"applicants":76,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-30-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF030O4R","gmus":[30],"quota":250,"applicants":296,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-30-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF030O4R","gmus":[30],"quota":250,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF033O2R","gmus":[33],"quota":500,"applicants":209,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF033O2R","gmus":[33],"quota":500,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF033O3R","gmus":[33],"quota":300,"applicants":128,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF033O3R","gmus":[33],"quota":300,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF033O4R","gmus":[33],"quota":50,"applicants":39,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-33-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF033O4R","gmus":[33],"quota":50,"applicants":5,"year":2025,"drawCurve":[{"points":29,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-34-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF034O2R","gmus":[34],"quota":50,"applicants":107,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-34-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF034O2R","gmus":[34],"quota":50,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-34-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF034O3R","gmus":[34],"quota":50,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-34-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF034O3R","gmus":[34],"quota":50,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-34-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF034O4R","gmus":[34],"quota":25,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-35-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF035O1M","gmus":[35],"quota":130,"applicants":125,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-35-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF035O1M","gmus":[35],"quota":130,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-35-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF035O2R","gmus":[35],"quota":75,"applicants":118,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-35-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF035O2R","gmus":[35],"quota":75,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-35-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF035O3R","gmus":[35],"quota":40,"applicants":95,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-35-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF035O3R","gmus":[35],"quota":40,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-36-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF036O2R","gmus":[36],"quota":170,"applicants":154,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-36-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF036O2R","gmus":[36],"quota":170,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-36-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF036O3R","gmus":[36],"quota":60,"applicants":93,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-36-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF036O3R","gmus":[36],"quota":60,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-38-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF038O1M","gmus":[38],"quota":10,"applicants":54,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-38-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF038O1M","gmus":[38],"quota":10,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-38-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF038O1R","gmus":[38],"quota":20,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":91},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-38-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF038O2R","gmus":[38],"quota":10,"applicants":118,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-38-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF038O2R","gmus":[38],"quota":10,"applicants":1,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-38-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF038O3R","gmus":[38],"quota":10,"applicants":77,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-38-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF038O4R","gmus":[38],"quota":10,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-38-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF038O4R","gmus":[38],"quota":10,"applicants":2,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-39-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF039O1M","gmus":[39],"quota":15,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF039O1M","gmus":[39],"quota":15,"applicants":8,"year":2025,"drawCurve":[{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-39-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF039O1R","gmus":[39],"quota":20,"applicants":84,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF039O1R","gmus":[39],"quota":20,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF039O2R","gmus":[39],"quota":20,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF039O2R","gmus":[39],"quota":20,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-39-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF039O3R","gmus":[39],"quota":20,"applicants":86,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF039O3R","gmus":[39],"quota":20,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-39-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF039O4R","gmus":[39],"quota":10,"applicants":35,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF041O1M","gmus":[41],"quota":315,"applicants":404,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF041O1M","gmus":[41],"quota":315,"applicants":167,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF041O1R","gmus":[41],"quota":200,"applicants":685,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-41-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF041O1R","gmus":[41],"quota":200,"applicants":195,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":77},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-41-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF041O2R","gmus":[41],"quota":160,"applicants":230,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF041O2R","gmus":[41],"quota":160,"applicants":48,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF041O3R","gmus":[41],"quota":80,"applicants":195,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-41-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF041O3R","gmus":[41],"quota":80,"applicants":39,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-41-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF041O4R","gmus":[41],"quota":40,"applicants":158,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF042O2R","gmus":[42],"quota":300,"applicants":309,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF042O2R","gmus":[42],"quota":300,"applicants":106,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF042O3R","gmus":[42],"quota":315,"applicants":256,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF042O3R","gmus":[42],"quota":315,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF042O4R","gmus":[42],"quota":110,"applicants":120,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-42-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF042O4R","gmus":[42],"quota":110,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF043O1M","gmus":[43],"quota":40,"applicants":85,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF043O1M","gmus":[43],"quota":40,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF043O2R","gmus":[43],"quota":385,"applicants":415,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF043O2R","gmus":[43],"quota":385,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF043O3R","gmus":[43],"quota":215,"applicants":350,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-43-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF043O3R","gmus":[43],"quota":215,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF044O1M","gmus":[44],"quota":100,"applicants":159,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF044O1M","gmus":[44],"quota":100,"applicants":56,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF044O1R","gmus":[44],"quota":200,"applicants":375,"year":2025,"drawCurve":[{"points":0,"pctDrawn":98},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF044O1R","gmus":[44],"quota":200,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":80},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":67},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF044O2R","gmus":[44],"quota":160,"applicants":209,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":13,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF044O2R","gmus":[44],"quota":160,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF044O3R","gmus":[44],"quota":120,"applicants":138,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF044O3R","gmus":[44],"quota":120,"applicants":43,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-44-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF044O4R","gmus":[44],"quota":30,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-45-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF045O2R","gmus":[45],"quota":125,"applicants":113,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-45-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF045O2R","gmus":[45],"quota":125,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-45-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF045O3R","gmus":[45],"quota":90,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-45-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF045O3R","gmus":[45],"quota":90,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-45-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF045O4R","gmus":[45],"quota":20,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-46-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF046O1M","gmus":[46],"quota":15,"applicants":59,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-46-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF046O1R","gmus":[46],"quota":10,"applicants":60,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-46-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF046O2R","gmus":[46],"quota":20,"applicants":80,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-46-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF046O3R","gmus":[46],"quota":20,"applicants":72,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-47-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF047O2R","gmus":[47],"quota":130,"applicants":59,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-47-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF047O2R","gmus":[47],"quota":130,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-47-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF047O3R","gmus":[47],"quota":110,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-47-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF047O3R","gmus":[47],"quota":110,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-47-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF047O4R","gmus":[47],"quota":30,"applicants":16,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-48-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF048O1M","gmus":[48],"quota":35,"applicants":74,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":71},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-48-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF048O1M","gmus":[48],"quota":35,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-48-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF048O2R","gmus":[48],"quota":50,"applicants":223,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF048O2R","gmus":[48],"quota":50,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF048O3R","gmus":[48],"quota":25,"applicants":129,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF048O3R","gmus":[48],"quota":25,"applicants":3,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-48-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF048O4R","gmus":[48],"quota":30,"applicants":93,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-49-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF049O1M","gmus":[49],"quota":70,"applicants":223,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":90},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-49-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF049O1M","gmus":[49],"quota":70,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-49-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF049O2R","gmus":[49],"quota":130,"applicants":636,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":93},{"points":3,"pctDrawn":93},{"points":4,"pctDrawn":80},{"points":5,"pctDrawn":67},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-49-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF049O2R","gmus":[49],"quota":130,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":20},{"points":8,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-49-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF049O3R","gmus":[49],"quota":130,"applicants":509,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":98},{"points":2,"pctDrawn":67},{"points":3,"pctDrawn":75},{"points":4,"pctDrawn":50},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-49-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF049O3R","gmus":[49],"quota":130,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-49-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF049O4R","gmus":[49],"quota":130,"applicants":386,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-49-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF049O4R","gmus":[49],"quota":130,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-50-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF050O1M","gmus":[50],"quota":55,"applicants":99,"year":2025,"drawCurve":[{"points":0,"pctDrawn":93},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-50-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF050O1M","gmus":[50],"quota":55,"applicants":3,"year":2025,"drawCurve":[{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-50-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF050O2R","gmus":[50],"quota":190,"applicants":436,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-50-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF050O2R","gmus":[50],"quota":190,"applicants":56,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-50-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF050O3R","gmus":[50],"quota":185,"applicants":452,"year":2025,"drawCurve":[{"points":0,"pctDrawn":98},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":83},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-50-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF050O3R","gmus":[50],"quota":185,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-50-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF050O4R","gmus":[50],"quota":135,"applicants":350,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":94},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-50-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF050O4R","gmus":[50],"quota":135,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-51-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF051O1M","gmus":[51],"quota":50,"applicants":89,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-51-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF051O1M","gmus":[51],"quota":50,"applicants":10,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-51-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF051O1R","gmus":[51],"quota":40,"applicants":87,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-51-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF051O2R","gmus":[51],"quota":50,"applicants":101,"year":2025,"drawCurve":[{"points":0,"pctDrawn":94},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-51-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF051O3R","gmus":[51],"quota":40,"applicants":99,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-51-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF051O3R","gmus":[51],"quota":40,"applicants":2,"year":2025,"drawCurve":[{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-51-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF051O4R","gmus":[51],"quota":35,"applicants":63,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF052O2R","gmus":[52],"quota":205,"applicants":163,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF052O2R","gmus":[52],"quota":205,"applicants":38,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF052O3R","gmus":[52],"quota":100,"applicants":114,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF052O3R","gmus":[52],"quota":100,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF052O4R","gmus":[52],"quota":30,"applicants":35,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-52-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF052O4R","gmus":[52],"quota":30,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-53-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF053O1M","gmus":[53],"quota":20,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF053O1M","gmus":[53],"quota":20,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF053O1R","gmus":[53],"quota":20,"applicants":66,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF053O1R","gmus":[53],"quota":20,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-53-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF053O2R","gmus":[53],"quota":30,"applicants":76,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF053O2R","gmus":[53],"quota":30,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF053O3R","gmus":[53],"quota":35,"applicants":79,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF053O3R","gmus":[53],"quota":35,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-53-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF053O4R","gmus":[53],"quota":30,"applicants":43,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-53-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF053O4R","gmus":[53],"quota":30,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-54-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF054O1M","gmus":[54],"quota":25,"applicants":84,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":83},{"points":2,"pctDrawn":67}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF054O1M","gmus":[54],"quota":25,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF054O1R","gmus":[54],"quota":40,"applicants":213,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF054O1R","gmus":[54],"quota":40,"applicants":84,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-54-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF054O2R","gmus":[54],"quota":50,"applicants":172,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF054O2R","gmus":[54],"quota":50,"applicants":58,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-54-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF054O3R","gmus":[54],"quota":35,"applicants":182,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-54-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF054O3R","gmus":[54],"quota":35,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":50}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-54-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF054O4R","gmus":[54],"quota":30,"applicants":114,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-54-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF054O4R","gmus":[54],"quota":30,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF055O1M","gmus":[55],"quota":125,"applicants":211,"year":2025,"drawCurve":[{"points":0,"pctDrawn":98},{"points":1,"pctDrawn":86},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-55-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF055O1M","gmus":[55],"quota":125,"applicants":93,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-55-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF055O1R","gmus":[55],"quota":175,"applicants":431,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF055O1R","gmus":[55],"quota":175,"applicants":99,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":62},{"points":2,"pctDrawn":57},{"points":3,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF055O2R","gmus":[55],"quota":200,"applicants":517,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":94},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF055O2R","gmus":[55],"quota":200,"applicants":111,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-55-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF055O3R","gmus":[55],"quota":100,"applicants":432,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-55-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF055O3R","gmus":[55],"quota":100,"applicants":129,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-55-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF055O4R","gmus":[55],"quota":10,"applicants":121,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-55-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF055O4R","gmus":[55],"quota":10,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-56-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF056O1M","gmus":[56],"quota":40,"applicants":46,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-56-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF056O1M","gmus":[56],"quota":40,"applicants":13,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-56-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF056O2R","gmus":[56],"quota":50,"applicants":162,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":86},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-56-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF056O2R","gmus":[56],"quota":50,"applicants":13,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-56-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF056O3R","gmus":[56],"quota":50,"applicants":130,"year":2025,"drawCurve":[{"points":0,"pctDrawn":77},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-56-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF056O3R","gmus":[56],"quota":50,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-56-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF056O4R","gmus":[56],"quota":30,"applicants":67,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-56-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF056O4R","gmus":[56],"quota":30,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-57-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF057O1M","gmus":[57],"quota":90,"applicants":172,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":92},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":50},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF057O1M","gmus":[57],"quota":90,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF057O1R","gmus":[57],"quota":100,"applicants":266,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":1,"pctDrawn":90},{"points":2,"pctDrawn":88},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF057O1R","gmus":[57],"quota":100,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF057O2R","gmus":[57],"quota":130,"applicants":457,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":57},{"points":3,"pctDrawn":83},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF057O2R","gmus":[57],"quota":130,"applicants":54,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":33}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF057O3R","gmus":[57],"quota":130,"applicants":520,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":93},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF057O3R","gmus":[57],"quota":130,"applicants":42,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-57-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF057O4R","gmus":[57],"quota":130,"applicants":364,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":93},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-57-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF057O4R","gmus":[57],"quota":130,"applicants":25,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF059O1M","gmus":[59],"quota":120,"applicants":185,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-59-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF059O1M","gmus":[59],"quota":120,"applicants":25,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-59-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF059O1R","gmus":[59],"quota":50,"applicants":188,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF059O1R","gmus":[59],"quota":50,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF059O2R","gmus":[59],"quota":80,"applicants":224,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF059O2R","gmus":[59],"quota":80,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF059O3R","gmus":[59],"quota":60,"applicants":207,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":80},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF059O3R","gmus":[59],"quota":60,"applicants":25,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF059O4R","gmus":[59],"quota":10,"applicants":94,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-59-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF059O4R","gmus":[59],"quota":10,"applicants":2,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-60-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF060O1R","gmus":[60],"quota":10,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-60-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF060O2R","gmus":[60],"quota":15,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-60-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF060O2R","gmus":[60],"quota":15,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-60-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF060O3R","gmus":[60],"quota":15,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-61-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF061O1M","gmus":[61],"quota":50,"applicants":113,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":50},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-61-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF061O1M","gmus":[61],"quota":50,"applicants":35,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":67},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":11,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-61-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF061O1R","gmus":[61],"quota":75,"applicants":300,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-61-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF061O1R","gmus":[61],"quota":75,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":75}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-61-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF061O2R","gmus":[61],"quota":205,"applicants":486,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":97},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":92},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-61-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF061O2R","gmus":[61],"quota":205,"applicants":115,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-61-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF061O3R","gmus":[61],"quota":235,"applicants":436,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":98},{"points":2,"pctDrawn":96},{"points":3,"pctDrawn":40},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-61-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF061O3R","gmus":[61],"quota":235,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":94},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-61-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF061O4R","gmus":[61],"quota":285,"applicants":449,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-61-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF061O4R","gmus":[61],"quota":285,"applicants":43,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-62-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF062O1M","gmus":[62],"quota":110,"applicants":139,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-62-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF062O1M","gmus":[62],"quota":110,"applicants":55,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-62-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF062O1R","gmus":[62],"quota":150,"applicants":353,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":88},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":18,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF062O1R","gmus":[62],"quota":150,"applicants":125,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":67},{"points":2,"pctDrawn":64},{"points":3,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF062O2R","gmus":[62],"quota":200,"applicants":502,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF062O2R","gmus":[62],"quota":200,"applicants":141,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":92},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":89},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-62-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF062O3R","gmus":[62],"quota":200,"applicants":324,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-62-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF062O3R","gmus":[62],"quota":200,"applicants":70,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-63-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF063O1M","gmus":[63],"quota":25,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF063O1M","gmus":[63],"quota":25,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-63-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF063O1R","gmus":[63],"quota":70,"applicants":73,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF063O1R","gmus":[63],"quota":70,"applicants":42,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-63-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF063O2R","gmus":[63],"quota":80,"applicants":102,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF063O2R","gmus":[63],"quota":80,"applicants":46,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-63-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF063O3R","gmus":[63],"quota":45,"applicants":91,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF063O3R","gmus":[63],"quota":45,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF063O4R","gmus":[63],"quota":30,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-63-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF063O4R","gmus":[63],"quota":30,"applicants":10,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF064O1M","gmus":[64],"quota":100,"applicants":78,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF064O1M","gmus":[64],"quota":100,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF064O2R","gmus":[64],"quota":150,"applicants":178,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-64-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF064O2R","gmus":[64],"quota":150,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-64-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF064O3R","gmus":[64],"quota":100,"applicants":145,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-64-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF064O3R","gmus":[64],"quota":100,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-66-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF066O1M","gmus":[66],"quota":40,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF066O1M","gmus":[66],"quota":40,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-66-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF066O1R","gmus":[66],"quota":115,"applicants":288,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":80},{"points":2,"pctDrawn":71},{"points":3,"pctDrawn":33}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF066O1R","gmus":[66],"quota":115,"applicants":100,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":91},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF066O2R","gmus":[66],"quota":140,"applicants":324,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":89},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF066O2R","gmus":[66],"quota":140,"applicants":131,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF066O3R","gmus":[66],"quota":150,"applicants":342,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":68},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF066O3R","gmus":[66],"quota":150,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF066O4R","gmus":[66],"quota":100,"applicants":175,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":89},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-66-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF066O4R","gmus":[66],"quota":100,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF067O1M","gmus":[67],"quota":40,"applicants":67,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF067O1M","gmus":[67],"quota":40,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF067O1R","gmus":[67],"quota":85,"applicants":216,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":94},{"points":2,"pctDrawn":60},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":50}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF067O1R","gmus":[67],"quota":85,"applicants":63,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":17},{"points":3,"pctDrawn":50},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-67-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF067O2R","gmus":[67],"quota":130,"applicants":387,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":91},{"points":3,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF067O2R","gmus":[67],"quota":130,"applicants":87,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":88},{"points":2,"pctDrawn":80},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF067O3R","gmus":[67],"quota":150,"applicants":379,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF067O3R","gmus":[67],"quota":150,"applicants":85,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":25},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF067O4R","gmus":[67],"quota":100,"applicants":222,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-67-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF067O4R","gmus":[67],"quota":100,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":60}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-68-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF068O1M","gmus":[68],"quota":10,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-68-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF068O1M","gmus":[68],"quota":10,"applicants":7,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-68-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF068O2R","gmus":[68],"quota":60,"applicants":440,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-68-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF068O2R","gmus":[68],"quota":60,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-68-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF068O3R","gmus":[68],"quota":60,"applicants":409,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-68-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF068O3R","gmus":[68],"quota":60,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-68-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF068O4R","gmus":[68],"quota":60,"applicants":175,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-68-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF068O4R","gmus":[68],"quota":60,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-69-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF069O1M","gmus":[69],"quota":30,"applicants":122,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-69-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF069O1M","gmus":[69],"quota":30,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-69-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF069O2R","gmus":[69],"quota":75,"applicants":372,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":92},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-69-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF069O2R","gmus":[69],"quota":75,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-69-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF069O3R","gmus":[69],"quota":75,"applicants":305,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-69-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF069O3R","gmus":[69],"quota":75,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-69-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF069O4R","gmus":[69],"quota":45,"applicants":167,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-70-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EF070O1A","gmus":[70],"quota":100,"applicants":86,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF070O1A","gmus":[70],"quota":100,"applicants":181,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-70-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF070O1M","gmus":[70],"quota":25,"applicants":50,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF070O1M","gmus":[70],"quota":25,"applicants":52,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-70-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF070O1R","gmus":[70],"quota":75,"applicants":189,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":97},{"points":2,"pctDrawn":92},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF070O1R","gmus":[70],"quota":75,"applicants":120,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":57}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-70-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF070O2R","gmus":[70],"quota":125,"applicants":257,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF070O2R","gmus":[70],"quota":125,"applicants":190,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-70-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF070O3R","gmus":[70],"quota":125,"applicants":343,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF070O3R","gmus":[70],"quota":125,"applicants":170,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-70-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF070O4R","gmus":[70],"quota":50,"applicants":171,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":83},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-70-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF070O4R","gmus":[70],"quota":50,"applicants":28,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-71-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EF071O1A","gmus":[71],"quota":100,"applicants":176,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-71-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF071O1A","gmus":[71],"quota":100,"applicants":240,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":92},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-71-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF071O1M","gmus":[71],"quota":30,"applicants":188,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-71-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF071O1M","gmus":[71],"quota":30,"applicants":105,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-71-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF071O1R","gmus":[71],"quota":40,"applicants":574,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-71-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF071O1R","gmus":[71],"quota":40,"applicants":130,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-71-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF071O2R","gmus":[71],"quota":10,"applicants":302,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":14,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-71-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF071O2R","gmus":[71],"quota":10,"applicants":125,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-71-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF071O3R","gmus":[71],"quota":10,"applicants":215,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-71-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF071O3R","gmus":[71],"quota":10,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-71-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF071O4R","gmus":[71],"quota":10,"applicants":135,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-71-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF071O4R","gmus":[71],"quota":10,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-72-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF072O2R","gmus":[72],"quota":10,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-72-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF072O2R","gmus":[72],"quota":10,"applicants":10,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-72-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF072O3R","gmus":[72],"quota":10,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-72-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF072O3R","gmus":[72],"quota":10,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-72-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF072O4R","gmus":[72],"quota":10,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-73-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF073O2R","gmus":[73],"quota":10,"applicants":127,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-73-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF073O2R","gmus":[73],"quota":10,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-73-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF073O3R","gmus":[73],"quota":10,"applicants":79,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-73-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF073O3R","gmus":[73],"quota":10,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-73-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF073O4R","gmus":[73],"quota":10,"applicants":41,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EF074O1A","gmus":[74],"quota":25,"applicants":100,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF074O1A","gmus":[74],"quota":25,"applicants":98,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":50}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF074O1M","gmus":[74],"quota":15,"applicants":46,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF074O1M","gmus":[74],"quota":15,"applicants":44,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF074O1R","gmus":[74],"quota":15,"applicants":123,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":67}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-74-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF074O1R","gmus":[74],"quota":15,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-74-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF074O2R","gmus":[74],"quota":10,"applicants":112,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-74-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF074O2R","gmus":[74],"quota":10,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-74-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF074O3R","gmus":[74],"quota":10,"applicants":105,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-74-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF074O3R","gmus":[74],"quota":10,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-74-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF074O4R","gmus":[74],"quota":10,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-75-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EF075O1A","gmus":[75],"quota":55,"applicants":115,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-75-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF075O1A","gmus":[75],"quota":55,"applicants":75,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-75-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF075O1M","gmus":[75],"quota":15,"applicants":63,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-75-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF075O1M","gmus":[75],"quota":15,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-75-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF075O1R","gmus":[75],"quota":20,"applicants":170,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-75-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF075O1R","gmus":[75],"quota":20,"applicants":49,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-75-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF075O2R","gmus":[75],"quota":45,"applicants":250,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-75-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF075O2R","gmus":[75],"quota":45,"applicants":61,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-75-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF075O3R","gmus":[75],"quota":30,"applicants":264,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-75-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF075O3R","gmus":[75],"quota":30,"applicants":70,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-75-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF075O4R","gmus":[75],"quota":15,"applicants":169,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-75-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF075O4R","gmus":[75],"quota":15,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-76-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF076O1M","gmus":[76],"quota":30,"applicants":78,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-76-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF076O1M","gmus":[76],"quota":30,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-76-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF076O2R","gmus":[76],"quota":220,"applicants":376,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-76-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF076O2R","gmus":[76],"quota":220,"applicants":95,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":92},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-76-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF076O3R","gmus":[76],"quota":240,"applicants":385,"year":2025,"drawCurve":[{"points":0,"pctDrawn":96},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-76-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF076O3R","gmus":[76],"quota":240,"applicants":130,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-76-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF076O4R","gmus":[76],"quota":240,"applicants":318,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-76-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF076O4R","gmus":[76],"quota":240,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-77-archery-resident-2025","species":"elk","season":"archery","residency":"resident","huntCode":"EF077O1A","gmus":[77],"quota":130,"applicants":164,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-77-archery-nonresident-2025","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF077O1A","gmus":[77],"quota":130,"applicants":257,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-77-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF077O1M","gmus":[77],"quota":30,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-77-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF077O1M","gmus":[77],"quota":30,"applicants":137,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-77-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF077O1R","gmus":[77],"quota":30,"applicants":283,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-77-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF077O1R","gmus":[77],"quota":30,"applicants":176,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-77-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF077O2R","gmus":[77],"quota":60,"applicants":430,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-77-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF077O2R","gmus":[77],"quota":60,"applicants":323,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-77-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF077O3R","gmus":[77],"quota":35,"applicants":439,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-77-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF077O3R","gmus":[77],"quota":35,"applicants":185,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-77-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF077O4R","gmus":[77],"quota":10,"applicants":239,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-77-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF077O4R","gmus":[77],"quota":10,"applicants":58,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":50},{"points":6,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-79-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF079O1M","gmus":[79],"quota":25,"applicants":19,"year":2025,"drawCurve":[{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF079O1M","gmus":[79],"quota":25,"applicants":16,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF079O1R","gmus":[79],"quota":50,"applicants":51,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF079O1R","gmus":[79],"quota":50,"applicants":54,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF079O2R","gmus":[79],"quota":100,"applicants":118,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF079O2R","gmus":[79],"quota":100,"applicants":46,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF079O3R","gmus":[79],"quota":100,"applicants":191,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-79-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF079O3R","gmus":[79],"quota":100,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":67},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF079O4R","gmus":[79],"quota":145,"applicants":103,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-79-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF079O4R","gmus":[79],"quota":145,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-80-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF080O1M","gmus":[80],"quota":70,"applicants":193,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF080O1M","gmus":[80],"quota":70,"applicants":126,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":33},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF080O2R","gmus":[80],"quota":125,"applicants":399,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":98},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF080O2R","gmus":[80],"quota":125,"applicants":70,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF080O3R","gmus":[80],"quota":100,"applicants":345,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF080O3R","gmus":[80],"quota":100,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF080O4R","gmus":[80],"quota":100,"applicants":195,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-80-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF080O4R","gmus":[80],"quota":100,"applicants":32,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-81-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF081O2R","gmus":[81],"quota":150,"applicants":576,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":98},{"points":3,"pctDrawn":91},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":80}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-81-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF081O2R","gmus":[81],"quota":150,"applicants":101,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-81-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF081O3R","gmus":[81],"quota":100,"applicants":312,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":92},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-81-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF081O3R","gmus":[81],"quota":100,"applicants":49,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-81-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF081O4R","gmus":[81],"quota":80,"applicants":191,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-81-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF081O4R","gmus":[81],"quota":80,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-82-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF082O2R","gmus":[82],"quota":200,"applicants":206,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF082O2R","gmus":[82],"quota":200,"applicants":13,"year":2025,"drawCurve":[{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF082O3R","gmus":[82],"quota":240,"applicants":189,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-82-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF082O3R","gmus":[82],"quota":240,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-85-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF085O2R","gmus":[85],"quota":50,"applicants":199,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-85-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF085O2R","gmus":[85],"quota":50,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":0},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-85-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF085O3R","gmus":[85],"quota":50,"applicants":169,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-85-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF085O3R","gmus":[85],"quota":50,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF086O2R","gmus":[86],"quota":85,"applicants":206,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF086O2R","gmus":[86],"quota":85,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-86-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF086O3R","gmus":[86],"quota":75,"applicants":144,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-86-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF086O3R","gmus":[86],"quota":75,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-131-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF131O2R","gmus":[131],"quota":100,"applicants":41,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-131-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF131O2R","gmus":[131],"quota":100,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-131-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF131O3R","gmus":[131],"quota":50,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-131-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF131O4R","gmus":[131],"quota":20,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-161-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF161O3R","gmus":[161],"quota":260,"applicants":199,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-161-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF161O3R","gmus":[161],"quota":260,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-181-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF181O2R","gmus":[181],"quota":105,"applicants":57,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-181-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF181O2R","gmus":[181],"quota":105,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-181-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF181O3R","gmus":[181],"quota":130,"applicants":102,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-181-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF181O3R","gmus":[181],"quota":130,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-181-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF181O4R","gmus":[181],"quota":155,"applicants":43,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-191-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF191O2R","gmus":[191],"quota":50,"applicants":95,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-191-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF191O2R","gmus":[191],"quota":50,"applicants":7,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-191-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF191O3R","gmus":[191],"quota":30,"applicants":97,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-191-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF191O4R","gmus":[191],"quota":20,"applicants":2,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-201-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF201O1M","gmus":[201],"quota":5,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-201-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF201O1M","gmus":[201],"quota":5,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-201-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF201O1R","gmus":[201],"quota":30,"applicants":108,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":83},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-201-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF201O1R","gmus":[201],"quota":30,"applicants":8,"year":2025,"drawCurve":[{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-201-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF201O2R","gmus":[201],"quota":45,"applicants":139,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-201-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF201O2R","gmus":[201],"quota":45,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-201-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF201O3R","gmus":[201],"quota":30,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":60},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-201-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF201O3R","gmus":[201],"quota":30,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-201-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF201O4R","gmus":[201],"quota":40,"applicants":117,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-201-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF201O4R","gmus":[201],"quota":40,"applicants":10,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-214-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF214O2R","gmus":[214],"quota":50,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF214O2R","gmus":[214],"quota":50,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF214O3R","gmus":[214],"quota":50,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF214O4R","gmus":[214],"quota":50,"applicants":16,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF214O4R","gmus":[214],"quota":50,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF231O2R","gmus":[231],"quota":125,"applicants":105,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF231O2R","gmus":[231],"quota":125,"applicants":26,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF231O3R","gmus":[231],"quota":100,"applicants":41,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF231O3R","gmus":[231],"quota":100,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF231O4R","gmus":[231],"quota":25,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-231-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF231O4R","gmus":[231],"quota":25,"applicants":2,"year":2025,"drawCurve":[{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF371O2R","gmus":[371],"quota":70,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF371O2R","gmus":[371],"quota":70,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-371-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF371O3R","gmus":[371],"quota":70,"applicants":23,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-411-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF411O2R","gmus":[411],"quota":65,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-411-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF411O2R","gmus":[411],"quota":65,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-411-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF411O3R","gmus":[411],"quota":45,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-411-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF411O3R","gmus":[411],"quota":45,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-411-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF411O4R","gmus":[411],"quota":20,"applicants":25,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF421O2R","gmus":[421],"quota":345,"applicants":223,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF421O2R","gmus":[421],"quota":345,"applicants":89,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF421O3R","gmus":[421],"quota":115,"applicants":100,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF421O3R","gmus":[421],"quota":115,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF421O4R","gmus":[421],"quota":30,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-421-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF421O4R","gmus":[421],"quota":30,"applicants":3,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF444O2R","gmus":[444],"quota":170,"applicants":150,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF444O2R","gmus":[444],"quota":170,"applicants":32,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF444O3R","gmus":[444],"quota":120,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF444O3R","gmus":[444],"quota":120,"applicants":36,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF444O4R","gmus":[444],"quota":30,"applicants":37,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-444-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF444O4R","gmus":[444],"quota":30,"applicants":7,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-471-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF471O2R","gmus":[471],"quota":40,"applicants":18,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-471-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF471O3R","gmus":[471],"quota":10,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-481-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF481O1M","gmus":[481],"quota":35,"applicants":73,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-481-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF481O1M","gmus":[481],"quota":35,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-481-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF481O2R","gmus":[481],"quota":80,"applicants":210,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-481-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF481O2R","gmus":[481],"quota":80,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-481-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF481O3R","gmus":[481],"quota":40,"applicants":120,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-481-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF481O3R","gmus":[481],"quota":40,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-481-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF481O4R","gmus":[481],"quota":20,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-500-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF500O1M","gmus":[500],"quota":85,"applicants":194,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF500O1M","gmus":[500],"quota":85,"applicants":27,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF500O2R","gmus":[500],"quota":195,"applicants":366,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF500O2R","gmus":[500],"quota":195,"applicants":30,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF500O3R","gmus":[500],"quota":170,"applicants":259,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":86},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF500O3R","gmus":[500],"quota":170,"applicants":17,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-500-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF500O4R","gmus":[500],"quota":20,"applicants":111,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-500-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF500O4R","gmus":[500],"quota":20,"applicants":1,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-501-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF501O1M","gmus":[501],"quota":40,"applicants":131,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-501-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF501O1M","gmus":[501],"quota":40,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-501-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF501O2R","gmus":[501],"quota":50,"applicants":339,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":67},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-501-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF501O2R","gmus":[501],"quota":50,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-501-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF501O3R","gmus":[501],"quota":50,"applicants":273,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":90},{"points":2,"pctDrawn":71},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-501-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF501O3R","gmus":[501],"quota":50,"applicants":13,"year":2025,"drawCurve":[{"points":2,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-501-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF501O4R","gmus":[501],"quota":20,"applicants":148,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-511-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF511O1R","gmus":[511],"quota":30,"applicants":142,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-511-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF511O1R","gmus":[511],"quota":30,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-511-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF511O2R","gmus":[511],"quota":60,"applicants":221,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-511-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF511O2R","gmus":[511],"quota":60,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-511-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF511O3R","gmus":[511],"quota":30,"applicants":128,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-511-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF511O4R","gmus":[511],"quota":10,"applicants":61,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-521-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF521O1M","gmus":[521],"quota":20,"applicants":53,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-521-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF521O1M","gmus":[521],"quota":20,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-521-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF521O1R","gmus":[521],"quota":40,"applicants":102,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-521-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF521O1R","gmus":[521],"quota":40,"applicants":70,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-521-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF521O2R","gmus":[521],"quota":20,"applicants":144,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-521-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF521O2R","gmus":[521],"quota":20,"applicants":63,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-521-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF521O3R","gmus":[521],"quota":20,"applicants":74,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-521-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF521O3R","gmus":[521],"quota":20,"applicants":24,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-521-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF521O4R","gmus":[521],"quota":10,"applicants":23,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-521-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF521O4R","gmus":[521],"quota":10,"applicants":8,"year":2025,"drawCurve":[{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-551-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF551O1M","gmus":[551],"quota":60,"applicants":101,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":50},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-551-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF551O1M","gmus":[551],"quota":60,"applicants":52,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-551-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EF551O1R","gmus":[551],"quota":60,"applicants":164,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-551-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EF551O1R","gmus":[551],"quota":60,"applicants":35,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":67},{"points":3,"pctDrawn":25},{"points":4,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF551O2R","gmus":[551],"quota":90,"applicants":339,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":96},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF551O2R","gmus":[551],"quota":90,"applicants":90,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF551O3R","gmus":[551],"quota":70,"applicants":286,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF551O3R","gmus":[551],"quota":70,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF551O4R","gmus":[551],"quota":10,"applicants":65,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-551-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF551O4R","gmus":[551],"quota":10,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-561-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF561O1M","gmus":[561],"quota":25,"applicants":42,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-561-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EF561O1M","gmus":[561],"quota":25,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-561-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF561O2R","gmus":[561],"quota":30,"applicants":112,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":94},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-561-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF561O2R","gmus":[561],"quota":30,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-561-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF561O3R","gmus":[561],"quota":30,"applicants":59,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-561-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF561O3R","gmus":[561],"quota":30,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-561-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF561O4R","gmus":[561],"quota":20,"applicants":34,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-561-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF561O4R","gmus":[561],"quota":20,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-682-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EF682O1M","gmus":[682],"quota":10,"applicants":9,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-711-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EF711O2R","gmus":[711],"quota":10,"applicants":217,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-711-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF711O2R","gmus":[711],"quota":10,"applicants":73,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-711-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF711O3R","gmus":[711],"quota":10,"applicants":298,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-711-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF711O3R","gmus":[711],"quota":10,"applicants":82,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-711-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF711O4R","gmus":[711],"quota":10,"applicants":156,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-711-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF711O4R","gmus":[711],"quota":10,"applicants":24,"year":2025,"drawCurve":[{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":5,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-741-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EF741O2R","gmus":[741],"quota":10,"applicants":4,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-741-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EF741O3R","gmus":[741],"quota":10,"applicants":15,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-741-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EF741O3R","gmus":[741],"quota":10,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-741-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EF741O4R","gmus":[741],"quota":10,"applicants":5,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-741-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EF741O4R","gmus":[741],"quota":10,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-4-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM004O4R","gmus":[4],"quota":50,"applicants":74,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-4-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM004O4R","gmus":[4],"quota":50,"applicants":114,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":75},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-5-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM005O4R","gmus":[5],"quota":10,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-5-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM005O4R","gmus":[5],"quota":10,"applicants":23,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM007O1R","gmus":[7],"quota":300,"applicants":767,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":99},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-7-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM007O1R","gmus":[7],"quota":300,"applicants":204,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":69},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-9-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM009O1R","gmus":[9],"quota":50,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-9-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM009O1R","gmus":[9],"quota":50,"applicants":8,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-9-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EM009O2R","gmus":[9],"quota":40,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-9-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EM009O3R","gmus":[9],"quota":40,"applicants":17,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-9-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EM009O3R","gmus":[9],"quota":40,"applicants":6,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-9-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM009O4R","gmus":[9],"quota":40,"applicants":10,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM012O4R","gmus":[12],"quota":500,"applicants":128,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-12-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM012O4R","gmus":[12],"quota":500,"applicants":243,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-19-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM019O1R","gmus":[19],"quota":120,"applicants":247,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-19-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM019O1R","gmus":[19],"quota":120,"applicants":68,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-20-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM020O1R","gmus":[20],"quota":25,"applicants":254,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":80},{"points":8,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-20-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM020O1R","gmus":[20],"quota":25,"applicants":85,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":100},{"points":19,"pctDrawn":100},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":18}]},{"id":"E-26-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM026O4R","gmus":[26],"quota":100,"applicants":10,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-26-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM026O4R","gmus":[26],"quota":100,"applicants":38,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-48-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM048O1R","gmus":[48],"quota":50,"applicants":204,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":92},{"points":6,"pctDrawn":100},{"points":8,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-48-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM048O1R","gmus":[48],"quota":50,"applicants":109,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":20},{"points":9,"pctDrawn":33},{"points":10,"pctDrawn":33},{"points":11,"pctDrawn":0},{"points":16,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-49-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM049O1R","gmus":[49],"quota":80,"applicants":702,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":100},{"points":11,"pctDrawn":78},{"points":12,"pctDrawn":92},{"points":13,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":19,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":10}]},{"id":"E-49-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM049O1R","gmus":[49],"quota":80,"applicants":254,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":100},{"points":20,"pctDrawn":100},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":19}]},{"id":"E-50-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM050O1R","gmus":[50],"quota":30,"applicants":189,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-50-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM050O1R","gmus":[50],"quota":30,"applicants":29,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":3}]},{"id":"E-56-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM056O1R","gmus":[56],"quota":40,"applicants":105,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":91},{"points":5,"pctDrawn":100},{"points":14,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-56-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM056O1R","gmus":[56],"quota":40,"applicants":39,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-68-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM068O1R","gmus":[68],"quota":375,"applicants":466,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":95},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-68-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM068O1R","gmus":[68],"quota":375,"applicants":367,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":96},{"points":2,"pctDrawn":83},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-69-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM069O1R","gmus":[69],"quota":75,"applicants":566,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":78},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":100},{"points":12,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":5}]},{"id":"E-69-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM069O1R","gmus":[69],"quota":75,"applicants":178,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":80},{"points":10,"pctDrawn":67},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":100},{"points":14,"pctDrawn":100},{"points":15,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":8}]},{"id":"E-76-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM076O1R","gmus":[76],"quota":190,"applicants":1124,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":100},{"points":10,"pctDrawn":95},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":75},{"points":14,"pctDrawn":100},{"points":17,"pctDrawn":100},{"points":18,"pctDrawn":100},{"points":19,"pctDrawn":100},{"points":20,"pctDrawn":100},{"points":21,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":9}]},{"id":"E-76-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM076O1R","gmus":[76],"quota":190,"applicants":561,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":90},{"points":23,"pctDrawn":71},{"points":24,"pctDrawn":71},{"points":25,"pctDrawn":100},{"points":26,"pctDrawn":100},{"points":27,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":21}]},{"id":"E-80-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM080O1R","gmus":[80],"quota":450,"applicants":1050,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":94},{"points":2,"pctDrawn":84},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":83},{"points":5,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-80-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM080O1R","gmus":[80],"quota":450,"applicants":1094,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":80},{"points":4,"pctDrawn":83},{"points":5,"pctDrawn":62},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":100},{"points":13,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-104-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EM104O2R","gmus":[104],"quota":40,"applicants":14,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-104-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EM104O3R","gmus":[104],"quota":30,"applicants":4,"year":2025,"drawCurve":[{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-104-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM104O4R","gmus":[104],"quota":20,"applicants":12,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-104-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM104O4R","gmus":[104],"quota":20,"applicants":1,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-133-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM133O4R","gmus":[133],"quota":30,"applicants":47,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":7,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-133-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM133O4R","gmus":[133],"quota":30,"applicants":14,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-191-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM191O1R","gmus":[191],"quota":50,"applicants":79,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-191-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM191O1R","gmus":[191],"quota":50,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM214O1R","gmus":[214],"quota":50,"applicants":33,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":3,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-214-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM214O1R","gmus":[214],"quota":50,"applicants":45,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-391-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EM391O2R","gmus":[391],"quota":20,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-391-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EM391O2R","gmus":[391],"quota":20,"applicants":1,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-391-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EM391O3R","gmus":[391],"quota":10,"applicants":31,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":0}]},{"id":"E-391-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM391O4R","gmus":[391],"quota":10,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":100},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":null}]},{"id":"E-481-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM481O1R","gmus":[481],"quota":65,"applicants":168,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":11,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-481-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM481O1R","gmus":[481],"quota":65,"applicants":121,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":80}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-500-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM500O1R","gmus":[500],"quota":75,"applicants":274,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":100},{"points":5,"pctDrawn":100},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":60},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":4}]},{"id":"E-500-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM500O1R","gmus":[500],"quota":75,"applicants":128,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":50},{"points":10,"pctDrawn":50},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":7}]},{"id":"E-501-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM501O1R","gmus":[501],"quota":25,"applicants":242,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":8,"pctDrawn":100},{"points":9,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":6}]},{"id":"E-501-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM501O1R","gmus":[501],"quota":25,"applicants":101,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":100},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":100},{"points":16,"pctDrawn":100},{"points":17,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":11}]},{"id":"E-561-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM561O1R","gmus":[561],"quota":30,"applicants":92,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":100},{"points":2,"pctDrawn":100},{"points":5,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":1}]},{"id":"E-561-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM561O1R","gmus":[561],"quota":30,"applicants":21,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":25},{"points":4,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-851-muzzleloader-resident-2025","species":"elk","season":"muzzleloader","residency":"resident","huntCode":"EM851O1M","gmus":[851],"quota":5,"applicants":11,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":100},{"points":3,"pctDrawn":100},{"points":7,"pctDrawn":100},{"points":10,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":2}]},{"id":"E-851-muzzleloader-nonresident-2025","species":"elk","season":"muzzleloader","residency":"nonresident","huntCode":"EM851O1M","gmus":[851],"quota":5,"applicants":15,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":22,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":22}]},{"id":"E-851-first_rifle-resident-2025","species":"elk","season":"first_rifle","residency":"resident","huntCode":"EM851O1R","gmus":[851],"quota":5,"applicants":50,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":33},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":100},{"points":18,"pctDrawn":100},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":13}]},{"id":"E-851-first_rifle-nonresident-2025","species":"elk","season":"first_rifle","residency":"nonresident","huntCode":"EM851O1R","gmus":[851],"quota":5,"applicants":14,"year":2025,"drawCurve":[{"points":1,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":23}]},{"id":"E-851-second_rifle-resident-2025","species":"elk","season":"second_rifle","residency":"resident","huntCode":"EM851O2R","gmus":[851],"quota":5,"applicants":37,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":50},{"points":15,"pctDrawn":100},{"points":17,"pctDrawn":0},{"points":20,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":15}]},{"id":"E-851-second_rifle-nonresident-2025","species":"elk","season":"second_rifle","residency":"nonresident","huntCode":"EM851O2R","gmus":[851],"quota":5,"applicants":11,"year":2025,"drawCurve":[{"points":4,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":29,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":29}]},{"id":"E-851-third_rifle-resident-2025","species":"elk","season":"third_rifle","residency":"resident","huntCode":"EM851O3R","gmus":[851],"quota":5,"applicants":64,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":50},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":100},{"points":19,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":18}]},{"id":"E-851-third_rifle-nonresident-2025","species":"elk","season":"third_rifle","residency":"nonresident","huntCode":"EM851O3R","gmus":[851],"quota":5,"applicants":22,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":26,"pctDrawn":100}],"priorMinPoints":[{"year":2025,"minPoints":26}]},{"id":"E-851-fourth_rifle-resident-2025","species":"elk","season":"fourth_rifle","residency":"resident","huntCode":"EM851O4R","gmus":[851],"quota":5,"applicants":86,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":12},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":100},{"points":21,"pctDrawn":100},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":100},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":0},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":30,"pctDrawn":0},{"points":31,"pctDrawn":0},{"points":32,"pctDrawn":0},{"points":33,"pctDrawn":0},{"points":34,"pctDrawn":0},{"points":35,"pctDrawn":0},{"points":37,"pctDrawn":0},{"points":38,"pctDrawn":0},{"points":39,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":21}]},{"id":"E-851-fourth_rifle-nonresident-2025","species":"elk","season":"fourth_rifle","residency":"nonresident","huntCode":"EM851O4R","gmus":[851],"quota":5,"applicants":19,"year":2025,"drawCurve":[{"points":0,"pctDrawn":0},{"points":0,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":1,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":2,"pctDrawn":0},{"points":3,"pctDrawn":0},{"points":4,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":5,"pctDrawn":0},{"points":6,"pctDrawn":0},{"points":7,"pctDrawn":0},{"points":8,"pctDrawn":0},{"points":9,"pctDrawn":0},{"points":10,"pctDrawn":0},{"points":11,"pctDrawn":0},{"points":12,"pctDrawn":0},{"points":13,"pctDrawn":0},{"points":14,"pctDrawn":0},{"points":15,"pctDrawn":0},{"points":16,"pctDrawn":0},{"points":17,"pctDrawn":0},{"points":18,"pctDrawn":0},{"points":19,"pctDrawn":0},{"points":20,"pctDrawn":0},{"points":21,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":22,"pctDrawn":0},{"points":23,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":24,"pctDrawn":0},{"points":25,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":26,"pctDrawn":0},{"points":27,"pctDrawn":100},{"points":27,"pctDrawn":100},{"points":28,"pctDrawn":0},{"points":29,"pctDrawn":0},{"points":30,"pctDrawn":0},{"points":31,"pctDrawn":0},{"points":32,"pctDrawn":0},{"points":33,"pctDrawn":0},{"points":34,"pctDrawn":0},{"points":35,"pctDrawn":0}],"priorMinPoints":[{"year":2025,"minPoints":27}]},{"id":"OTC-87-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE087U1A","gmus":[87],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-87-archery-nonresident-2026","species":"elk","season":"archery","residency":"nonresident","huntCode":"EE087U1A","gmus":[87],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-133-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EF133U1A","gmus":[133],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-133-archery-nonresident-2026","species":"elk","season":"archery","residency":"nonresident","huntCode":"EF133U1A","gmus":[133],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-6-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE006U1A","gmus":[6],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-15-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE015U1A","gmus":[15],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-16-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE016U1A","gmus":[16],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-17-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE017U1A","gmus":[17],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-18-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE018U1A","gmus":[18],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-21-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE021U1A","gmus":[21],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-22-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE022U1A","gmus":[22],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-27-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE027U1A","gmus":[27],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-28-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE028U1A","gmus":[28],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-30-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE030U1A","gmus":[30],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-31-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE031U1A","gmus":[31],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-32-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE032U1A","gmus":[32],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-35-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE035U1A","gmus":[35],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-36-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE036U1A","gmus":[36],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-37-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE037U1A","gmus":[37],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-38-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE038U1A","gmus":[38],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-43-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE043U1A","gmus":[43],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-53-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE053U1A","gmus":[53],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-59-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE059U1A","gmus":[59],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-60-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE060U1A","gmus":[60],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-62-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE062U1A","gmus":[62],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-63-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE063U1A","gmus":[63],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-64-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE064U1A","gmus":[64],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-65-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE065U1A","gmus":[65],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-68-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE068U1A","gmus":[68],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-79-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE079U1A","gmus":[79],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-82-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE082U1A","gmus":[82],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}],"note":"Public lands only."},{"id":"OTC-83-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE083U1A","gmus":[83],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-85-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE085U1A","gmus":[85],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-86-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE086U1A","gmus":[86],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-88-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE088U1A","gmus":[88],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-89-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE089U1A","gmus":[89],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-90-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE090U1A","gmus":[90],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-91-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE091U1A","gmus":[91],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-92-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE092U1A","gmus":[92],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-93-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE093U1A","gmus":[93],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-94-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE094U1A","gmus":[94],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-95-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE095U1A","gmus":[95],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-96-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE096U1A","gmus":[96],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-97-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE097U1A","gmus":[97],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-98-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE098U1A","gmus":[98],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-99-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE099U1A","gmus":[99],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-100-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE100U1A","gmus":[100],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-101-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE101U1A","gmus":[101],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-102-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE102U1A","gmus":[102],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-103-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE103U1A","gmus":[103],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-105-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE105U1A","gmus":[105],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-106-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE106U1A","gmus":[106],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-107-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE107U1A","gmus":[107],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-109-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE109U1A","gmus":[109],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-110-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE110U1A","gmus":[110],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-111-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE111U1A","gmus":[111],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-112-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE112U1A","gmus":[112],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-113-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE113U1A","gmus":[113],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-114-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE114U1A","gmus":[114],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-115-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE115U1A","gmus":[115],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-116-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE116U1A","gmus":[116],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-117-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE117U1A","gmus":[117],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-118-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE118U1A","gmus":[118],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-119-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE119U1A","gmus":[119],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-120-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE120U1A","gmus":[120],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-121-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE121U1A","gmus":[121],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-122-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE122U1A","gmus":[122],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-123-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE123U1A","gmus":[123],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-124-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE124U1A","gmus":[124],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-125-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE125U1A","gmus":[125],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-126-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE126U1A","gmus":[126],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-127-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE127U1A","gmus":[127],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-128-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE128U1A","gmus":[128],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-129-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE129U1A","gmus":[129],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-130-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE130U1A","gmus":[130],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-131-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE131U1A","gmus":[131],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-132-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE132U1A","gmus":[132],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-134-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE134U1A","gmus":[134],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-135-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE135U1A","gmus":[135],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-136-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE136U1A","gmus":[136],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-137-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE137U1A","gmus":[137],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-138-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE138U1A","gmus":[138],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-139-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE139U1A","gmus":[139],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-140-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE140U1A","gmus":[140],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-141-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE141U1A","gmus":[141],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-142-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE142U1A","gmus":[142],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-143-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE143U1A","gmus":[143],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-144-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE144U1A","gmus":[144],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-145-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE145U1A","gmus":[145],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-146-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE146U1A","gmus":[146],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-147-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE147U1A","gmus":[147],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-161-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE161U1A","gmus":[161],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-171-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE171U1A","gmus":[171],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-181-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE181U1A","gmus":[181],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-211-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE211U1A","gmus":[211],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-231-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE231U1A","gmus":[231],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-301-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE301U1A","gmus":[301],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-361-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE361U1A","gmus":[361],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-371-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE371U1A","gmus":[371],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-431-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE431U1A","gmus":[431],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-471-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE471U1A","gmus":[471],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-511-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE511U1A","gmus":[511],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-581-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE581U1A","gmus":[581],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-591-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE591U1A","gmus":[591],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-681-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE681U1A","gmus":[681],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-691-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE691U1A","gmus":[691],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-861-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE861U1A","gmus":[861],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]},{"id":"OTC-951-archery-resident-2026","species":"elk","season":"archery","residency":"resident","huntCode":"EE951U1A","gmus":[951],"quota":"Unlimited","applicants":"N/A","year":2026,"drawCurve":[{"points":0,"pctDrawn":100}],"priorMinPoints":[{"year":2026,"minPoints":0}]}];

const DRAW_SEASON_LABELS = {
  archery: "Archery", muzzleloader: "Muzzleloader", first_rifle: "First Rifle",
  second_rifle: "Second Rifle", third_rifle: "Third Rifle", fourth_rifle: "Fourth Rifle"
};

// The Draw Recap PDF only lists the LOWEST-numbered GMU embedded in a
// hunt code — it doesn't say when a code actually covers a group of
// units. The real grouping lives in CPW's Big Game Brochure. Most of the
// entries below were extracted from a brochure hunt-code export where a
// unit list appeared directly and unambiguously next to that exact hunt
// code (no guessing, no cross-referencing "see unit X" hints — those
// turned out to bleed unrelated hunt codes together and were discarded).
// That source's raw text is OCR'd and inconsistently captured per row, so
// this covers a meaningful subset, not every grouped hunt code that
// exists — add more by hand as they're confirmed, same as before.
//
// Key = species char + GMU(3) + season(2) + manner(1), with the SEX
// character stripped (position 1) since grouping doesn't depend on
// sex — "E-E-021-V1-A" and "E-F-021-V1-A" both normalize to the same
// key and share the same group.
const HUNT_CODE_GMU_GROUPS = {
  "E003V1A": [3, 301],
  "E004O1A": [4, 5, 441],
  "E007O1A": [7, 8, 9, 19, 191],
  "E007O3R": [7, 8],
  "E011V1A": [11, 13, 131, 211],
  "E012O1A": [12, 23, 24],
  "E014O1M": [3, 14, 301],
  "E014V1A": [14, 214],
  "E015O1M": [4, 5, 15, 441],
  "E015V1A": [15, 27],
  "E018O1R": [18, 181],
  "E020O3R": [14, 20, 214],
  "E021V1A": [21, 22, 30, 31, 32],
  "E025V1A": [25, 26, 34, 231],
  "E028V1A": [28, 37, 371],
  "E029O1M": [15, 27, 29],
  "E033O1A": [3, 4, 5, 14, 23, 24, 33, 214],
  "E033O1M": [7, 8, 9, 19, 33, 191],
  "E035O1M": [21, 22, 30, 31, 32, 35],
  "E035V1A": [35, 36, 361],
  "E038O1M": [12, 23, 24, 38],
  "E041O1A": [41, 42, 421],
  "E041O1M": [41, 42, 52, 411, 421],
  "E044O1A": [44, 45, 47, 444],
  "E046O1A": [25, 26, 33, 34, 46],
  "E050O4R": [43, 50, 431],
  "E052O1A": [52, 411],
  "E055O4R": [43, 55, 431],
  "E057O1A": [57, 58],
  "E064O1R": [59, 64, 581],
  "E064V1A": [64, 65],
  "E068V1A": [68, 681],
  "E069O1A": [69, 84],
  "E069O3R": [69, 84],
  "E074O1R": [74, 741],
  "E080O1A": [80, 81],
  "E085O1M": [85, 140, 851],
  "E085V1A": [85, 140, 851],
  "E086O1M": [57, 58, 86],
  "E133O1M": [133, 134, 141, 142],
  "E191O3R": [11, 12, 13, 191],
  "E391O1M": [74, 391, 741],
  "E461O1A": [11, 12, 13, 23, 24, 461],
  "E461O2R": [131, 211, 391, 461],
  "E461O4R": [39, 391, 461],
  "E481O1M": [80, 81, 481],
  "E551O1M": [86, 551, 691, 861],
  "E682O1M": [82, 682, 791],
  "E682V1A": [682, 791]
};

function getHuntCodeGroupKey(huntCode) {
  return huntCode[0] + huntCode.slice(2);
}

// The full set of GMUs a record actually applies to — the group
// override if one is confirmed, otherwise just the single embedded
// GMU as parsed from the PDF.
function getEffectiveGMUs(record) {
  const key = getHuntCodeGroupKey(record.huntCode);
  return HUNT_CODE_GMU_GROUPS[key] || record.gmus;
}

let appMode = "scout";

function getOddsAtPoints(record, points) {
  const curve = record.drawCurve;
  let best = curve[0];
  for (const entry of curve) {
    if (entry.points <= points) best = entry;
  }
  if (points >= curve[curve.length - 1].points) return curve[curve.length - 1].pctDrawn;
  return best.pctDrawn;
}

// Whether a hunt code is genuinely Over-The-Counter (buy anytime, no real
// draw competition) can't be told apart from a plain "guaranteed" limited
// draw using only the numbers in the Draw Recap PDF — both show 100% at
// every point level. That distinction lives in CPW's Big Game Brochure
// license-type listings. Two came from the brochure hunt-code export's
// own "Unlimited OTC" classification (87, 133). The rest of this list came
// directly from the user as a known-current list of resident archery OTC
// units. Nine units on that list (3, 11, 13, 14, 25, 26, 34, 214, 851)
// were deliberately left OUT despite being on it, because both the 2025
// Draw Recap and the brochure hunt-code export show real, competitive
// limited-draw numbers for them (e.g. unit 851: 48 applicants for 8
// tags) — that's a genuine conflict between sources that needs a human
// to resolve, not something to silently overwrite.
//
// The Draw Recap itself never contains true OTC hunt codes at all (there's
// no draw to report), so matching records for all of these had to be
// added by hand to SAMPLE_DRAW_DATA too, marked 2026. Unit 82 is public
// land only; unit 851's SWA exception isn't representable at this
// granularity and is part of why it was excluded above.
// Key = same normalized form as getHuntCodeGroupKey (sex character stripped).
const OTC_HUNT_CODES = new Set([
  "E087U1A", // GMU 87, archery, either-sex — confirmed "Unlimited OTC"
  "E133U1A", // GMU 133, archery, cow — confirmed "Unlimited OTC"
  "E006U1A",
  "E015U1A",
  "E016U1A",
  "E017U1A",
  "E018U1A",
  "E021U1A",
  "E022U1A",
  "E027U1A",
  "E028U1A",
  "E030U1A",
  "E031U1A",
  "E032U1A",
  "E035U1A",
  "E036U1A",
  "E037U1A",
  "E038U1A",
  "E043U1A",
  "E053U1A",
  "E059U1A",
  "E060U1A",
  "E062U1A",
  "E063U1A",
  "E064U1A",
  "E065U1A",
  "E068U1A",
  "E079U1A",
  "E082U1A",
  "E083U1A",
  "E085U1A",
  "E086U1A",
  "E088U1A",
  "E089U1A",
  "E090U1A",
  "E091U1A",
  "E092U1A",
  "E093U1A",
  "E094U1A",
  "E095U1A",
  "E096U1A",
  "E097U1A",
  "E098U1A",
  "E099U1A",
  "E100U1A",
  "E101U1A",
  "E102U1A",
  "E103U1A",
  "E105U1A",
  "E106U1A",
  "E107U1A",
  "E109U1A",
  "E110U1A",
  "E111U1A",
  "E112U1A",
  "E113U1A",
  "E114U1A",
  "E115U1A",
  "E116U1A",
  "E117U1A",
  "E118U1A",
  "E119U1A",
  "E120U1A",
  "E121U1A",
  "E122U1A",
  "E123U1A",
  "E124U1A",
  "E125U1A",
  "E126U1A",
  "E127U1A",
  "E128U1A",
  "E129U1A",
  "E130U1A",
  "E131U1A",
  "E132U1A",
  "E134U1A",
  "E135U1A",
  "E136U1A",
  "E137U1A",
  "E138U1A",
  "E139U1A",
  "E140U1A",
  "E141U1A",
  "E142U1A",
  "E143U1A",
  "E144U1A",
  "E145U1A",
  "E146U1A",
  "E147U1A",
  "E161U1A",
  "E171U1A",
  "E181U1A",
  "E211U1A",
  "E231U1A",
  "E301U1A",
  "E361U1A",
  "E371U1A",
  "E431U1A",
  "E471U1A",
  "E511U1A",
  "E581U1A",
  "E591U1A",
  "E681U1A",
  "E691U1A",
  "E861U1A",
  "E951U1A"
]);

function isOTC(record) {
  // Nonresidents don't have OTC archery access under the current system —
  // any access there is through a real hunt code, even a favorable one.
  if (record.residency === "nonresident" && record.season === "archery") return false;
  return OTC_HUNT_CODES.has(getHuntCodeGroupKey(record.huntCode));
}

function categorizeOdds(pct, record) {
  if (record && pct >= 100 && isOTC(record)) return { label: "OTC", color: "#40916C" };
  if (pct >= 100) return { label: "Guaranteed", color: "#2D6A4F" };
  if (pct >= 60) return { label: `${pct}% Likely`, color: "#74C69D" };
  if (pct >= 25) return { label: `${pct}% Possible`, color: "#D9A441" };
  if (pct >= 1) return { label: `${pct}% Long Shot`, color: "#BC4B51" };
  return { label: "0% Unlikely", color: "#7B2D26" };
}

function getMinPointsFor100(record) {
  const hit = record.drawCurve.find(e => e.pctDrawn >= 100);
  return hit ? hit.points : null;
}

function getDrawTrend(record) {
  const pts = record.priorMinPoints;
  if (!pts || pts.length < 2) return { arrow: "—", cls: "trendFlat" };
  const first = pts[0].minPoints, last = pts[pts.length - 1].minPoints;
  if (last > first) return { arrow: `▲ rising (${first}→${last})`, cls: "trendUp" };
  if (last < first) return { arrow: `▼ easing (${first}→${last})`, cls: "trendDown" };
  return { arrow: `— stable (${last})`, cls: "trendFlat" };
}

const planSpeciesSelect = document.getElementById("planSpeciesSelect");
const planSeasonSelect = document.getElementById("planSeasonSelect");
const residencySelect = document.getElementById("residencySelect");
const pointsSlider = document.getElementById("pointsSlider");
const pointsValue = document.getElementById("pointsValue");
const sortSelect = document.getElementById("sortSelect");
const drawTableBody = document.getElementById("drawTableBody");
const leftInfoPanel = document.getElementById("leftInfoPanel");
const leftInfoPanelBody = document.getElementById("leftInfoPanelBody");
const tileGuaranteed = document.getElementById("tileGuaranteed");
const tileLikely = document.getElementById("tileLikely");
const tileTotal = document.getElementById("tileTotal");
const tileAvgPoints = document.getElementById("tileAvgPoints");

function getFilteredDrawData() {
  const species = planSpeciesSelect.value;
  const season = planSeasonSelect.value;
  const residency = residencySelect.value;
  return SAMPLE_DRAW_DATA.filter(r => r.species === species && r.season === season && r.residency === residency);
}

function hasValidPlanSelection() {
  return planSpeciesSelect.value !== "" && planSeasonSelect.value !== "";
}

function sortDrawData(data, points) {
  const mode = sortSelect.value;
  const withOdds = data.map(r => ({ record: r, odds: getOddsAtPoints(r, points) }));
  withOdds.sort((a, b) => {
    if (mode === "odds_desc") return b.odds - a.odds;
    if (mode === "odds_asc") return a.odds - b.odds;
    if (mode === "unit_asc") return getEffectiveGMUs(a.record)[0] - getEffectiveGMUs(b.record)[0];
    if (mode === "applicants_desc") return b.record.applicants - a.record.applicants;
    return 0;
  });
  return withOdds;
}

// Builds a lookup from GMU number (string) -> {record, odds} for the
// current species/season/residency/points selection. A GMU with no
// matching hunt code (not applicable to this season, or simply not in
// the sample set yet) is left out and rendered as "no data" gray.
// Uses getEffectiveGMUs so grouped hunt codes color every member unit,
// not just the single GMU number embedded in the hunt code.
function buildUnitOddsMap(points) {
  const filtered = getFilteredDrawData();
  const map = {};
  filtered.forEach(record => {
    const odds = getOddsAtPoints(record, points);
    getEffectiveGMUs(record).forEach(g => { map[String(g)] = { record, odds }; });
  });
  return map;
}

// Units stay outlined like the Scout Tool's normal look until the
// person has actually chosen a species and season — jumping straight
// to a wall of gray "no data" units before any real input felt like
// something was broken rather than just waiting for a selection.
function applyDrawOddsStyling() {
  if (!hasValidPlanSelection() || SAMPLE_DRAW_DATA.length === 0) {
    restoreScoutStyling();
    return;
  }
  const points = Number(pointsSlider.value);
  const unitOdds = buildUnitOddsMap(points);
  Object.keys(unitLayers).forEach(unit => {
    const layer = unitLayers[unit];
    const entry = unitOdds[unit];
    if (entry) {
      const cat = categorizeOdds(entry.odds, entry.record);
      if (cat.label === "OTC") {
        // Dashed border is reserved for confirmed OTC units specifically —
        // using it for grouped hunt codes too was confusing since a unit
        // can be "Possible" (also amber-ish) and grouped at the same time.
        layer.setStyle({ color: "#D9A441", weight: 2, dashArray: "5,4", fillColor: cat.color, fillOpacity: 0.55 });
      } else {
        layer.setStyle({ color: "#1B4332", weight: 1, dashArray: null, fillColor: cat.color, fillOpacity: 0.55 });
      }
    } else {
      layer.setStyle({ color: "#999999", weight: 1, dashArray: null, fillColor: "#cccccc", fillOpacity: 0.25 });
    }
  });
}

// Persists across mode switches — set via "Highlight These Units in
// Scout Tool" in a draw detail popover, cleared via the badge's Clear
// button. Distinct from selectedLayer (the single unit picked in the
// Scout Tool dropdown) since a hunt code can cover several GMUs at
// once.
let highlightedHuntCodeUnits = null;
let highlightedHuntCodeLabel = null;

function huntCodeHighlightStyle() {
  return { color: "#D9A441", weight: 3, fillColor: "#D9A441", fillOpacity: 0.25, dashArray: "6,4" };
}

function restoreScoutStyling() {
  Object.keys(unitLayers).forEach(unit => {
    unitLayers[unit].setStyle(defaultStyle());
  });
  if (highlightedHuntCodeUnits) {
    highlightedHuntCodeUnits.forEach(unit => {
      if (unitLayers[unit]) {
        unitLayers[unit].setStyle(huntCodeHighlightStyle());
        unitLayers[unit].bringToFront();
      }
    });
  }
  if (selectedLayer) selectedLayer.setStyle(selectedStyle());
}

function updateHuntCodeBadge() {
  const badge = document.getElementById("huntCodeBadge");
  const text = document.getElementById("huntCodeBadgeText");
  if (highlightedHuntCodeUnits && appMode === "scout") {
    text.textContent = `${highlightedHuntCodeLabel}: Units ${highlightedHuntCodeUnits.join(", ")}`;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

window.scoutiqUseHuntCode = function (recordId) {
  const record = SAMPLE_DRAW_DATA.find(r => r.id === recordId);
  if (!record) return;
  highlightedHuntCodeUnits = getEffectiveGMUs(record).map(String);
  highlightedHuntCodeLabel = `${record.huntCode} — ${DRAW_SEASON_LABELS[record.season]}`;
  leftInfoPanel.style.display = "none";
  setAppMode("scout");
};

// Zoom to a single unit within a grouped hunt code's list, without losing
// the rest of the group's outline/emphasis.
window.scoutiqFocusUnit = function (unitNumber) {
  const layer = unitLayers[unitNumber];
  if (!layer) return;
  const isNarrow = window.innerWidth < 640;
  const pad = isNarrow ? [40, 40] : [80, 80];
  map.flyToBounds(layer.getBounds(), {
    paddingTopLeft: pad,
    paddingBottomRight: pad,
    maxZoom: 12,
    duration: 1.0
  });
};

document.getElementById("clearHuntCodeBtn").addEventListener("click", function () {
  highlightedHuntCodeUnits = null;
  highlightedHuntCodeLabel = null;
  updateHuntCodeBadge();
  restoreScoutStyling();
});

function renderDrawTable() {
  const planPrompt = document.getElementById("planPrompt");
  const summaryTiles = document.getElementById("summaryTiles");
  const tableWrap = document.getElementById("tableWrap");
  if (!hasValidPlanSelection()) {
    planPrompt.textContent = "Select a species and season above to see draw odds by unit.";
    planPrompt.style.display = "block";
    summaryTiles.style.display = "none";
    tableWrap.style.display = "none";
    drawTableBody.innerHTML = "";
    return;
  }
  if (SAMPLE_DRAW_DATA.length === 0) {
    planPrompt.textContent = "Loading unit data...";
    planPrompt.style.display = "block";
    summaryTiles.style.display = "none";
    tableWrap.style.display = "none";
    drawTableBody.innerHTML = "";
    return;
  }
  planPrompt.style.display = "none";
  summaryTiles.style.display = "grid";
  tableWrap.style.display = "block";
  const points = Number(pointsSlider.value);
  const filtered = getFilteredDrawData();
  const sorted = sortDrawData(filtered, points);
  drawTableBody.innerHTML = "";
  sorted.forEach(({ record, odds }) => {
    const cat = categorizeOdds(odds, record);
    const trend = getDrawTrend(record);
    const minPoints = getMinPointsFor100(record);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${getEffectiveGMUs(record).join(", ")}</td>
      <td>${record.huntCode}</td>
      <td>${record.quota.toLocaleString()}</td>
      <td>${record.applicants.toLocaleString()}</td>
      <td><span class="oddsCell" style="background:${cat.color};">${cat.label}</span></td>
      <td>${minPoints === null ? "10+" : minPoints}</td>
      <td class="${trend.cls}">${trend.arrow}</td>
    `;
    row.addEventListener("click", () => showDrawDetailForRecord(record, odds, points));
    drawTableBody.appendChild(row);
  });
  renderDrawTiles(sorted);
}

function renderDrawTiles(sorted) {
  const total = sorted.length;
  const guaranteed = sorted.filter(s => s.odds >= 100).length;
  const likely = sorted.filter(s => s.odds >= 60).length;
  tileTotal.textContent = total;
  tileGuaranteed.textContent = guaranteed;
  tileLikely.textContent = likely;
  const minPointsList = sorted.map(s => getMinPointsFor100(s.record)).filter(v => v !== null);
  const avg = minPointsList.length > 0
    ? (minPointsList.reduce((a, b) => a + b, 0) / minPointsList.length).toFixed(1)
    : "—";
  tileAvgPoints.textContent = avg;
}

function showDrawDetailForRecord(record, odds, points) {
  const cat = categorizeOdds(odds, record);
  const trend = getDrawTrend(record);
  const history = record.priorMinPoints
    .map(p => `${p.year}: ${p.minPoints === null ? "N/A (0 drawn)" : p.minPoints + " pts"}`)
    .join(" → ");
  const effectiveGMUs = getEffectiveGMUs(record);
  emphasizeGroup(effectiveGMUs.map(String));
  let groupSection = "";
  if (effectiveGMUs.length > 1) {
    // The quota/odds/hunt code are shared across every unit in the group —
    // there's no separate per-unit statistic to show since it's one
    // license. What IS useful per unit is a quick way to jump to just
    // that one on the map, since "GMU 21, 22, 30, 31, 32" as a string
    // doesn't tell you where any single one of them actually is.
    const rows = effectiveGMUs.map(u => `
      <div class="unitGroupRow" onclick="window.scoutiqFocusUnit('${u}')">
        <span>GMU ${u}</span>
        <span class="focusHint">Zoom →</span>
      </div>
    `).join("");
    groupSection = `
      <div class="unitGroupList">
        <strong style="font-size:11px;color:#666;margin-bottom:4px;">One license, ${effectiveGMUs.length} units — click one to zoom in:</strong>
        ${rows}
      </div>
    `;
  }
  const noteLine = record.note
    ? `<div style="margin-top:6px;padding:6px 8px;background:#FFF3D6;border-radius:6px;font-size:11px;color:#7B5A0A;">⚠️ ${record.note}</div>`
    : "";
  leftInfoPanelBody.innerHTML = `
    <strong>GMU ${effectiveGMUs.join(", ")} — ${DRAW_SEASON_LABELS[record.season]}</strong>
    Hunt Code: ${record.huntCode}<br>
    Quota: ${record.quota.toLocaleString()} | Applicants: ${record.applicants.toLocaleString()}<br>
    At ${points} points: <strong style="color:${cat.color};">${cat.label}</strong><br>
    Min. points for guaranteed draw: ${getMinPointsFor100(record) ?? "10+"}<br>
    Trend: <span class="${trend.cls}">${trend.arrow}</span><br>
    History: ${history}
    ${noteLine}
    ${groupSection}
    <button onclick="window.scoutiqUseHuntCode('${record.id}')"
      style="margin-top:10px;width:100%;background:#2D6A4F;color:white;border:none;border-radius:6px;padding:8px;cursor:pointer;font-weight:bold;font-size:12px;">
      Highlight These Units in Scout Tool
    </button>
  `;
  leftInfoPanel.style.display = "block";
}

// Clicking a GMU polygon directly on the map in Plan mode — finds
// whichever hunt code record currently covers that unit, if any.
function showUnitDrawDetail(unit) {
  if (!hasValidPlanSelection()) {
    leftInfoPanelBody.innerHTML = `
      <strong>GMU ${unit}</strong>
      Select a species and season in the panel first to see draw odds.
    `;
    leftInfoPanel.style.display = "block";
    return;
  }
  const points = Number(pointsSlider.value);
  const unitOdds = buildUnitOddsMap(points);
  const entry = unitOdds[unit];
  if (!entry) {
    leftInfoPanelBody.innerHTML = `
      <strong>GMU ${unit}</strong>
      No hunt code data for this species/season/residency combination in the sample set.
    `;
    leftInfoPanel.style.display = "block";
    return;
  }
  showDrawDetailForRecord(entry.record, entry.odds, points);
}

// A hunt code covering multiple units is a "package deal" — clicking any
// one of them should visually confirm all of them are the same license,
// not just leave it to matching fill color. This persists across points
// slider / sort changes (still exploring the same unit's odds) but clears
// when the species/season/residency context changes (a different query).
let emphasizedGroupUnits = null;

function emphasizeGroup(units) {
  // Re-run the base odds/OTC styling first so a previously emphasized
  // unit goes back to its correct look (plain or OTC-dashed) rather than
  // being hardcoded back to a plain border regardless of what it actually
  // is.
  applyDrawOddsStyling();
  emphasizedGroupUnits = units;
  reapplyGroupEmphasis();
  flyToGroupBounds(units);
}

// Same feel as Scout Tool's selectUnit(): fly to fit the relevant
// geometry in view. Here that's every unit in the clicked hunt code's
// group, not just the one that was clicked.
function flyToGroupBounds(units) {
  let combined = null;
  units.forEach(u => {
    const layer = unitLayers[u];
    if (!layer) return;
    const b = layer.getBounds();
    combined = combined ? combined.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  });
  if (!combined) return;
  const isNarrow = window.innerWidth < 640;
  const pad = isNarrow ? [40, 40] : [80, 80];
  map.flyToBounds(combined, {
    paddingTopLeft: pad,
    paddingBottomRight: pad,
    maxZoom: 11,
    duration: 1.2
  });
}

function reapplyGroupEmphasis() {
  if (!emphasizedGroupUnits) return;
  emphasizedGroupUnits.forEach(u => {
    const layer = unitLayers[u];
    if (layer) {
      layer.setStyle({ weight: 4, color: "#1B4332" });
      layer.bringToFront();
    }
  });
}

function clearGroupEmphasis() {
  emphasizedGroupUnits = null;
}

function renderPlanDashboard() {
  applyDrawOddsStyling();
  reapplyGroupEmphasis();
  renderDrawTable();
}

planSpeciesSelect.addEventListener("change", function () { clearGroupEmphasis(); unitSearchError.style.display = "none"; renderPlanDashboard(); });
planSeasonSelect.addEventListener("change", function () { clearGroupEmphasis(); unitSearchError.style.display = "none"; renderPlanDashboard(); });
residencySelect.addEventListener("change", function () { clearGroupEmphasis(); unitSearchError.style.display = "none"; renderPlanDashboard(); });
sortSelect.addEventListener("change", renderPlanDashboard);
pointsSlider.addEventListener("input", function () {
  pointsValue.textContent = this.value;
  renderPlanDashboard();
});

/* --- Mode switching --- */
const modeTabs = document.querySelectorAll(".modeTab");
const scoutFilterBar = document.getElementById("filterBar");
const planPanel = document.getElementById("planPanel");
const planResultsPanel = document.getElementById("planResultsPanel");
const scoutLegend = document.querySelector(".legend");
const planResultsBody = document.getElementById("planResultsBody");
const togglePlanResultsBtn = document.getElementById("togglePlanResultsBtn");
let planResultsCollapsed = false;

togglePlanResultsBtn.addEventListener("click", function () {
  planResultsCollapsed = !planResultsCollapsed;
  planResultsBody.style.display = planResultsCollapsed ? "none" : "";
  togglePlanResultsBtn.textContent = planResultsCollapsed ? "+" : "−";
});

// Search for a specific unit within the currently selected species/season/
// residency — finds its hunt code record and reuses the same detail view,
// group emphasis, and fly-to-bounds as clicking it directly, so a search
// hit behaves identically to a map click.
const unitSearchInput = document.getElementById("unitSearchInput");
const unitSearchBtn = document.getElementById("unitSearchBtn");
const unitSearchError = document.getElementById("unitSearchError");

function performUnitSearch() {
  const raw = unitSearchInput.value.trim();
  if (!raw) return;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    unitSearchError.textContent = "Enter a unit number, like 21.";
    unitSearchError.style.display = "block";
    return;
  }
  if (!hasValidPlanSelection()) {
    unitSearchError.textContent = "Select a species and season above first.";
    unitSearchError.style.display = "block";
    return;
  }
  const unitKey = String(parsed);
  if (!unitLayers[unitKey]) {
    unitSearchError.textContent = `Unit ${parsed} isn't a recognized GMU.`;
    unitSearchError.style.display = "block";
    return;
  }
  const points = Number(pointsSlider.value);
  const unitOdds = buildUnitOddsMap(points);
  const entry = unitOdds[unitKey];
  if (!entry) {
    unitSearchError.textContent = `No hunt code data for unit ${parsed} in this species/season/residency.`;
    unitSearchError.style.display = "block";
    return;
  }
  unitSearchError.style.display = "none";
  showDrawDetailForRecord(entry.record, entry.odds, points);
}

unitSearchBtn.addEventListener("click", performUnitSearch);
unitSearchInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") performUnitSearch();
});

function setAppMode(mode) {
  appMode = mode;
  exitPinMode();
  modeTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
  if (mode === "scout") {
    scoutFilterBar.style.display = "";
    scoutLegend.style.display = "";
    locateBtn.style.display = "";
    planPanel.style.display = "none";
    planResultsPanel.style.display = "none";
    leftInfoPanel.style.display = "none";
    restoreScoutStyling();
  } else {
    scoutFilterBar.style.display = "none";
    scoutLegend.style.display = "none";
    locateBtn.style.display = "none";
    planPanel.style.display = "";
    planResultsPanel.style.display = "";
    leftInfoPanel.style.display = "none";
    hideInfoPopover();
    renderPlanDashboard();
  }
  updateHuntCodeBadge();
}

modeTabs.forEach(btn => {
  btn.addEventListener("click", () => setAppMode(btn.dataset.mode));
});

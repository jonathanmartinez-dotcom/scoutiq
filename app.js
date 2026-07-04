// ScoutIQ — starter wiring for the static prototype.
// Map, basemaps, mode tabs, pins, locate, info popovers.
// Layer toggles stay disabled until GIS data is hooked up.

(function () {
  var $ = function (id) { return document.getElementById(id); };

  // ---- Map ----
  var map = L.map('map', { zoomControl: true }).setView([39.1, -105.5], 7);

  var satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Esri World Imagery' }
  );
  var topo = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Esri World Topo' }
  );
  var topoOverlay = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, opacity: 0.9 }
  );

  var currentBase = [];
  function setBasemap(mode) {
    currentBase.forEach(function (l) { map.removeLayer(l); });
    if (mode === 'satellite') currentBase = [satellite];
    else if (mode === 'topo') currentBase = [topo];
    else currentBase = [satellite, topoOverlay]; // hybrid
    currentBase.forEach(function (l) { l.addTo(map); });
  }
  setBasemap('hybrid');

  document.querySelectorAll('input[name="basemapMode"]').forEach(function (r) {
    r.addEventListener('change', function () { setBasemap(r.value); });
  });

  // ---- Mode tabs (Scout Tool / Plan Your Hunt) ----
  document.querySelectorAll('.modeTab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.modeTab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var plan = tab.dataset.mode === 'plan';
      if ($('filterBar')) $('filterBar').style.display = plan ? 'none' : '';
      if ($('planPanel')) $('planPanel').style.display = plan ? '' : 'none';
      if ($('planResultsPanel')) $('planResultsPanel').style.display = 'none';
    });
  });

  // ---- Pins ----
  var pins = [];
  var pinArmed = false;
  var pinColors = { red: '#C0392B', blue: '#2C7DA0', green: '#2D6A4F', amber: '#D9A441', purple: '#6A4C93' };

  function selectedPinColor() {
    var checked = document.querySelector('input[name="pinColor"]:checked');
    return pinColors[checked ? checked.value : 'red'];
  }

  document.querySelectorAll('.pinColorSwatch input').forEach(function (r) {
    r.addEventListener('change', function () {
      document.querySelectorAll('.pinColorSwatch').forEach(function (s) { s.classList.remove('selected'); });
      r.closest('.pinColorSwatch').classList.add('selected');
    });
  });

  if ($('dropPinBtn')) $('dropPinBtn').addEventListener('click', function () {
    pinArmed = true;
    setStatus('Click the map to drop a pin.');
  });

  if ($('clearPinsBtn')) $('clearPinsBtn').addEventListener('click', function () {
    pins.forEach(function (p) { map.removeLayer(p); });
    pins = [];
    setStatus('Pins cleared.');
  });

  map.on('click', function (e) {
    if (!pinArmed) return;
    pinArmed = false;
    var m = L.circleMarker(e.latlng, {
      radius: 8, color: '#fff', weight: 2,
      fillColor: selectedPinColor(), fillOpacity: 0.95
    }).addTo(map);
    m.bindPopup(e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5));
    pins.push(m);
    setStatus('Pin dropped.');
  });

  // ---- Locate ----
  if ($('locateBtn')) $('locateBtn').addEventListener('click', function () {
    map.locate({ setView: true, maxZoom: 13 });
  });
  map.on('locationerror', function () { setStatus('Could not get your location.'); });

  // ---- Reset ----
  if ($('resetBtn')) $('resetBtn').addEventListener('click', function () {
    map.setView([39.1, -105.5], 7);
    setStatus('Select a unit first.');
  });

  // ---- Status ----
  function setStatus(msg) { if ($('status')) $('status').textContent = msg; }

  // ---- Unit select placeholder ----
  if ($('unitSelect')) {
    $('unitSelect').innerHTML = '<option value="">Units coming soon...</option>';
  }

  // ---- Info popovers ----
  var infoText = {
    blm: 'Bureau of Land Management parcels. Public land, generally open to hunting.',
    forest: 'US National Forest land. Public, check unit-specific regulations.',
    private: 'Private parcels. Permission required to access or hunt.',
    streams: 'Perennial streams and rivers. Water sources concentrate animal movement.',
    lakes: 'Lakes and ponds.',
    springs: 'Natural springs. High-value water in dry terrain.',
    migration: 'Mapped elk migration corridors between seasonal ranges.',
    winterRange: 'Where elk concentrate in winter months.',
    summerRange: 'Higher-elevation summer elk range.',
    residentHerd: 'Areas holding non-migratory resident elk year round.',
    roads: 'Hiking and pack trails.',
    ohv: 'OHV and ATV routes. More access, more pressure.',
    elevation: 'Colors terrain by elevation band.',
    slope: 'Colors terrain by steepness.',
    aspect: 'Colors terrain by the direction slopes face.',
    tpi_small: 'Highlights benches and draws at fine scale.',
    tpi_large: 'Highlights basins and ridgelines at broad scale.',
    curvature: 'Highlights bowls and knobs.',
    scoutiq_score: 'Combined ScoutIQ terrain score. Coming with the analysis engine.'
  };

  var popover = $('infoPopover');
  document.querySelectorAll('.infoBtn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!popover) return;
      popover.textContent = infoText[btn.dataset.info] || 'Details coming soon.';
      popover.style.display = 'block';
      var rect = btn.getBoundingClientRect();
      popover.style.left = Math.min(rect.right + 10, window.innerWidth - 260) + 'px';
      popover.style.top = rect.top + 'px';
    });
  });
  document.addEventListener('click', function (e) {
    if (popover && !e.target.classList.contains('infoBtn')) popover.style.display = 'none';
  });

  // ---- Plan panel stubs ----
  if ($('pointsSlider')) $('pointsSlider').addEventListener('input', function () {
    if ($('pointsValue')) $('pointsValue').textContent = $('pointsSlider').value;
  });
  if ($('togglePlanResultsBtn')) $('togglePlanResultsBtn').addEventListener('click', function () {
    var p = $('planResultsPanel');
    if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
  });
})();

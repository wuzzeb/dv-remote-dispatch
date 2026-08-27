const initialZoom = 20;
const earthCircumference = 40e6;
const metersToDegrees = 360 / earthCircumference;
const detailZoomThreshold = 17;
const yardJunctionRadiusMeters = 150;

/////////////////////
// map

const canvasRenderer = L.canvas();
const mapBounds = [[0, 0], [0.15, 0.15]];
const maxBounds = [[-0.02, -0.02], [0.17, 0.17]];
const map = L.map('map', {
  minZoom: 13,
  maxBounds: maxBounds,
  maxBoundsViscosity: 1,
  tap: false,
  wheelPxPerZoomLevel: 120,
  zoomDelta: 0.5,
  zoomControl: false,
  zoomSnap: 0.25,
})
.fitBounds(mapBounds);
L.control.scale().addTo(map);
const zoomHome = new L.Control.ZoomHome({
  position: 'topleft',
  zoomInText: '<i class="fas fa-search-plus"></i>',
  zoomHomeText: '<i class="fas fa-user"></i>',
  zoomHomeTitle: 'Toggle player follow',
  zoomOutText: '<i class="fas fa-search-minus"></i>',
}).addTo(map);

let markerToFollow;
let markerToFollowKey;
map.addEventListener('mousedown', stopFollowing);

function getMarkerCenter(marker) {
  return marker.getBounds ? marker.getBounds().getCenter() : marker.getLatLng();
}

function setMarkerToFollow(marker, key = marker) {
  if (markerToFollowKey === key) {
    stopFollowing();
    return;
  }
  markerToFollow = marker;
  markerToFollowKey = key;
  map.panTo(getMarkerCenter(marker));
}

function stopFollowing() {
  markerToFollow = undefined;
  markerToFollowKey = undefined;
}

function togglePlayerFollow(playerId) {
  const marker = overviewPlayerMarkers.get(playerId);
  if (marker)
    setMarkerToFollow(marker, `player-${playerId}`);
}

function zoomToAllPlayers() {
  const bounds = new L.LatLngBounds();
  playerMarkers.forEach(marker => bounds.extend(marker.getBounds()));
  map.fitBounds(bounds, { maxZoom: initialZoom });
}

map.addEventListener('zoomhome', () => {
  const playerId = playerMarkers.keys().next().value;
  if (playerId !== undefined)
    togglePlayerFollow(playerId);
});

/////////////////////
// settings

document.getElementById('themeDropdown')
  .addEventListener('input', e => {
    if (e.target.value === 'dark') {
      document.getElementById('map').classList.add('dark');
    } else {
      document.getElementById('map').classList.remove('dark');
    }
  });

function getCarColorMode() {
  return document.getElementById('carColorDropdown').value;
}

document.getElementById('carColorDropdown')
  .addEventListener('input', () => {
    updateAllCarColors();
    updateJobListColors();
  });

/////////////////////
// sidebar

const sidebar = L.control.sidebar({ autopan: true, container: 'sidebar' }).addTo(map);

const tablesort = new Tablesort(document.getElementById('carList'));
const carListBody = document.getElementById('carListBody');

function createCarRow(carId) {
  const row = document.createElement('tr');
  row.setAttribute('id', `carList-${carId}`);
  row.classList.add('interactive');
  carListBody.append(row);
  updateCarRow(carId);
  row.addEventListener('click', _ => followCar(carId, false) );
}

function removeCarRow(carId) {
  const row = document.getElementById(`carList-${carId}`);
  if (row)
    row.remove();
}

function updateCarRow(carId) {
  const row = document.getElementById(`carList-${carId}`);
  if (!row)
    return;
  const jobId = carJobIds.has(carId) ? carJobIds.get(carId) : '';
  const destinationYardId = allJobData.has(jobId) ? allJobData.get(jobId).destinationYardId : '';
  row.innerHTML = `<td>${carId}</td><td>${jobId}</td><td>${destinationYardId}</td>`;
  tablesort.refresh();
}

/////////////////////
// jobs

const CarsPerRow = 3;
const allJobData = new Map();
const carJobIds = new Map();
const jobListBody = document.getElementById('jobListBody');

// https://www.npmjs.com/package/string-hash
function stringHash(str) {
  let hash = 5381, i = str.length;
  while(i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  return hash >>> 0;
}

// http://vrl.cs.brown.edu/color
const carColors = [
  '#52ef99', '#c95e9f', '#b1e632', '#7574f5', '#799d10', '#fd3fbe', '#2cf52b', '#d130ff', '#21a708', '#fd2b31',
  '#3eeaef', '#ffc4de', '#069668', '#f9793b', '#5884c9', '#e5d75e', '#96ccfe', '#bb8801', '#6a8b7b', '#a8777c',
];

function colorByHashing(str) {
  return carColors[stringHash(str) % carColors.length];
}

function colorForJobDestination(jobId) {
  const jobData = allJobData.get(jobId);
  if (!jobData)
    return 'gray';
  return colorForYardId(jobData.destinationYardId);
}

function colorForJobType(jobId) {
  const segments = jobId.split('-');
  if (segments.length == 2)
    return 'cornflowerblue';
  const jobType = segments[1];
  switch (jobType) {
  case 'FH': return 'lightgreen';
  case 'LH': return 'khaki';
  case 'PC':
  case 'PE': return 'cornflowerblue';
  case 'PR': return 'mediumpurple';
  case 'SL':
  case 'SU': return 'lightcoral';
  }
}

function colorForJobId(jobId) {
  switch (getCarColorMode()) {
    case 'jobId': return colorByHashing(jobId);
    case 'carType':
    case 'jobType': return colorForJobType(jobId);
    case 'destination': return colorForJobDestination(jobId);
  }
}

function yardIdForTrack(trackId) {
  return trackId.split('-')[0];
}

function jobMatchesFilter(jobId, jobData) {
    const testText = document.getElementById('jobSearchText').value.toUpperCase();
    const activeOnly = document.getElementById('jobActiveOnly').checked;
  function taskFields(task) { return [task.startTrack, task.destinationTrack].concat(task.cars); }
  const fields = [jobId].concat(jobData.tasks.flatMap(taskFields));
  return fields.some(field => field.includes(testText)) && (!activeOnly || jobData.isActive);
}

function jobElem(jobId, jobData) {
  function replaceHyphens(s) { return s.replaceAll('-', '\u2011'); }

  const tbody = document.createElement('tbody');
  tbody.setAttribute('id', `jobList-${jobId}`);

  let row = document.createElement('tr');
  const jobIdCell = document.createElement('th'); 
  jobIdCell.setAttribute('colspan', CarsPerRow);
  jobIdCell.classList.add("jobList-jobHeader");
  jobIdCell.style.background = colorForJobId(jobId);
  jobIdCell.textContent = jobId;

  jobLicensesDiv = document.createElement('div');
  jobLicensesDiv.classList.add('jobList-licenses');
  for (const license of jobData.requiredLicenses) {
      jobLicensesDiv.innerHTML += `<span class="jobList-license"><div class="jobList-licenseBackground"></div><img src="res/licenses.${license}.png" title="${license}"></span>`;
  }
  jobIdCell.appendChild(jobLicensesDiv);

  row.appendChild(jobIdCell);
  tbody.appendChild(row);

  row = document.createElement('tr');
  jobMassCell = document.createElement('th');
  jobMassCell.textContent = `${jobData.mass.toFixed(0)} t`;
  jobLengthCell = document.createElement('th');
  jobLengthCell.textContent = `${jobData.length.toFixed(0)} m`;
  jobPaymentCell = document.createElement('th');
  jobPaymentCell.textContent =
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(jobData.basePayment);
  row.append(jobMassCell, jobLengthCell, jobPaymentCell);
  tbody.appendChild(row);

  jobData.tasks.forEach(task => {
    row = document.createElement('tr');
    const startTrackCell = document.createElement('th');
    startTrackCell.classList.add('interactive');
    startTrackCell.textContent = replaceHyphens(task.startTrack);
    startTrackCell.style.background = colorForYardId(yardIdForTrack(task.startTrack));
    startTrackCell.addEventListener('click', () => scrollToTrack(task.startTrack));
    row.appendChild(startTrackCell);

    const arrowCell = document.createElement('th');
    arrowCell.textContent = "\u279C";
    arrowCell.classList.add('jobList-trackSeparator');
    row.appendChild(arrowCell);

    const destinationTrackCell = document.createElement('th');
    destinationTrackCell.classList.add('interactive');
    destinationTrackCell.textContent = replaceHyphens(task.destinationTrack);
    destinationTrackCell.style.background = colorForYardId(yardIdForTrack(task.destinationTrack));
    destinationTrackCell.addEventListener('click', () => scrollToTrack(task.destinationTrack));
    row.appendChild(destinationTrackCell);

    for (let carIndex = 0; carIndex < task.cars.length; carIndex++) {
      if (carIndex % CarsPerRow == 0) {
        tbody.appendChild(row);
        row = document.createElement('tr');
      }
      const carId = task.cars[carIndex];
      const carCell = document.createElement('td');
      carCell.classList.add(`jobList-carCell-${carId}`);
      carCell.classList.add('interactive');
      carCell.textContent = carId;
      carCell.addEventListener('click', () => followCar(carId, false));
      row.appendChild(carCell);
    }
    if (row.children.length < CarsPerRow)
      // add filler cells
      for (let i = 0; i < CarsPerRow - (task.cars.length % CarsPerRow); i++)
        row.appendChild(document.createElement('td'));
    tbody.appendChild(row);
  });

  return tbody;
}

function updateCarJobs() {
  carJobIds.clear();
  allJobData.forEach((jobData, jobId) => {
    jobData.tasks.forEach(task => {
      task.cars.forEach(carId => {
        carJobIds.set(carId, jobId);
      });
    })
  });
  for ([carId, _] of allCarData) {
    updateCarRow(carId);
    updateCarMarker(carId);
  }
}

function updateJobListColors() {
  for (const elem of jobListBody.querySelectorAll('th.jobList-jobHeader')) {
    elem.style.background = colorForJobId(elem.textContent);
  }
}

function updateJobList() {
  for (const elem of Array.from(jobListBody.childNodes))
    elem.remove();
  const sortedJobs = Array.from(allJobData.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  sortedJobs
    .filter(([jobId, jobData]) => jobMatchesFilter(jobId, jobData))
    .forEach(([jobId, jobData]) => jobListBody.appendChild(jobElem(jobId, jobData)));
}

function updateAllJobs(jobs) {
  allJobData.clear();
  Object.entries(jobs).forEach(([jobId, jobData]) => allJobData.set(jobId, jobData));
  updateJobList();
  updateCarJobs();
}

let jobSearchTimeoutId;
function queueJobUpdate() {
    if (jobSearchTimeoutId)
        clearTimeout(jobSearchTimeoutId);
    jobSearchTimeoutId = setTimeout(updateJobList, 100);
}
document.getElementById('jobSearchText').addEventListener('input', e => {
    queueJobUpdate();
});
document.getElementById('jobActiveOnly').addEventListener('change', e => {
    queueJobUpdate();
})

/////////////////////
// track

const trackPolyLines = new Map();
const trackCoordinates = new Map();
const trackLabels = new Map();
const yardTrackCoordinates = [];
const stationBounds = new Map();
const detailTrackLabelLayer = L.layerGroup().addTo(map);
const stationCodeLayer = L.layerGroup();
const overviewSpeedSignLayer = L.layerGroup();
const speedSignMarkers = new Map();

const stationNames = {
  CME: 'Coal Mine East',
  CMS: 'Coal Mine South',
  CP: 'Coal Power Plant',
  CS: 'City South',
  CW: 'City West',
  FF: 'Food Factory & Town',
  FM: 'Farm',
  FRC: 'Forest Central',
  FRS: 'Forest South',
  GF: 'Goods Factory & Town',
  HB: 'Harbor & Town',
  HMB: 'Harbor Military Base',
  IME: 'Iron Mine East',
  IMW: 'Iron Mine West',
  MB: 'Military Base',
  MF: 'Machine Factory & Town',
  MFMB: 'Machine Factory Military Base',
  OR: 'Oil Refinery',
  OWC: 'Oil Well Central',
  OWN: 'Oil Well North',
  SM: 'Steel Mill',
  SW: 'Sawmill',
};

function colorForYardId(yardId) {
  switch (yardId) {
    case 'CME': return '#686868';
    case 'CMS': return '#4e554e';
    case 'CP': return '#583d3d';
    case 'CS': return '#97adc2';
    case 'CW': return '#a7a7a7';
    case 'FF': return '#77a6e3';
    case 'FM': return '#ddaa4d';
    case 'FRC': return '#92b66a';
    case 'FRS': return '#609161';
    case 'GF': return '#c97fa2';
    case 'HB': return '#816c94';
    case 'HMB': return '#816c94';
    case 'IME': return '#b66861';
    case 'IMW': return '#9a5847';
    case 'MB': return '#988c5f';
    case 'MF': return '#dc885b';
    case 'MFMB': return '#dc885b';
    case 'OR': return '#935478';
    case 'OWC': return '#555a62';
    case 'OWN': return '#625d55';
    case 'SM': return '#7b8394';
    case 'SW': return '#cda888';
  }
}

function createTrackLabel(trackId, position, angle) {
  const size = 0.0002;
  const bounds = [[position[0] - size, position[1] - size], [position[0] + size, position[1] + size]];
  const rotation = `rotate(${-angle})`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', trackId)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '-50 -10 100 20');
  svg.innerHTML =
    `<text text-anchor="middle" dominant-baseline="central" transform="${rotation}" font-family="Arial" font-size="10" font-weight="bold" fill="deepskyblue" stroke="black" stroke-width="0.35px" paint-order="stroke">${trackId.slice(trackId.indexOf('-') + 1)}</text>`;
  L.svgOverlay(svg, bounds, { renderer: canvasRenderer })
    .addTo(detailTrackLabelLayer)
    .setZIndex(1000);
  if (!trackLabels.has(trackId))
    trackLabels.set(trackId, []);
  trackLabels.get(trackId).push(svg);
}

function pointDistance(p1, p2) {
  const d0 = p1[0] - p2[0];
  const d1 = p1[1] - p2[1];
  return Math.sqrt(d0 * d0 + d1 * d1);
}

function pointLerp(p1, p2, a) {
  return [
    (p2[0] - p1[0]) * a + p1[0],
    (p2[1] - p1[1]) * a + p1[1]
  ];
}

function createLocation(start, end, mid, a) {
  return [
    (end[0] - start[0]) * a + mid[0],
    (end[1] - start[1]) * a + mid[1]
  ];
}

function createTrackLabels(trackId, coords) {
  const length = pointDistance(coords[0], coords[coords.length - 1]);
  const midIndex = Math.floor(coords.length / 2); 
  const beforeMid = (midIndex % 2 == 1) ? coords[midIndex] : coords[midIndex - 1];
  const mid = (midIndex % 2 == 1) ? coords[midIndex] : pointLerp(coords[midIndex - 1], coords[midIndex], 0.5);
  const afterMid = (midIndex % 2 == 1) ? coords[midIndex + 1] : coords[midIndex];
  const midGap = pointDistance(beforeMid, afterMid);

  const angle = ((Math.atan2(afterMid[0] - beforeMid[0], afterMid[1] - beforeMid[1]) * 180 / Math.PI) + 270) % 180 - 90;

  if (coords.length > 5) {
    createTrackLabel(trackId, createLocation(beforeMid, afterMid, mid, length / midGap *  0.3), angle);
    createTrackLabel(trackId, createLocation(beforeMid, afterMid, mid, length / midGap * -0.3), angle);
  } else {
    createTrackLabel(trackId, mid, angle);
  }
}

function createStationNavigation() {
  const control = L.control({ position: 'topright' });
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'leaflet-bar station-jump-control');
    const select = L.DomUtil.create('select', '', container);
    select.title = 'Zoom to a station';
    select.innerHTML = '<option value="">Go to station...</option>' +
      '<option value="__map">Whole map</option>' +
      '<option value="__players">Current train / player</option>' +
      Array.from(stationBounds.keys())
        .sort((a, b) => stationNames[a].localeCompare(stationNames[b]))
        .map(code => `<option value="${code}">${stationNames[code]} (${code})</option>`)
        .join('');
    select.addEventListener('change', event => {
      const value = event.target.value;
      event.target.value = '';
      stopFollowing();
      if (value === '__map')
        map.fitBounds(mapBounds);
      else if (value === '__players')
        zoomToAllPlayers();
      else if (stationBounds.has(value))
        map.fitBounds(stationBounds.get(value), { padding: [40, 40], maxZoom: 19 });
    });
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  control.addTo(map);
}

function createStationLabels() {
  stationBounds.forEach((bounds, code) => {
    const icon = L.divIcon({
      className: 'station-code-marker',
      html: `<span title="${stationNames[code]}">${code}</span>`,
      iconAnchor: [24, 14],
      iconSize: [48, 28],
    });
    L.marker(bounds.getCenter(), { icon, interactive: false })
      .addTo(stationCodeLayer);
  });
  createStationNavigation();
}

const tracksReady = fetch(new URL('/track', location))
.then(resp => resp.json())
.then(tracks => {
  Object.entries(tracks).forEach(([trackId, coords]) => {
    const isSiding = !trackId.includes('#');
    const polyline = L.polyline(coords, {
      color: isSiding ? 'slategray' : 'lightsteelblue',
      interactive: false,
      renderer: canvasRenderer,
    }).addTo(map);
    trackPolyLines.set(trackId, polyline);
    trackCoordinates.set(trackId, coords);
    if (isSiding) {
      const stationCode = trackId.split('-')[0];
      if (!stationBounds.has(stationCode))
        stationBounds.set(stationCode, L.latLngBounds(coords));
      else
        stationBounds.get(stationCode).extend(polyline.getBounds());
      yardTrackCoordinates.push(coords);
      createTrackLabels(trackId, coords)
    }
  });
  createStationLabels();
});

/////////////////////
// junctions

let junctions = [];
const trackBranchCounts = new Map();
const selectedTrackBranchCounts = new Map();
const detailJunctionLayer = L.layerGroup().addTo(map);
const overviewJunctionLayer = L.layerGroup();
const junctionsReady = tracksReady
.then(_ => fetch(new URL('/junction', location)))
.then(resp => resp.json())
.then(allJunctionData => {
  allJunctionData.forEach(data => data.branches.forEach(trackId =>
    trackBranchCounts.set(trackId, (trackBranchCounts.get(trackId) || 0) + 1)));
  junctions = allJunctionData.map((data, index) => ({
      marker: createJunctionMarker(data.position, index),
      overviewMarker: isRouteJunction(data.position) ? createOverviewJunctionMarker(data.position, index) : null,
      branches: data.branches,
      position: data.position,
      selectedBranch: null,
    }));
}).then(() => updateMapForZoom());

function toggleJunction(junctionId) {
  fetch(new URL(`/junction/${junctionId}/toggle`, location), { method: 'POST' })
  .then(resp => resp.json())
  .then(selectedBranch => updateJunctionOverlay(junctionId, selectedBranch))
  .catch(err => {});
}

const junctionCanvasSize = 30;

function createJunctionShape(selectedBranch) {
  return `<g opacity="70%"><rect x="${-junctionCanvasSize/2}" y="${-junctionCanvasSize}" width="${junctionCanvasSize}" height="${junctionCanvasSize*2}" fill="red"/>` +
    (
      selectedBranch == 0 ? `<line x1="${junctionCanvasSize/2}" y1="${junctionCanvasSize}" x2="${-junctionCanvasSize/2}" y2="${-junctionCanvasSize}" stroke="white" stroke-width="10"/>` :
      selectedBranch == 1 ? `<line x1="${-junctionCanvasSize/2}" y1="${junctionCanvasSize}" x2="${junctionCanvasSize/2}" y2="${-junctionCanvasSize}" stroke="white" stroke-width="10"/>`
      : ''
    ) +
    `<rect x="${-junctionCanvasSize/2}" y="${-junctionCanvasSize}" width="${junctionCanvasSize}" height="${junctionCanvasSize*2}" fill="none" stroke="black" stroke-width="2%"/></g>`;
}

function createJunctionLabel(junctionId) {
  return `<text x="${-junctionCanvasSize/2+5}" y="${junctionCanvasSize-5}">${junctionId}</text>`
}

function pointToSegmentDistance(point, start, end) {
  const deltaLat = end[0] - start[0];
  const deltaLon = end[1] - start[1];
  const lengthSquared = deltaLat * deltaLat + deltaLon * deltaLon;
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * deltaLat + (point[1] - start[1]) * deltaLon) / lengthSquared));
  const nearest = [start[0] + projection * deltaLat, start[1] + projection * deltaLon];
  return pointDistance(point, nearest) / metersToDegrees;
}

function isRouteJunction(position) {
  return yardTrackCoordinates.every(coords => {
    for (let i = 1; i < coords.length; ++i)
      if (pointToSegmentDistance(position, coords[i - 1], coords[i]) <= yardJunctionRadiusMeters)
        return false;
    return true;
  });
}

function getBranchAngle(junction, selectedBranch) {
  if (selectedBranch == null)
    return 0;
  const coords = trackCoordinates.get(junction.branches[selectedBranch]);
  if (!coords || coords.length < 2)
    return 0;
  const deltaLat = coords[1][0] - coords[0][0];
  const deltaLon = coords[1][1] - coords[0][1];
  return Math.atan2(deltaLon, deltaLat) * 180 / Math.PI;
}

function getOverviewBranchAngle(junction, selectedBranch) {
  const selectedAngle = getBranchAngle(junction, selectedBranch);
  if (selectedBranch == null)
    return selectedAngle;
  const otherAngle = getBranchAngle(junction, 1 - selectedBranch);
  const divergence = (selectedAngle - otherAngle + 540) % 360 - 180;
  return selectedAngle + Math.sign(divergence || (selectedBranch === 0 ? -1 : 1)) * 30;
}

function createOverviewJunctionIcon(junctionId, selectedBranch) {
  const junction = junctions[junctionId];
  const angle = junction ? getOverviewBranchAngle(junction, selectedBranch) : 0;
  return L.divIcon({
    className: 'overview-junction-marker',
    html: `<div class="overview-junction-symbol" style="transform: rotate(${angle}deg)" title="J-${junctionId}">` +
      '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="14"/>' +
      '<path class="junction-arrow" d="M22 32V9M14 17L22 9L30 17"/>' +
      '<path class="junction-pointer" d="M22 0L16 10H28Z"/></svg></div>',
    iconAnchor: [22, 22],
    iconSize: [44, 44],
  });
}

function createOverviewJunctionMarker(position, junctionId) {
  return L.marker(position, {
    icon: createOverviewJunctionIcon(junctionId, null),
    keyboard: false,
    riseOnHover: true,
  })
    .addEventListener('click', () => toggleJunction(junctionId))
    .addTo(overviewJunctionLayer);
}

function createJunctionOverlay(junctionId) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', `J-${junctionId}`)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `${-junctionCanvasSize/2} ${-junctionCanvasSize} ${junctionCanvasSize} ${junctionCanvasSize*2}`);
  svg.innerHTML = createJunctionShape(null) + createJunctionLabel(junctionId);
  return svg;
}

function updateJunctionOverlay(junctionId, selectedBranch) {
  const junction = junctions[junctionId]
  const previousTrackId = junction.selectedBranch == null ? null : junction.branches[junction.selectedBranch];
  if (previousTrackId)
    selectedTrackBranchCounts.set(previousTrackId, (selectedTrackBranchCounts.get(previousTrackId) || 1) - 1);
  junction.selectedBranch = selectedBranch;
  const selectedTrackId = junction.branches[selectedBranch]
  selectedTrackBranchCounts.set(selectedTrackId, (selectedTrackBranchCounts.get(selectedTrackId) || 0) + 1);
  updateTrackLabelHighlight(previousTrackId);
  updateTrackLabelHighlight(selectedTrackId);
  const markerElement = junction.marker.getElement();
  if (markerElement)
    markerElement.innerHTML = createJunctionShape(selectedBranch) + createJunctionLabel(junctionId);
  if (junction.overviewMarker)
    junction.overviewMarker.setIcon(createOverviewJunctionIcon(junctionId, selectedBranch));
  trackPolyLines.get(selectedTrackId).setStyle({ color: 'steelblue', dashArray: null });
  const unselectedTrackPolyLine = trackPolyLines.get(junction.branches[1-selectedBranch]);
  unselectedTrackPolyLine
    .setStyle({ color: 'lightsteelblue', dashArray: "6 12" })
    .bringToBack();
}

function getJunctionOverlayBounds(position) {
  const size = metersToDegrees * 5;
  return [ [ position[0] - size, position[1] - size/2], [position[0] + size, position[1] + size/2] ];
}

function createJunctionMarker(p, junctionId) {
  return L.svgOverlay(
    createJunctionOverlay(junctionId),
    getJunctionOverlayBounds(p),
    { interactive: true, renderer: canvasRenderer })
    .addEventListener('click', () => toggleJunction(junctionId) )
    .addTo(detailJunctionLayer)
    .setZIndex(Math.floor(p[0] * 100000 + p[1] * 100000));
}

function updateTrackLabelHighlight(trackId) {
  if (!trackLabels.has(trackId))
    return;
  const isSelected = selectedTrackBranchCounts.get(trackId) === trackBranchCounts.get(trackId);
  trackLabels.get(trackId).forEach(label => {
    const text = label.querySelector('text');
    if (text)
      text.setAttribute('fill', isSelected ? '#ffd43b' : 'deepskyblue');
  });
}

function updateAllJunctions(states) {
  states.forEach((state, index) => updateJunctionOverlay(index, state))
}

/////////////////////
// following

function followCar(carId, shouldScroll) {
  setMarkerToFollow(carMarkers.get(carId));

  for (const row of carListBody.querySelectorAll('.following'))
    row.classList.remove('following');
  const carListRow = document.getElementById(`carList-${carId}`)
  carListRow.classList.add('following');
  if (shouldScroll)
    carListRow.scrollIntoView({ block: 'center' });

  for (const elem of jobListBody.querySelectorAll('.following'))
    elem.classList.remove('following');
  const jobListElems = jobListBody.querySelectorAll(`.jobList-carCell-${carId}`);
  for (const elem of jobListElems) {
    elem.classList.add('following');
    elem.closest('tbody').classList.add('following');
  }
  if (shouldScroll && jobListElems.length > 0)
    jobListElems[0].scrollIntoView({ block: 'center' });
}

/////////////////////
// player

const playerMarkers = new Map();
const overviewPlayerMarkers = new Map();
const detailPlayerLayer = L.layerGroup().addTo(map);
const overviewPlayerLayer = L.layerGroup();

function createOverviewPlayerIcon(playerData) {
  return L.divIcon({
    className: 'overview-player-marker',
    html: `<div class="overview-player-symbol" style="--player-color:${playerData.color}">` +
      `<div class="overview-player-arrow" style="transform:rotate(${playerData.rotation}deg)"></div></div>`,
    iconAnchor: [18, 18],
    iconSize: [36, 36],
  });
}

function getPlayerOverlayBounds(position) {
  const size = metersToDegrees * 2;
  return [ [ position[0] - size, position[1] - size], [position[0] + size, position[1] + size] ];
}

function updatePlayerOverlays(data) {
  const existingPlayerIds = Array.from(playerMarkers.keys());
  // Remove markers from disconnected players
  existingPlayerIds
  .filter(id => !data.hasOwnProperty(id))
  .forEach(id => {
    removePlayerOverlay(id);
  });
  // Add markers for new players
  Object.entries(data)
  .filter(([id]) => !existingPlayerIds.includes(id))
  .forEach(([id, playerData]) => {
    createPlayerMarker(id, playerData);
  });
  Object.entries(data).forEach(([id, playerData]) => {
    const polygonElem = document.getElementById(`playerPolygon-${id}`);
    if (polygonElem)
      polygonElem.setAttribute('transform', `rotate(${playerData.rotation})`);
    playerMarkers.get(id).setBounds(getPlayerOverlayBounds(playerData.position));
    const overviewMarker = overviewPlayerMarkers.get(id);
    overviewMarker.setLatLng(playerData.position);
    overviewMarker.setIcon(createOverviewPlayerIcon(playerData));
  });
}

function removePlayerOverlay(id) {
  if (markerToFollowKey === `player-${id}`)
    stopFollowing();
  document.getElementById(`playerPolygon-${id}`)?.remove();
  const detailMarker = playerMarkers.get(id);
  if (detailMarker)
    detailPlayerLayer.removeLayer(detailMarker);
  const overviewMarker = overviewPlayerMarkers.get(id);
  if (overviewMarker)
    overviewPlayerLayer.removeLayer(overviewMarker);
  overviewPlayerMarkers.delete(id);
  playerMarkers.delete(id);
}

function createPlayerOverlay(id, playerData) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-15 -15 30 30');
  const polygon = document.createElementNS(svg.namespaceURI, 'polygon');
  polygon.setAttribute('id', `playerPolygon-${id}`);
  polygon.setAttribute('fill', playerData.color);
  polygon.setAttribute('fill-opacity', '70%');
  polygon.setAttribute('stroke', 'black');
  polygon.setAttribute('stroke-width', '1%');
  polygon.setAttribute('points', '0,-10 10,10 0,5 -10,10');
  svg.appendChild(polygon);
  return svg;
}

function createPlayerMarker(id, playerData) {
  playerMarkers.set(id, L.svgOverlay(
    createPlayerOverlay(id, playerData),
    getPlayerOverlayBounds(playerData.position),
    { interactive: true, bubblingMouseEvents: false })
    .addEventListener('mousedown', event => L.DomEvent.stopPropagation(event.originalEvent))
    .addEventListener('click', () => togglePlayerFollow(id))
    .addTo(detailPlayerLayer));

  const overviewMarker = L.marker(playerData.position, {
    icon: createOverviewPlayerIcon(playerData),
    bubblingMouseEvents: false,
    keyboard: false,
    riseOnHover: true,
  })
    .addEventListener('mousedown', event => L.DomEvent.stopPropagation(event.originalEvent))
    .addEventListener('click', () => togglePlayerFollow(id))
    .addTo(overviewPlayerLayer);
  overviewPlayerMarkers.set(id, overviewMarker);
}

function scrollToTrack(trackId) {
  stopFollowing();
  const polyLine = trackPolyLines.get(trackId);
  if (polyLine)
    map.panTo(polyLine.getCenter());
}

// speed signs

function createSpeedSignIcon(speed) {
  return L.divIcon({
    className: 'speed-sign-marker',
    html: `<span title="Speed limit ${speed} km/h">${speed}</span>`,
    iconAnchor: [12, 12],
    iconSize: [24, 24],
  });
}

function updateSpeedSignOverlays(signs) {
  const newKeys = new Set(signs.map(sign => `${sign.position[0]},${sign.position[1]}`));
  for (const [key, marker] of speedSignMarkers) {
    if (!newKeys.has(key)) {
      overviewSpeedSignLayer.removeLayer(marker);
      speedSignMarkers.delete(key);
    }
  }
  for (const sign of signs) {
    const key = `${sign.position[0]},${sign.position[1]}`;
    let marker = speedSignMarkers.get(key);
    if (!marker) {
      marker = L.marker(sign.position, {
        icon: createSpeedSignIcon(sign.speed),
        interactive: false,
        keyboard: false,
      }).addTo(overviewSpeedSignLayer);
      speedSignMarkers.set(key, marker);
    }
  }
}

fetch(new URL('/player', location))
.then(resp => resp.json())
.then(data => {
  updatePlayerOverlays(data);
  zoomToAllPlayers();
});

/////////////////////
// loco control

const locoIdSelect = document.getElementById('locoControlLocoId');
function updateLocoList() {
  for (const elem of Array.from(locoIdSelect.children))
    elem.remove();
  const locoIds = Array.from(allCarData.entries())
    .filter(([_, carData]) => carData.canBeControlled)
    .map(([id, _]) => id.slice(2));
  locoIds.sort();
  for (const id of locoIds) {
    const option = document.createElement('option');
    option.textContent = id;
    locoIdSelect.appendChild(option);
  }
}

function isReverserButtonActive(faButton) {
  return faButton.querySelector('svg').getAttribute('data-prefix') == 'fas';
}

function updateReverserButtons(reverser) {
  const reverseButton = document.querySelector('#locoControlReverserReverseButton svg');
  const newReverseStyle = reverser < 0.5 ? 'fas' : 'far';
  if (reverseButton.getAttribute('data-prefix') != newReverseStyle)
    reverseButton.setAttribute('data-prefix', newReverseStyle);

  const forwardButton = document.querySelector('#locoControlReverserForwardButton svg');
  const newForwardStyle = reverser > 0.5 ? 'fas' : 'far';
  if (forwardButton.getAttribute('data-prefix') != newForwardStyle)
    forwardButton.setAttribute('data-prefix', newForwardStyle);
}

const locoBrakePipeDisplay = document.getElementById('locoControlBrakePipe');
const locoSpeedDisplay = document.getElementById('locoControlForwardSpeed');
const locoTrainBrakeInput = document.getElementById('locoControlTrainBrakeInput');
const locoIndependentBrakeInput = document.getElementById('locoControlIndependentBrakeInput');
const locoReverserReverseButton = document.getElementById('locoControlReverserReverseButton');
const locoReverserForwardButton = document.getElementById('locoControlReverserForwardButton');
const locoThrottleInput = document.getElementById('locoControlThrottleInput');
const locoControlCoupleButton = document.getElementById('locoControlCoupleButton');
const locoControlUncoupleButton = document.getElementById('locoControlUncoupleButton');
const locoControlUncoupleSelect = document.getElementById('locoControlUncoupleSelect');

function updateCouplingControls(carData) {
  const canCouple = carData.canCouple;
  const carsInFront = carData.carsInFront;
  const carsInRear = carData.carsInRear;

  locoControlCoupleButton.disabled = !canCouple;
  locoControlUncoupleButton.disabled = carsInFront == 0 && carsInRear && 0;

  if (locoControlUncoupleSelect.childElementCount == carsInFront + carsInRear) {
    return;
  }

  const options = [];
  for (let i = carsInFront; i >= 1; i--)
    options.push(i);
  for (let i = 1; i <= carsInRear; i++)
    options.push(-i);
  locoControlUncoupleSelect.replaceChildren(...options.map(i => {
    const option = document.createElement('option');
    option.setAttribute('value', i);
    option.textContent = i >= 0 ? `\u002b${i}` : `\u2212${-i}`;
    return option;
  }));
}

function getControlledLocoGuid() {
  return allCarData.get(`L-${locoIdSelect.value}`)?.guid;
}

function getControlledLocoData() {
  const guid = getControlledLocoGuid();
  if (guid) {
    return fetch(`/car/${guid}`, location)
    .then(resp => resp.json());
  }
}

let locoTrainBrakeEditing = false;
let locoIndependentBrakeEditing = false;
let locoThrottleEditing = false;

function updateLocoTrainBrakeInput(carData) {
  if (locoTrainBrakeEditing)
    return;
  locoTrainBrakeInput.value = carData.trainBrake * 100;
}

function updateLocoIndependentBrakeInput(carData) {
  if (locoIndependentBrakeEditing)
    return;
  locoIndependentBrakeInput.value = carData.independentBrake * 100;
}

function updateLocoThrottleInput(carData) {
  if (locoThrottleEditing)
    return;
  locoThrottleInput.value = carData.throttle * 100;
}

function updateLocoDisplay() {
  getControlledLocoData()
  .then(carData => {
    locoBrakePipeDisplay.textContent = carData.brakePipe.toFixed(1);
    locoSpeedDisplay.textContent = carData.forwardSpeed.toFixed(0);
    updateLocoTrainBrakeInput(carData);
    updateLocoIndependentBrakeInput(carData);
    updateReverserButtons(carData.reverser);
    updateLocoThrottleInput(carData);
    updateCouplingControls(carData);
  });
}

let locoControlRefreshIntervalId;
locoIdSelect.addEventListener('change', updateLocoDisplay);
sidebar.on("content", e => {
  clearInterval(locoControlRefreshIntervalId);
  if (e.id == "locoControlTab") {
    locoControlRefreshIntervalId = setInterval(updateLocoDisplay, 1000 / 9);
  }
});
sidebar.on("closing", e => {
  clearInterval(locoControlRefreshIntervalId);
  locoControlRefreshIntervalId = undefined;
})

function sendLocoCommand(command) {
  const guid = getControlledLocoGuid();
  if (guid) {
    fetch(new URL(`/car/${guid}/control?${command}`, location), { method: 'POST' });
  }
}

function rangeCommandSender(parameter) {
  return e => sendLocoCommand(`${parameter}=${e.target.value / 100}`);
}

locoTrainBrakeInput.addEventListener('input', rangeCommandSender('trainBrake'));
locoIndependentBrakeInput.addEventListener('input', rangeCommandSender('independentBrake'));
locoReverserReverseButton.addEventListener('click', e =>
  sendLocoCommand(`reverser=${isReverserButtonActive(locoReverserReverseButton) ? 0.5 : 0}`));
locoReverserForwardButton.addEventListener('click', e =>
  sendLocoCommand(`reverser=${isReverserButtonActive(locoReverserForwardButton) ? 0.5 : 1}`));
locoThrottleInput.addEventListener('input', rangeCommandSender('throttle'));
locoControlCoupleButton.addEventListener('click', e =>
  sendLocoCommand('couple=0'));
locoControlUncoupleButton.addEventListener('click', e =>
  sendLocoCommand(`uncouple=${locoControlUncoupleSelect.value}`));

locoTrainBrakeInput.addEventListener("mousedown", () => locoTrainBrakeEditing = true);
locoTrainBrakeInput.addEventListener("mouseup", () => {
  locoTrainBrakeEditing = false;
  updateLocoDisplay();
});
locoIndependentBrakeInput.addEventListener("mousedown", () => locoIndependentBrakeEditing = true);
locoIndependentBrakeInput.addEventListener("mouseup", () => {
  locoIndependentBrakeEditing = false;
  updateLocoDisplay();
});
locoThrottleInput.addEventListener("mousedown", () => locoThrottleEditing = true);
locoThrottleInput.addEventListener("mouseup", () => {
  locoThrottleEditing = false;
  updateLocoDisplay();
});


/////////////////////
// cars

const carWidthMeters = 3;
const carWidthPx = 20;
const svgPixelsPerMeter = carWidthPx / 3;

const allCarData = new Map();
const carMarkers = new Map();

function getCarColor(carId) {
  const jobId = carJobIds.get(carId);

  switch (getCarColorMode()) {
  case 'jobId':
    return jobId ? colorByHashing(jobId) : 'gray';
  case 'jobType':
    return jobId ? colorForJobType(jobId) : 'gray';
  case 'destination':
    return jobId ? colorForJobDestination(jobId) : 'gray';
  case 'carType':
    return colorByHashing(carId.slice(0,3));
  }
}

function updateCarColor(carId) {
  const carMarker = carMarkers.get(carId);
  const rect = carMarker.getElement().querySelector('rect');
  if (rect)
    rect.setAttribute('fill', getCarColor(carId));
}

function updateAllCarColors() {
  carMarkers.forEach((_, carId) => updateCarColor(carId));
}

const locoShapeNoseDepth = 10;

function createCarShape(carId, carData) {
  const isLoco = carId.slice(0,2) == 'L-';
  const lengthPx = carData.length * svgPixelsPerMeter;
  const svg = isLoco
    ? `<polygon points="${-lengthPx/2},-${carWidthPx/2} ${-lengthPx/2},${carWidthPx/2} ${lengthPx/2-locoShapeNoseDepth},${carWidthPx/2} ${lengthPx/2},0 ${lengthPx/2-locoShapeNoseDepth},-${carWidthPx/2}" fill="goldenrod" fill-opacity="70%" stroke="black" stroke-width="1%"/>`
    : `<rect x="${-lengthPx/2}" y="-10" width="${lengthPx}" height="20" fill-opacity="70%" stroke="black" stroke-width="1%"/>`;
  return svg;
}

function createCarLabel(carId, carData) {
  const isLoco = carId.slice(0,2) == 'L-';
  const jobId = carJobIds.get(carId);
  const lengthPx = carData.length * svgPixelsPerMeter;
  const rotation = carData.rotation >= 180 ? 'rotate(180)' : '';
  if (isLoco)
    return `<text transform="translate(-3 0) ${rotation}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="bold">${carId}</text>`;
  const jobIdLabel =
    !jobId ? ""
    : jobId.split('-').length == 3 ? jobId.slice(-5,-3) + jobId.slice(-2)
    : jobId.split('-').join('');
  const jobIdText = `<text x="${-lengthPx/2 + 5}" transform="${rotation}" dominant-baseline="central" font-size="16">${jobIdLabel}</text>`
  const carIdText =
    `<text y="-0.5em" y="1" transform="${rotation} translate(${lengthPx/2 - 5})" dominant-baseline="central" text-anchor="end" font-size="8" font-family="monospace" font-weight="bold">` +
      `<tspan x="0">${carId.slice(0,-3).replaceAll('-', '')}</tspan>` +
      `<tspan x="0" dy="1em">${carId.slice(-3)}</tspan>` +
    '</text>';
  return jobIdText + carIdText;
}

function createCarOverlay(carId, carData) {
  const lengthPx = carData.length * svgPixelsPerMeter;
  const carCanvasMajor = Math.sqrt(lengthPx / 2 * lengthPx / 2 + carWidthPx / 2 * carWidthPx / 2);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', carId);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `${-carCanvasMajor} ${-carWidthPx/2} ${carCanvasMajor*2} ${carWidthPx}`);
  return svg
}

function updateCarMarker(carId) {
  const marker = carMarkers.get(carId);
  if (!marker)
    return;
  const carData = allCarData.get(carId);
  marker.setBounds(getCarOverlayBounds(carData));
  marker.setRotationAngle(carData.rotation - 90);
  marker.getElement().innerHTML = createCarShape(carId, carData) + createCarLabel(carId, carData);
  updateCarColor(carId);
}

function getCarOverlayBounds(carData) {
  const position = carData.position;
  const length = metersToDegrees * carData.length;
  const width = metersToDegrees * carWidthMeters;
  return [ [ position[0] - width/2, position[1] - length/2], [position[0] + width/2, position[1] + length/2] ];
}

function createNewCar(carId, carData) {
  allCarData.set(carId, carData);
  createCarRow(carId);
  const overlay = L.svgOverlay(
    createCarOverlay(carId, carData),
    getCarOverlayBounds(carData),
    { interactive: true, bubblingMouseEvents: false })
    .addEventListener('mouseup', e => followCar(carId, true))
    .addTo(map);
  carMarkers.set(carId, overlay);
  updateCarMarker(carId);
}

function updateCar(carId, carData) {
  allCarData.set(carId, carData);
  updateCarRow(carId);
  updateCarMarker(carId);
}

function removeCar(carId) {
  removeCarRow(carId);
  const marker = carMarkers.get(carId);
  if (marker) {
    marker.remove();
    carMarkers.delete(carId);
  }
  allCarData.delete(carId);
}

function updateAllCars(updateCarData) {
  Object.entries(updateCarData).forEach(([carId, carData]) => {
    if (!carMarkers.has(carId))
      createNewCar(carId, carData);
    else
      updateCar(carId, carData);
  });
  for ([carId, _] of carMarkers)
    if (!updateCarData[carId])
      removeCar(carId);
  updateLocoList();
}

function updateCars(cars) {
  Object.entries(cars).forEach(([carId, carData]) =>
    updateCar(carId, carData));
}

/////////////////////
// events

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
const sessionId = uuidv4();
const updateInterval = 100;
let updateStart;

function updateOnce() {
  updateStart = performance.now();
  return fetch(new URL(`/updates/${sessionId}`, location))
  .then(resp => resp.json())
  .then(updateData => {
    Object.entries(updateData).forEach(([tag, data]) => {
      switch (tag) {
      case 'cars':
        updateAllCars(data);
        break;
      case 'jobs':
        updateAllJobs(data);
        break;
      case 'junctions':
        updateAllJunctions(data);
        break;
      case 'player':
        updatePlayerOverlays(data);
        break;
      case 'signs':
        updateSpeedSignOverlays(data);
        break;
      default:
        const segments = tag.split('-');
        switch (segments[0]) {
        case 'trainset': updateCars(data); break;
        case 'carguid': updateCar(data.id, data); break;
        }
      }
    });
  })
  .then(_ => {
    if (markerToFollow)
      map.panTo(getMarkerCenter(markerToFollow));
  });
}

function updateLoop() {
  updateOnce()
  .then(_ => {
    const timeToNextUpdate = (updateStart + updateInterval) - performance.now();
    setTimeout(updateLoop, timeToNextUpdate);
  });
}

junctionsReady.then(_ => {
  updateLoop();
});

function setLayerVisible(layer, visible) {
  if (visible && !map.hasLayer(layer))
    layer.addTo(map);
  else if (!visible && map.hasLayer(layer))
    layer.removeFrom(map);
}

function updateMapForZoom() {
  const detailMode = map.getZoom() >= detailZoomThreshold;
  setLayerVisible(detailTrackLabelLayer, detailMode);
  setLayerVisible(detailJunctionLayer, detailMode);
setLayerVisible(detailPlayerLayer, detailMode);
  setLayerVisible(stationCodeLayer, !detailMode);
  setLayerVisible(overviewJunctionLayer, !detailMode);
  setLayerVisible(overviewPlayerLayer, !detailMode);
  setLayerVisible(overviewSpeedSignLayer, !detailMode);
}

map.addEventListener('zoomend', updateMapForZoom);
updateMapForZoom();

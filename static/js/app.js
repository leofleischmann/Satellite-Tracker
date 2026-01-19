// Global State
let map;
let markers = {};
let circles = {};
let trajectories = {};
let stationMarker;

// Data State
let ephemerisData = {};
let satelliteMeta = {};
let stationLoc = { lat: 0, lon: 0 };
let minElevation = 5;
let isDataLoaded = false;
let calculatedPasses = [];

// Ephemeris bounds (for checking if we need to reload)
let ephemerisStartTs = 0;
let ephemerisEndTs = 0;
let isLoadingEphemeris = false;

// Simulation State
let isPlaying = true;
let simulationTime = Date.now();
let scrubberBaseTime = Date.now();
let playSpeed = 1;
let lastFrameTime = 0;

// UI State
let selectedSatId = null;
let showAllTracks = false;
let showRadii = false;
let lastPassUpdate = 0;
let lastTrajectoryUpdate = 0;

// Config
let mapColors = ['#FF3333', '#33FF33', '#3333FF', '#FFFF33', '#FF33FF', '#33FFFF', '#FFA500', '#FF6B6B'];
let showSatNames = true;
let satLabels = {};

$(document).ready(function () {
    initMap();
    initUI();

    // Responsive Sidebar Defaults
    if (window.innerWidth >= 768) {
        $('#sidebar').removeClass('collapsed');
        $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
        $('#sidebar').addClass('collapsed');
        $('#sidebar-chevron').removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }

    loadStatus(() => {
        loadEphemeris(null, () => {
            calculatePassesClientSide();
            renderPassList();
            requestAnimationFrame(animationLoop);
        });
    });
});

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        keyboard: false,               // Disable keyboard navigation (arrows used for time control)
        zoomSnap: 0.5,
        preferCanvas: true,
        // Zoom optimizations for smoother experience
        updateWhenZooming: false,      // Don't redraw overlay during zoom animation
        updateWhenIdle: true,          // Only update when zoom animation completes
        wheelPxPerZoomLevel: 120,      // Slower mouse wheel zoom (less jarring)
        zoomAnimation: true,           // Enable smooth zoom animation
        markerZoomAnimation: true      // Smooth marker scaling during zoom
    }).setView([0, 0], 3);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        keepBuffer: 4,                 // Keep more tiles in memory (2 = default)
        updateWhenZooming: false       // Don't reload tiles during zoom animation
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);
    map.on('click', () => { selectedSatId = null; updateVisuals(true); });
}

function initUI() {
    updateIcon();

    // Make clock clickable to open date picker
    $('#clock-time, #clock-date').on('click', function () {
        $('#expert-time').trigger('click');
    });

    $('#scrubber').on('input', function () {
        let minutes = parseInt($(this).val());
        simulationTime = scrubberBaseTime + (minutes * 60 * 1000);
        isPlaying = false; updateIcon();
        updateClock();
        checkEphemerisBounds();
        updateVisuals(true);
    });

    $('#expert-time').on('change', function () {
        let newTime = new Date($(this).val()).getTime();
        simulationTime = newTime;
        scrubberBaseTime = newTime;
        $('#scrubber').val(0);
        isPlaying = false; updateIcon();
        updateClock();
        checkEphemerisBounds();
        updateVisuals(true);
    });

    $('#dynamicCalcCheck').on('change', function () { renderPassList(); });

    // Keyboard shortcuts
    $(document).on('keydown', function (e) {
        // Ignore if typing in an input field
        if ($(e.target).is('input, textarea')) return;

        switch (e.key) {
            case ' ':  // Space - Play/Pause
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':  // Left Arrow - Back 15 min
                e.preventDefault();
                offsetTime(-15);
                break;
            case 'ArrowRight':  // Right Arrow - Forward 15 min
                e.preventDefault();
                offsetTime(15);
                break;
            case 'ArrowUp':  // Up Arrow - Forward 60 min
                e.preventDefault();
                offsetTime(60);
                break;
            case 'ArrowDown':  // Down Arrow - Back 60 min
                e.preventDefault();
                offsetTime(-60);
                break;
            case 'r':
            case 'R':  // R - Reset to live
                resetTime();
                break;
            case 't':
            case 'T':  // T - Toggle all tracks
                toggleTracks();
                break;
        }
    });

    initMobileDrag();

    // Initialize Toggle State
    if (showSatNames) $('#toggle-names-btn').addClass('active');

    // Refresh button states
    $('#toggle-tracks-btn').toggleClass('active', showAllTracks);
    $('#toggle-radii-btn').toggleClass('active', showRadii);
}

function initMobileDrag() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebar-collapse-btn');
    if (!sidebar || !handle) return;

    let startY = 0;
    let startHeight = 0;
    let currentHeight = 0;
    let isDragging = false;

    handle.addEventListener('touchstart', (e) => {
        isDragging = true;
        startY = e.touches[0].clientY;
        startHeight = sidebar.clientHeight;
        handle.style.cursor = 'grabbing';
        sidebar.style.transition = 'none'; // Disable transition during drag
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault(); // Prevent scrolling

        const deltaY = startY - e.touches[0].clientY; // Drag up = positive delta
        currentHeight = startHeight + deltaY;

        // Constraints
        const maxHeight = window.innerHeight * 0.9;
        const minHeight = 60; // Header height

        if (currentHeight > maxHeight) currentHeight = maxHeight;
        if (currentHeight < minHeight) currentHeight = minHeight;

        sidebar.style.height = `${currentHeight}px`;
        sidebar.style.maxHeight = 'none';
        sidebar.classList.remove('collapsed'); // Ensure content is visible during drag
        $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.cursor = 'grab';
        sidebar.style.transition = 'height 0.3s ease';

        // Snap logic
        const screenHeight = window.innerHeight;
        const snapThreshold = screenHeight * 0.25;

        if (currentHeight < 150) {
            // Snap to collapsed
            sidebar.style.height = ''; // Reset inline height
            sidebar.classList.add('collapsed');
            $('#sidebar-chevron').removeClass('fa-chevron-down').addClass('fa-chevron-up');
        } else if (currentHeight > screenHeight * 0.75) {
            // Snap to full
            sidebar.style.height = '90vh';
            $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            // Snap to half or keep current if valid
            sidebar.style.height = '50vh';
            $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        }
    });
}

function loadStatus(cb) {
    $.get('/api/status', function (data) {
        if (data.location) {
            stationLoc = data.location;
            minElevation = data.min_elevation || 5;
            if (stationMarker) map.removeLayer(stationMarker);
            stationMarker = L.marker([stationLoc.lat, stationLoc.lon], {
                icon: L.divIcon({ html: '<i class="fa-solid fa-house-signal"></i>', className: 'text-white text-shadow', iconSize: [20, 20] }),
                zIndexOffset: 1000
            }).addTo(map);
            map.panTo([stationLoc.lat, stationLoc.lon]);
        }
        if (cb) cb();
    });
}

function loadEphemeris(centerTime, cb) {
    isLoadingEphemeris = true;
    let url = '/api/ephemeris';
    if (centerTime) {
        url += '?center_time=' + new Date(centerTime).toISOString();
    }

    $.get(url, function (data) {
        ephemerisData = data.ephemeris;
        satelliteMeta = data.satellites;
        minElevation = data.min_elevation || 5;

        // Calculate ephemeris bounds
        let firstKey = Object.keys(ephemerisData)[0];
        if (firstKey && ephemerisData[firstKey].length > 0) {
            let pts = ephemerisData[firstKey];
            ephemerisStartTs = pts[0][0] * 1000;
            ephemerisEndTs = pts[pts.length - 1][0] * 1000;
        }

        isDataLoaded = true;
        isLoadingEphemeris = false;

        calculatePassesClientSide();
        updateVisuals(true);
        renderPassList();

        if (cb) cb();
    });
}

function checkEphemerisBounds() {
    // If simulation time is outside the ephemeris window, load new data
    if (isLoadingEphemeris) return;

    let margin = 2 * 60 * 60 * 1000; // 2 hour margin
    if (simulationTime < ephemerisStartTs + margin || simulationTime > ephemerisEndTs - margin) {
        console.log('Loading new ephemeris centered on', new Date(simulationTime));
        loadEphemeris(simulationTime, null);
    }
}

function calcElevation(distKm, altKm) {
    let R = 6371;
    let psi = distKm / R;
    if (psi === 0) return 90;

    let h = altKm;
    let cosP = Math.cos(psi);
    let sinP = Math.sin(psi);
    let ratio = R / (R + h);

    let elRad = Math.atan2(cosP - ratio, sinP);
    let elDeg = elRad * 180 / Math.PI;

    return Math.max(-10, Math.min(90, elDeg));
}

function calculatePassesClientSide() {
    calculatedPasses = [];

    Object.keys(ephemerisData).forEach(id => {
        let points = ephemerisData[id];
        let radius = getSatRadius(id);
        let name = satelliteMeta[id] ? satelliteMeta[id].name : id;

        let onPass = false;
        let passStartTs = 0;
        let minDist = Infinity;
        let maxEl = 0;

        for (let i = 0; i < points.length; i++) {
            let p = points[i];
            let ts = p[0] * 1000;
            let lat = p[1];
            let lon = p[2];
            let alt = p[3] || 600;

            let groundDist = getGroundDistKm(stationLoc.lat, stationLoc.lon, lat, lon);
            let dist = getSlantRangeKm(stationLoc.lat, stationLoc.lon, lat, lon, alt);
            let el = calcElevation(groundDist, alt);

            let inRange = (dist < radius) && (el >= minElevation);

            if (inRange && !onPass) {
                onPass = true;
                passStartTs = ts;
                minDist = dist;
                maxEl = el;
            } else if (inRange && onPass) {
                if (dist < minDist) minDist = dist;
                if (el > maxEl) maxEl = el;
            } else if (!inRange && onPass) {
                onPass = false;

                calculatedPasses.push({
                    sat_id: id,
                    name: name,
                    start_time_ms: passStartTs,
                    end_time_ms: ts,
                    max_el: Math.round(maxEl),
                    min_dist_km: Math.round(minDist)
                });
                minDist = Infinity;
                maxEl = 0;
            }
        }

        if (onPass) {
            calculatedPasses.push({
                sat_id: id,
                name: name,
                start_time_ms: passStartTs,
                end_time_ms: points[points.length - 1][0] * 1000,
                max_el: Math.round(maxEl),
                min_dist_km: Math.round(minDist)
            });
        }
    });

    calculatedPasses.sort((a, b) => a.start_time_ms - b.start_time_ms);
}

function animationLoop(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
    let delta = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    if (isPlaying) {
        let simDelta = delta * playSpeed;
        simulationTime += simDelta;
        scrubberBaseTime += simDelta;
        updateClock();

        // At high speeds, update trajectory more frequently
        // Update every ~30 simulated seconds
        if (Math.abs(simDelta) > 5000) { // More than 5 sim seconds
            lastTrajectoryUpdate = 0; // Force update
        }
    }

    if (isDataLoaded) {
        // Update trajectories every 500ms real time OR when forced
        let forceTrajectory = (timestamp - lastTrajectoryUpdate > 500);
        if (forceTrajectory) lastTrajectoryUpdate = timestamp;

        updateVisuals(forceTrajectory);

        // Auto-update pass list every 1 second
        if (timestamp - lastPassUpdate > 1000) {
            lastPassUpdate = timestamp;
            renderPassList();
        }

        // Check if we need new ephemeris data (every 5 seconds)
        if (timestamp % 5000 < 100) {
            checkEphemerisBounds();
        }
    }

    requestAnimationFrame(animationLoop);
}

function findIndex(points, t) {
    let low = 0, high = points.length - 1;
    let idx = 0;
    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (points[mid][0] <= t) {
            idx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return idx >= points.length ? points.length - 1 : idx;
}

function interpolatePos(points, t) {
    let idxNow = findIndex(points, t);
    if (idxNow < 0 || idxNow >= points.length - 1) return null;

    let p1 = points[idxNow];
    let p2 = points[idxNow + 1];
    let factor = (t - p1[0]) / (p2[0] - p1[0]);

    let lat = p1[1] + (p2[1] - p1[1]) * factor;
    let lon1 = p1[2], lon2 = p2[2];
    let dLon = lon2 - lon1;

    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;

    let lon = lon1 + dLon * factor;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;

    let alt = p1[3] + (p2[3] - p1[3]) * factor;

    return { lat, lon, alt, idx: idxNow };
}

function updateVisuals(forceTrajectory) {
    let simSec = simulationTime / 1000.0;

    Object.keys(ephemerisData).forEach((id, idx) => {
        let points = ephemerisData[id];
        let posData = interpolatePos(points, simSec);

        if (posData) {
            updateSatVisuals(id, posData, idx, forceTrajectory ? points : null, posData.idx);
        } else {
            // Remove label if satellite position is invalid (e.g. out of time range)
            if (satLabels[id]) {
                map.removeLayer(satLabels[id]);
                delete satLabels[id];
            }
        }
    });
}

function getSatRadius(id) {
    let meta = satelliteMeta[id];
    return (meta && meta.transmission_radius_km) ? parseFloat(meta.transmission_radius_km) : 1500;
}

// Calculate great circle (ground) distance
function getGroundDistKm(lat1, lon1, lat2, lon2) {
    let R = 6371;
    let dLat = (lat2 - lat1) * Math.PI / 180;
    let dLon = (lon2 - lon1) * Math.PI / 180;
    let a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate 3D slant range to satellite (true distance)
function getSlantRangeKm(lat1, lon1, lat2, lon2, altKm) {
    let R = 6371;
    let groundDist = getGroundDistKm(lat1, lon1, lat2, lon2);

    // Convert ground distance to central angle
    let psi = groundDist / R;

    // 3D distance using law of cosines in the triangle:
    // Observer at R, Satellite at R+alt, angle psi between them
    let r1 = R;  // Observer radius (at sea level approx)
    let r2 = R + altKm;  // Satellite radius

    // Slant range = sqrt(r1² + r2² - 2*r1*r2*cos(psi))
    let slantRange = Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(psi));

    return slantRange;
}

function updateSatVisuals(id, pos, idx, points, currentIdx) {
    let color = mapColors[idx % mapColors.length];

    let alt = pos.alt || 600;
    let dist = getSlantRangeKm(stationLoc.lat, stationLoc.lon, pos.lat, pos.lon, alt);
    let radius = getSatRadius(id);
    let el = calcElevation(getGroundDistKm(stationLoc.lat, stationLoc.lon, pos.lat, pos.lon), alt);
    let inRange = (dist < radius) && (el >= minElevation);

    let name = (satelliteMeta[id] ? satelliteMeta[id].name : id);
    let status = inRange ? '✓ ACTIVE' : (el < minElevation ? 'Below Horizon' : 'Out of Range');
    let debugText = `${name} | ${dist.toFixed(0)}km | El: ${el.toFixed(1)}° | ${status}`;

    // Marker
    if (!markers[id]) {
        markers[id] = L.circleMarker([pos.lat, pos.lon], {
            radius: 8, color: color, fillColor: color, fillOpacity: 1,
            weight: 2, interactive: true
        }).addTo(map);

        markers[id].on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            selectSat(id);
        });

        markers[id].bindTooltip(debugText, { permanent: false, direction: 'top' });
    } else {
        markers[id].setLatLng([pos.lat, pos.lon]);
        markers[id].setStyle({
            fillOpacity: inRange ? 1 : 0.6,
            opacity: inRange ? 1 : 0.6,
            color: inRange ? '#00FF00' : color,
            radius: (id == selectedSatId) ? 12 : 8
        });
        if (markers[id].getTooltip()) markers[id].setTooltipContent(debugText);
    }

    // Circle
    let isSel = (id == selectedSatId);
    let shouldShow = isSel;

    if (!circles[id]) {
        circles[id] = L.circle([pos.lat, pos.lon], {
            radius: radius * 1000,
            color: color, weight: 1, fillOpacity: 0.05,
            interactive: false
        }).addTo(map);
    } else {
        circles[id].setLatLng([pos.lat, pos.lon]);
    }

    if (shouldShow) {
        circles[id].setStyle({ opacity: 0.5, fillOpacity: 0.05 });
    } else {
        circles[id].setStyle({ opacity: 0, fillOpacity: 0 });
    }

    // Trajectories
    if (points && currentIdx !== undefined) {
        if (!trajectories[id]) trajectories[id] = [];

        trajectories[id].forEach(p => map.removeLayer(p));
        trajectories[id] = [];

        let showTrack = isSel || showAllTracks;

        if (showTrack) {
            // When showing all tracks: smaller window and skip points for performance
            // Selected: full orbit (360 = ~90min), All tracks: half orbit (180 = ~45min)
            let windowSize = isSel ? 360 : 120;
            // Skip every Nth point when showing all tracks
            let skipFactor = isSel ? 1 : 3;

            let startIdx = Math.max(0, currentIdx - windowSize);
            let endIdx = Math.min(points.length, currentIdx + windowSize);

            // Helper to draw a batch of segments
            const drawTrace = (iStart, iEnd, isDashed) => {
                let segments = [];
                let currentSegment = [];

                // Always include the start point if possible to ensure continuity
                // But we need to handle the loop carefully
                for (let i = iStart; i < iEnd; i += skipFactor) {
                    let current = points[i];
                    if (currentSegment.length > 0) {
                        let prev = currentSegment[currentSegment.length - 1];
                        if (Math.abs(current[2] - prev[1]) > 100) {
                            segments.push(currentSegment);
                            currentSegment = [];
                        }
                    }
                    currentSegment.push([current[1], current[2]]);
                }
                if (currentSegment.length > 0) segments.push(currentSegment);

                let opacity = isSel ? 0.9 : 0.4; // Slightly brighter for better visibility of mixed lines
                let weight = isSel ? 3 : 2;
                let dashArray = isDashed ? '4, 8' : null;

                segments.forEach(seg => {
                    let poly = L.polyline(seg, {
                        color: color, weight: weight, opacity: opacity,
                        dashArray: dashArray,
                        interactive: false
                    }).addTo(map);
                    trajectories[id].push(poly);
                });
            };

            // Draw Past (Dashed)
            // Ensure we include currentIdx in past so it connects
            drawTrace(startIdx, currentIdx + 1, true);

            // Draw Future (Solid)
            // Start from currentIdx to connect
            drawTrace(currentIdx, endIdx, false);

        }
    }

    // Labels
    if (showSatNames) {
        if (!satLabels[id]) {
            satLabels[id] = L.marker([pos.lat, pos.lon], {
                icon: L.divIcon({
                    className: 'sat-name-label',
                    html: `<div style="color:white; text-shadow: 0 0 3px black; white-space:nowrap; margin-top:-15px; text-align:center; transform: translate(-50%, -100%); font-weight:bold; font-size: 14px; pointer-events: none;">${name}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                }),
                interactive: false,
                zIndexOffset: 1000
            }).addTo(map);
        } else {
            satLabels[id].setLatLng([pos.lat, pos.lon]);
            // Update name in case it changed (rare)
            // Force icon update only if needed could be optimized, but this is okay for now
        }
    } else {
        if (satLabels[id]) {
            map.removeLayer(satLabels[id]);
            delete satLabels[id];
        }
    }
}

// Controls
function selectSat(id) {
    if (selectedSatId == id) selectedSatId = null;
    else selectedSatId = id;
    updateVisuals(true);
}

function togglePlay() { isPlaying = !isPlaying; updateIcon(); }
function setSpeed(x) {
    playSpeed = x;
    updateSpeedPill();
    if (!isPlaying) togglePlay();
}
function updateIcon() {
    $('#play-btn i').attr('class', isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play');
}
function updateSpeedPill() {
    $('.speed-opt').removeClass('active');
    $('.speed-opt').each(function () {
        let speedVal = parseInt($(this).text().replace('x', '').replace('k', '000'));
        if (speedVal === playSpeed) $(this).addClass('active');
    });
}
function updateClock() {
    let d = new Date(simulationTime);
    let timeStr = d.toLocaleTimeString([], { hour12: false });
    let dateStr = d.toLocaleDateString();

    // Update both desktop and mobile clocks
    $('#clock-time').text(timeStr);
    $('#clock-date').text(dateStr);
    $('#mobile-clock-time').text(timeStr);
    $('#mobile-clock-date').text(dateStr);
}

function toggleSidebar() {
    let sidebar = $('#sidebar');
    let chevron = $('#sidebar-chevron');
    sidebar.toggleClass('collapsed');

    // Rotate chevron
    if (sidebar.hasClass('collapsed')) {
        chevron.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    } else {
        chevron.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    }
}

function toggleRadii() {
    showRadii = !showRadii;
    $('#toggle-radii-btn').toggleClass('active', showRadii);
    updateVisuals(true);
}
function toggleTracks() {
    showAllTracks = !showAllTracks;
    $('#toggle-tracks-btn').toggleClass('active', showAllTracks);
    updateVisuals(true);
}
function toggleNames() {
    showSatNames = !showSatNames;
    $('#toggle-names-btn').toggleClass('active', showSatNames);
    updateVisuals(true);
}

function offsetTime(minutes) {
    simulationTime += minutes * 60 * 1000;
    scrubberBaseTime = simulationTime;
    $('#scrubber').val(0);
    updateClock();
    checkEphemerisBounds();
    updateVisuals(true);
}

function resetTime() {
    simulationTime = Date.now();
    scrubberBaseTime = Date.now();
    $('#scrubber').val(0);
    isPlaying = true; updateIcon();
    updateClock();
    checkEphemerisBounds();
    updateVisuals(true);
    renderPassList();
}

function refreshPasses() { renderPassList(); }

function renderPassList() {
    let useSimTime = $('#dynamicCalcCheck').is(':checked');
    let refTime = useSimTime ? simulationTime : Date.now();

    let futurePasses = calculatedPasses.filter(p => p.end_time_ms > refTime);

    let html = '';
    if (futurePasses.length === 0) html = '<div class="text-white text-center mt-3">No upcoming encounters</div>';

    futurePasses.slice(0, 20).forEach(p => {
        let start = new Date(p.start_time_ms);
        let end = new Date(p.end_time_ms);
        let durationMin = Math.round((p.end_time_ms - p.start_time_ms) / 60000);
        let isNow = (simulationTime >= p.start_time_ms && simulationTime <= p.end_time_ms);
        let badge = isNow ? '<span class="badge bg-success ms-2">LIVE</span>' : '';

        let qualityIcon = p.max_el > 45 ? '🟢' : (p.max_el > 20 ? '🟡' : '🔴');

        html += `
        <div class="pass-item ${isNow ? 'active' : ''}" onclick="selectSat('${p.sat_id}')">
            <div class="d-flex justify-content-between align-items-center">
                <strong class="text-white">${p.name}</strong>${badge}
            </div>
            <div class="d-flex justify-content-between mt-1" style="color: #ccc;">
                <span>${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>${durationMin}min</span>
            </div>
            <div class="d-flex justify-content-between mt-1" style="color: #aaa;">
                <span>${qualityIcon} Max ${p.max_el}°</span>
                <span>${p.min_dist_km}km</span>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-outline-info flex-grow-1" onclick="event.stopPropagation(); showPolarPlot('${p.sat_id}', ${p.start_time_ms}, ${p.end_time_ms}, '${p.name}')">
                    <i class="fa-solid fa-compass"></i> Az/El
                </button>
                <button class="btn btn-sm btn-outline-light flex-grow-1" onclick="event.stopPropagation(); jumpTo(${p.start_time_ms}, '${p.sat_id}')">
                    <i class="fa-solid fa-play"></i> Jump
                </button>
            </div>
        </div>`;
    });
    $('#pass-list').html(html);
}

// ========== POLAR PLOT MODULE ==========
const PolarPlot = {
    canvas: null,
    ctx: null,

    // Convert Az/El to canvas X/Y coordinates
    // Azimuth: 0=N (up), 90=E (right), 180=S (down), 270=W (left)
    // Elevation: 90=center, 0=edge
    toCanvasCoords: function (az, el, centerX, centerY, radius) {
        // Convert elevation to radius (90° = center, 0° = edge)
        const r = radius * (1 - el / 90);

        // Convert azimuth to angle (0° = up, clockwise)
        // Canvas: 0 = right, so subtract 90° and negate for clockwise
        const angleRad = (az - 90) * Math.PI / 180;

        return {
            x: centerX + r * Math.cos(angleRad),
            y: centerY + r * Math.sin(angleRad)
        };
    },

    // Draw the polar grid (circles and radial lines)
    drawGrid: function (centerX, centerY, radius) {
        const ctx = this.ctx;

        // Background
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Horizon circle (outermost)
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.stroke();

        // Elevation circles (30°, 60°)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        [30, 60].forEach(el => {
            const r = radius * (1 - el / 90);
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
            ctx.stroke();
        });

        // Azimuth lines (every 45°)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        for (let az = 0; az < 360; az += 45) {
            const edge = this.toCanvasCoords(az, 0, centerX, centerY, radius);
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(edge.x, edge.y);
            ctx.stroke();
        }

        // Cardinal direction labels
        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const labels = [
            { az: 0, label: 'N' },
            { az: 45, label: 'NE' },
            { az: 90, label: 'E' },
            { az: 135, label: 'SE' },
            { az: 180, label: 'S' },
            { az: 225, label: 'SW' },
            { az: 270, label: 'W' },
            { az: 315, label: 'NW' }
        ];

        labels.forEach(l => {
            const pos = this.toCanvasCoords(l.az, -8, centerX, centerY, radius);
            ctx.fillText(l.label, pos.x, pos.y);
        });

        // Elevation labels
        ctx.fillStyle = '#666';
        ctx.font = '11px sans-serif';
        [0, 30, 60, 90].forEach(el => {
            const pos = this.toCanvasCoords(0, el, centerX, centerY, radius);
            ctx.fillText(el + '°', pos.x + 15, pos.y);
        });
    },

    // Draw the satellite path
    drawPath: function (points, centerX, centerY, radius) {
        const ctx = this.ctx;
        if (points.length < 2) return;

        // Draw path line
        ctx.strokeStyle = '#00d2ff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const start = this.toCanvasCoords(points[0].az, points[0].el, centerX, centerY, radius);
        ctx.moveTo(start.x, start.y);

        for (let i = 1; i < points.length; i++) {
            const pos = this.toCanvasCoords(points[i].az, points[i].el, centerX, centerY, radius);
            ctx.lineTo(pos.x, pos.y);
        }
        ctx.stroke();

        // Draw points
        points.forEach((p, i) => {
            const pos = this.toCanvasCoords(p.az, p.el, centerX, centerY, radius);

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 3, 0, 2 * Math.PI);

            if (i === 0) {
                ctx.fillStyle = '#00ff00';  // Start = green
                ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI);
            } else if (i === points.length - 1) {
                ctx.fillStyle = '#ff0000';  // End = red
                ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI);
            } else {
                ctx.fillStyle = '#00d2ff';
            }
            ctx.fill();
        });

        // Max elevation marker
        let maxEl = 0;
        let maxPoint = points[0];
        points.forEach(p => {
            if (p.el > maxEl) {
                maxEl = p.el;
                maxPoint = p;
            }
        });

        const maxPos = this.toCanvasCoords(maxPoint.az, maxPoint.el, centerX, centerY, radius);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(maxPos.x, maxPos.y, 8, 0, 2 * Math.PI);
        ctx.stroke();

        // Max elevation label
        ctx.fillStyle = '#ffff00';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('MAX ' + Math.round(maxEl) + '°', maxPos.x, maxPos.y - 15);
    },

    // Main render function
    render: function (points, satName) {
        this.canvas = document.getElementById('polarChart');
        this.ctx = this.canvas.getContext('2d');

        // Set canvas size
        const size = 350;
        this.canvas.width = size;
        this.canvas.height = size;

        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 2 - 40;  // Leave margin for labels

        this.drawGrid(centerX, centerY, radius);
        this.drawPath(points, centerX, centerY, radius);
    }
};

function showPolarPlot(satId, startTs, endTs, satName) {
    $('#polar-title').html('<i class="fa-solid fa-compass me-2"></i>' + satName + ' Pass');

    $.get(`/api/polar?sat_id=${satId}&start=${startTs}&end=${endTs}`, function (data) {
        if (!data.points || data.points.length === 0) {
            alert('No data available for this pass');
            return;
        }

        PolarPlot.render(data.points, satName);
        new bootstrap.Modal('#polarModal').show();
    });
}


function jumpTo(tsMs, id) {
    simulationTime = tsMs;
    scrubberBaseTime = tsMs;
    $('#scrubber').val(0);
    selectedSatId = id;

    let d = new Date(simulationTime);
    let offset = d.getTimezoneOffset() * 60000;
    let localIso = new Date(d.getTime() - offset).toISOString().slice(0, 16);
    $('#expert-time').val(localIso);

    isPlaying = true; updateIcon();
    checkEphemerisBounds();
    renderPassList();
    updateVisuals(true);
}

function openDatePicker() {
    $('#expert-time').trigger('focus');
}

// ========== SATELLITE SEARCH ==========
let searchTimeout = null;

function searchSatellites(query) {
    clearTimeout(searchTimeout);

    if (query.length < 2) {
        $('#search-results').html('<div class="text-muted small p-2">Type at least 2 characters to search...</div>');
        return;
    }

    searchTimeout = setTimeout(() => {
        $.get('/api/search?q=' + encodeURIComponent(query), function (results) {
            let html = '';

            if (results.length === 0) {
                html = '<div class="text-muted small p-2">No satellites found</div>';
            } else {
                results.forEach(sat => {
                    let statusBadge = sat.already_tracked
                        ? '<span class="badge bg-secondary">Already Tracked</span>'
                        : '<button class="btn btn-sm btn-success" onclick="addSatFromSearch(\'' + sat.norad_id + '\', \'' + sat.name.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-plus"></i> Add</button>';

                    html += `
                    <div class="d-flex justify-content-between align-items-center p-2 border-bottom border-secondary">
                        <div>
                            <strong class="text-white">${sat.name}</strong>
                            <small class="text-muted ms-2">#${sat.norad_id}</small>
                        </div>
                        ${statusBadge}
                    </div>`;
                });
            }

            $('#search-results').html(html);
        });
    }, 300);
}

function addSatFromSearch(noradId, name) {
    // Add to the satellite editor list
    let html = `
    <div class="d-flex align-items-center p-2 border-bottom border-secondary sat-row">
        <input type="hidden" class="sat-id" value="${noradId}">
        <div class="flex-grow-1">
            <input class="form-control form-control-sm bg-dark text-white border-0 sat-name" value="${name}">
        </div>
        <div class="ms-2" style="width: 80px;">
            <input type="number" class="form-control form-control-sm bg-dark text-white border-0 sat-rad" value="1500" placeholder="km">
        </div>
        <div class="ms-2" style="width: 120px;">
            <input class="form-control form-control-sm bg-dark text-white border-0 sat-freq" placeholder="Freq">
        </div>
        <button class="btn btn-sm btn-outline-danger ms-2" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
            <i class="fa-solid fa-trash"></i>
        </button>
    </div>`;

    $('#sat-editor-list').prepend(html);
    $('#sat-search').val('');
    $('#search-results').html('<div class="text-success small p-2"><i class="fa-solid fa-check"></i> Added! Don\'t forget to save.</div>');
    updateSatCount();
}

function updateSatCount() {
    $('#sat-count').text($('.sat-row').length);
}

// Config
function toggleConfig() {
    $.get('/api/config', function (data) {
        $('#cfg-lat').val(data.latitude);
        $('#cfg-lon').val(data.longitude);
        $('#cfg-name').val(data.name);
        renderSatEditor(data.satellites);
        $('#search-results').html('');
        $('#sat-search').val('');
        new bootstrap.Modal('#configModal').show();
    });
}

function renderSatEditor(sats) {
    let html = '';
    Object.keys(sats).forEach(id => {
        let s = sats[id];
        let rad = s.transmission_radius_km || 1500;
        let name = s.name || '';
        let freq = s.frequency || '';

        html += `
        <div class="d-flex align-items-center p-2 border-bottom border-secondary sat-row">
            <input type="hidden" class="sat-id" value="${id}">
            <div class="flex-grow-1">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-name" value="${name}">
                <small class="text-muted">#${id}</small>
            </div>
            <div class="ms-2" style="width: 80px;">
                <input type="number" class="form-control form-control-sm bg-dark text-white border-0 sat-rad" value="${rad}" placeholder="km">
            </div>
            <div class="ms-2" style="width: 120px;">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-freq" value="${freq}" placeholder="Freq">
            </div>
            <button class="btn btn-sm btn-outline-danger ms-2" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;
    });
    $('#sat-editor-list').html(html);
    updateSatCount();
}

function addSatRow() {
    let html = `
    <div class="d-flex align-items-center p-2 border-bottom border-secondary sat-row">
        <div class="flex-grow-1">
            <input class="form-control form-control-sm bg-dark text-white border-0 sat-id" placeholder="NORAD ID">
        </div>
        <div class="ms-2 flex-grow-1">
            <input class="form-control form-control-sm bg-dark text-white border-0 sat-name" placeholder="Name">
        </div>
        <div class="ms-2" style="width: 80px;">
            <input type="number" class="form-control form-control-sm bg-dark text-white border-0 sat-rad" value="1500" placeholder="km">
        </div>
        <button class="btn btn-sm btn-outline-danger ms-2" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
            <i class="fa-solid fa-trash"></i>
        </button>
    </div>`;
    $('#sat-editor-list').prepend(html);
    updateSatCount();
}

function saveConfig() {
    let sats = {};
    $('.sat-row').each(function () {
        let id = $(this).find('.sat-id').val();
        if (id) {
            sats[id] = {
                name: $(this).find('.sat-name').val(),
                transmission_radius_km: parseFloat($(this).find('.sat-rad').val()) || 1500,
                frequency: $(this).find('.sat-freq').val(),
                modulation: '',
                bandwidth: "",
                description: "", antenna_type: "", antenna_notes: ""
            };
        }
    });

    $.ajax({
        url: '/api/config', type: 'POST', contentType: 'application/json',
        data: JSON.stringify({
            name: $('#cfg-name').val(),
            latitude: $('#cfg-lat').val(),
            longitude: $('#cfg-lon').val()
        }),
        success: () => {
            $.ajax({
                url: '/api/satellites', type: 'POST', contentType: 'application/json',
                data: JSON.stringify(sats),
                success: () => location.reload()
            });
        }
    });
}

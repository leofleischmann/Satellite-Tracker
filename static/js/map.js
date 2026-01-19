// ========== MAP & VISUALS MODULE ==========

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        keyboard: false,
        zoomSnap: 0.5,
        preferCanvas: true,
        updateWhenZooming: false,
        updateWhenIdle: true,
        wheelPxPerZoomLevel: 120,
        zoomAnimation: true,
        markerZoomAnimation: true
    }).setView([0, 0], 3);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        keepBuffer: 4,
        updateWhenZooming: false
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);
    map.on('click', () => { selectedSatId = null; updateVisuals(true); });
}

function updateVisuals(forceTrajectory) {
    let simSec = simulationTime / 1000.0;

    Object.keys(ephemerisData).forEach((id, idx) => {
        let points = ephemerisData[id];
        let posData = interpolatePos(points, simSec);

        if (posData) {
            updateSatVisuals(id, posData, idx, forceTrajectory ? points : null, posData.idx);
        } else {
            if (satLabels[id]) {
                map.removeLayer(satLabels[id]);
                delete satLabels[id];
            }
        }
    });
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
    let shouldShow = isSel || showRadii;

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
            let windowSize = isSel ? 360 : 120;
            let skipFactor = isSel ? 1 : 3;

            let startIdx = Math.max(0, currentIdx - windowSize);
            let endIdx = Math.min(points.length, currentIdx + windowSize);

            const drawTrace = (iStart, iEnd, isDashed) => {
                let segments = [];
                let currentSegment = [];

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

                let opacity = isSel ? 0.9 : 0.4;
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

            drawTrace(startIdx, currentIdx + 1, true);
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
        }
    } else {
        if (satLabels[id]) {
            map.removeLayer(satLabels[id]);
            delete satLabels[id];
        }
    }
}

// ========== POLAR PLOT MODULE ==========
const PolarPlot = {
    canvas: null,
    ctx: null,

    toCanvasCoords: function (az, el, centerX, centerY, radius) {
        const r = radius * (1 - el / 90);
        const angleRad = (az - 90) * Math.PI / 180;
        return {
            x: centerX + r * Math.cos(angleRad),
            y: centerY + r * Math.sin(angleRad)
        };
    },

    drawGrid: function (centerX, centerY, radius) {
        const ctx = this.ctx;

        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        [30, 60].forEach(el => {
            const r = radius * (1 - el / 90);
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
            ctx.stroke();
        });

        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        for (let az = 0; az < 360; az += 45) {
            const edge = this.toCanvasCoords(az, 0, centerX, centerY, radius);
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(edge.x, edge.y);
            ctx.stroke();
        }

        ctx.fillStyle = '#888';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const labels = [
            { az: 0, label: 'N' }, { az: 45, label: 'NE' }, { az: 90, label: 'E' }, { az: 135, label: 'SE' },
            { az: 180, label: 'S' }, { az: 225, label: 'SW' }, { az: 270, label: 'W' }, { az: 315, label: 'NW' }
        ];

        labels.forEach(l => {
            const pos = this.toCanvasCoords(l.az, -8, centerX, centerY, radius);
            ctx.fillText(l.label, pos.x, pos.y);
        });

        ctx.fillStyle = '#666';
        ctx.font = '11px sans-serif';
        [0, 30, 60, 90].forEach(el => {
            const pos = this.toCanvasCoords(0, el, centerX, centerY, radius);
            ctx.fillText(el + '°', pos.x + 15, pos.y);
        });
    },

    drawPath: function (points, centerX, centerY, radius) {
        const ctx = this.ctx;
        if (points.length < 2) return;

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

        points.forEach((p, i) => {
            const pos = this.toCanvasCoords(p.az, p.el, centerX, centerY, radius);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 3, 0, 2 * Math.PI);

            if (i === 0) {
                ctx.fillStyle = '#00ff00';
                ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI);
            } else if (i === points.length - 1) {
                ctx.fillStyle = '#ff0000';
                ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI);
            } else {
                ctx.fillStyle = '#00d2ff';
            }
            ctx.fill();
        });

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

        ctx.fillStyle = '#ffff00';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('MAX ' + Math.round(maxEl) + '°', maxPos.x, maxPos.y - 15);
    },

    render: function (points, satName) {
        this.canvas = document.getElementById('polarChart');
        this.ctx = this.canvas.getContext('2d');

        const size = 350;
        this.canvas.width = size;
        this.canvas.height = size;

        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 2 - 40;

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

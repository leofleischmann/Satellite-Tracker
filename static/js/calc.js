// ========== CACLULATION MODULE ==========

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

        // Close logic for active pass at end of data
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

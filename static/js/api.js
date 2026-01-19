// ========== API MODULE ==========

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

function saveConfig() {
    let sats = {};
    $('.sat-row').each(function () {
        let id = $(this).find('.sat-id').val();
        if (id) {
            sats[id] = {
                name: $(this).find('.sat-name').val(),
                transmission_radius_km: parseFloat($(this).find('.sat-rad').val()) || 1500,
                frequency: $(this).find('.sat-freq').val(),
                samplerate: $(this).find('.sat-rate').val(),
                ssh_command: $(this).find('.sat-cmd').val()
            };
        }
    });

    $.ajax({
        url: '/api/config', type: 'POST', contentType: 'application/json',
        data: JSON.stringify({
            name: $('#cfg-name').val(),
            latitude: $('#cfg-lat').val(),
            longitude: $('#cfg-lon').val(),
            ssh_host: $('#cfg-ssh-host').val(),
            ssh_user: $('#cfg-ssh-user').val(),
            ssh_password: $('#cfg-ssh-pass').val()
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

// Global set of scheduled job IDs (constructed client-side from server check or local interactions)
let scheduledPasses = new Set();

function checkScheduledJobs() {
    $.get('/api/scheduled', function (res) {
        // jobs look like 'rec_SATID_TIMESTAMP'
        scheduledPasses.clear();
        res.jobs.forEach(jid => scheduledPasses.add(jid));
        updateRecordButtons();
    });
}

function updateRecordButtons() {
    // Iterate over all record buttons to update state
    $('.record-btn').each(function () {
        let btnId = $(this).attr('id'); // btn-rec-25544-168...
        if (!btnId) return;

        // Extract satId and startTs from btnId
        // Format: btn-rec-{satId}-{startTime}
        let parts = btnId.split('-');
        if (parts.length < 4) return;

        let satId = parts[2];
        let startTime = parts[3];
        let jobId = `rec_${satId}_${startTime}`;

        if (scheduledPasses.has(jobId)) {
            $(this).removeClass('btn-outline-danger').addClass('btn-danger pulse-red');
            $(this).html('<i class="fa-solid fa-stop me-2"></i> CANCEL RECORDING');
        } else {
            $(this).removeClass('btn-danger pulse-red').addClass('btn-outline-danger');
            $(this).html('<i class="fa-solid fa-circle-dot me-2"></i> RECORD');
        }
    });
}

function recordSat(id, name, durationSeconds, startTime) {
    // If it's already scheduled, we don't need to confirm cancellation, just do it.
    // If it's new, maybe confirms? User said "Toggle". Let's make it quick.

    $.ajax({
        url: '/api/record',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ sat_id: id, duration: durationSeconds, start_time: startTime }),
        success: function (res) {
            if (res.status === 'scheduled') {
                scheduledPasses.add(res.job_id);
                // alert('Scheduled: ' + res.message);
                updateRecordButtons();
            } else if (res.status === 'cancelled') {
                scheduledPasses.delete(res.job_id);
                // alert('Cancelled');
                updateRecordButtons();
            } else {
                alert(res.message);
            }
        },
        error: function (xhr) {
            let msg = xhr.responseJSON ? xhr.responseJSON.message : 'Unknown error';
            alert('Error: ' + msg);
        }
    });
}

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

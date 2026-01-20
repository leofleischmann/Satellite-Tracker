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

// Function to test SSH connection
function testSSH() {
    let btn = event.currentTarget;
    let originalHtml = $(btn).html();
    $(btn).prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i> Testing...');

    let payload = {
        ssh_host: $('#cfg-ssh-host').val(),
        ssh_user: $('#cfg-ssh-user').val(),
        ssh_password: $('#cfg-ssh-pass').val()
    };

    $.ajax({
        url: '/api/test_ssh',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        success: function (res) {
            if (res.success) {
                alert('Connection Successful!\nOutput: ' + res.message);
            } else {
                alert('Connection Failed:\n' + res.message);
            }
        },
        error: function (xhr) {
            alert('Error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'Unknown error'));
        },
        complete: function () {
            $(btn).prop('disabled', false).html(originalHtml);
        }
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

// ========== CONFIGURATION ==========

function loadConfig() {
    $.get('/api/settings', function (data) {
        $('#cfg-name').val(data.station_name);
        $('#cfg-lat').val(data.location.lat);
        $('#cfg-lon').val(data.location.lon);

        // Handle Execution Mode
        // stored as 'local' or 'ssh' (defaulting to 'ssh' if undefined)
        let mode = data.execution_mode || 'ssh';

        // UI uses a checkbox: Checked = Local, Unchecked = SSH
        $('#cfg-exec-mode').prop('checked', mode === 'local');

        $('#cfg-ssh-host').val(data.ssh_host);
        $('#cfg-ssh-user').val(data.ssh_user);
        $('#cfg-ssh-pass').val(data.ssh_password);

        // Trigger UI update based on mode
        toggleSSHFields();

        // Also load satellites config for the editor
        loadSatellitesConfig();
    });
}

function toggleSSHFields() {
    let isLocal = $('#cfg-exec-mode').is(':checked');
    if (isLocal) {
        $('#ssh-config-container').hide();
        $('#btn-test-ssh').hide(); // Hide test button in local mode
        $('#exec-mode-label').text('Local (Execute on this device)');
    } else {
        $('#ssh-config-container').show();
        $('#btn-test-ssh').show();
        $('#exec-mode-label').text('Remote via SSH');
    }
}

function saveConfig() {
    let mode = $('#cfg-exec-mode').is(':checked') ? 'local' : 'ssh';

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
        url: '/api/settings',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            station_name: $('#cfg-name').val(),
            lat: parseFloat($('#cfg-lat').val()),
            lon: parseFloat($('#cfg-lon').val()),
            execution_mode: mode,
            ssh_host: $('#cfg-ssh-host').val(),
            ssh_user: $('#cfg-ssh-user').val(),
            ssh_password: $('#cfg-ssh-pass').val(),
            satellites: sats
        }),
        success: function (res) {
            alert('Settings saved!');
            location.reload();
        },
        error: function (xhr) {
            alert('Error saving settings: ' + xhr.responseText);
        }
    });
}

// Global storage for scheduled jobs with time ranges
let scheduledPasses = new Set();
let scheduledJobDetails = [];  // Array of {job_id, start_time, end_time, sat_name}

function checkScheduledJobs() {
    $.get('/api/scheduled', function (res) {
        scheduledPasses.clear();
        scheduledJobDetails = res.jobs || [];
        scheduledJobDetails.forEach(job => scheduledPasses.add(job.job_id));
        updateRecordButtons();
    });
}

// Check if a new recording would conflict with existing scheduled recordings
function checkConflict(newStart, newEnd) {
    for (let job of scheduledJobDetails) {
        // Two time ranges overlap if: start1 < end2 AND start2 < end1
        if (newStart < job.end_time && job.start_time < newEnd) {
            return job;  // Return the conflicting job
        }
    }
    return null;
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

        let isScheduled = scheduledPasses.has(jobId);
        let currentState = $(this).attr('data-scheduled') === 'true';

        // Only update DOM if state actually changed
        if (isScheduled && !currentState) {
            $(this).attr('data-scheduled', 'true');
            $(this).removeClass('btn-outline-danger').addClass('btn-danger pulse-red');
            $(this).html('<i class="fa-solid fa-stop me-2"></i> CANCEL RECORDING');
        } else if (!isScheduled && currentState) {
            $(this).attr('data-scheduled', 'false');
            $(this).removeClass('btn-danger pulse-red').addClass('btn-outline-danger');
            $(this).html('<i class="fa-solid fa-circle-dot me-2"></i> RECORD');
        }
    });
}

function recordSat(id, name, durationSeconds, startTime) {
    let endTime = startTime + (durationSeconds * 1000);
    let jobId = `rec_${id}_${startTime}`;

    // Check if this job is already scheduled (user wants to cancel)
    if (scheduledPasses.has(jobId)) {
        // Just cancel it
        doRecordRequest(id, durationSeconds, startTime);
        return;
    }

    // Check for conflicts with existing scheduled recordings
    let conflict = checkConflict(startTime, endTime);

    if (conflict) {
        // There's a conflict - ask user which one to keep
        let conflictStart = new Date(conflict.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let conflictEnd = new Date(conflict.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let newStart = new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let newEnd = new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let choice = confirm(
            `⚠️ KONFLIKT ERKANNT!\n\n` +
            `Die Aufnahme für "${name}" (${newStart} - ${newEnd}) überlappt mit:\n` +
            `"${conflict.sat_name}" (${conflictStart} - ${conflictEnd})\n\n` +
            `Der RTL-SDR kann nur einen Satelliten gleichzeitig empfangen.\n\n` +
            `OK = Alte Aufnahme abbrechen und NEUE planen\n` +
            `Abbrechen = Alte Aufnahme behalten`
        );

        if (choice) {
            // User chose to replace - first cancel the conflicting job
            cancelRecording(conflict.job_id, function () {
                // Then schedule the new one
                doRecordRequest(id, durationSeconds, startTime);
            });
        }
        // If user clicked cancel, do nothing
        return;
    }

    // No conflict - just schedule
    doRecordRequest(id, durationSeconds, startTime);
}

function cancelRecording(jobId, callback) {
    // Extract sat_id and start_time from jobId (format: rec_SATID_TIMESTAMP)
    let parts = jobId.split('_');
    if (parts.length < 3) return;

    let satId = parts[1];
    let startTime = parseInt(parts[2]);

    $.ajax({
        url: '/api/record',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ sat_id: satId, duration: 0, start_time: startTime }),
        success: function (res) {
            if (res.status === 'cancelled') {
                scheduledPasses.delete(res.job_id);
                // Also remove from details
                scheduledJobDetails = scheduledJobDetails.filter(j => j.job_id !== res.job_id);
                updateRecordButtons();
            }
            if (callback) callback();
        },
        error: function () {
            if (callback) callback();
        }
    });
}

function doRecordRequest(id, durationSeconds, startTime) {
    $.ajax({
        url: '/api/record',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ sat_id: id, duration: durationSeconds, start_time: startTime }),
        success: function (res) {
            if (res.status === 'scheduled') {
                scheduledPasses.add(res.job_id);
                // Refresh job details from server to get accurate end_time
                checkScheduledJobs();
            } else if (res.status === 'cancelled') {
                scheduledPasses.delete(res.job_id);
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

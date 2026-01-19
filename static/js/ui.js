// ========== UI MODULE ==========

function initUI() {
    updateIcon();

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

    $(document).on('keydown', function (e) {
        if ($(e.target).is('input, textarea')) return;

        switch (e.key) {
            case ' ': e.preventDefault(); togglePlay(); break;
            case 'ArrowLeft': e.preventDefault(); offsetTime(-15); break;
            case 'ArrowRight': e.preventDefault(); offsetTime(15); break;
            case 'ArrowUp': e.preventDefault(); offsetTime(60); break;
            case 'ArrowDown': e.preventDefault(); offsetTime(-60); break;
            case 'r': case 'R': resetTime(); break;
            case 't': case 'T': toggleTracks(); break;
        }
    });

    initMobileDrag();

    if (showSatNames) $('#toggle-names-btn').addClass('active');
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
        sidebar.style.transition = 'none';
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const deltaY = startY - e.touches[0].clientY;
        currentHeight = startHeight + deltaY;

        const maxHeight = window.innerHeight * 0.9;
        const minHeight = 60;

        if (currentHeight > maxHeight) currentHeight = maxHeight;
        if (currentHeight < minHeight) currentHeight = minHeight;

        sidebar.style.height = `${currentHeight}px`;
        sidebar.style.maxHeight = 'none';
        sidebar.classList.remove('collapsed');
        $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.cursor = 'grab';
        sidebar.style.transition = 'height 0.3s ease';

        const screenHeight = window.innerHeight;

        if (currentHeight < 150) {
            sidebar.style.height = '';
            sidebar.classList.add('collapsed');
            $('#sidebar-chevron').removeClass('fa-chevron-down').addClass('fa-chevron-up');
        } else if (currentHeight > screenHeight * 0.75) {
            sidebar.style.height = '90vh';
            $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            sidebar.style.height = '50vh';
            $('#sidebar-chevron').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        }
    });
}

function toggleSidebar() {
    let sidebar = $('#sidebar');
    let chevron = $('#sidebar-chevron');
    sidebar.toggleClass('collapsed');

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
        let durationSec = Math.round((p.end_time_ms - p.start_time_ms) / 1000);
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
            </div>
            <button class="btn btn-sm btn-outline-danger w-100 mt-2 record-btn" 
                id="btn-rec-${p.sat_id}-${p.start_time_ms}"
                data-scheduled="false"
                onclick="event.stopPropagation(); recordSat('${p.sat_id}', '${p.name.replace(/'/g, "\\'")}', ${durationSec}, ${p.start_time_ms})">
                <i class="fa-solid fa-circle-dot me-2"></i> RECORD
            </button>
        </div>`;
    });
    $('#pass-list').html(html);
    // After rendering, update buttons based on scheduled state
    if (window.checkScheduledJobs) window.checkScheduledJobs();
}

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

    $('#clock-time').text(timeStr);
    $('#clock-date').text(dateStr);
    $('#mobile-clock-time').text(timeStr);
    $('#mobile-clock-date').text(dateStr);
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

function updateSatCount() {
    $('#sat-count').text($('.sat-row').length);
}

function toggleConfig() {
    $.get('/api/config', function (data) {
        $('#cfg-lat').val(data.latitude);
        $('#cfg-lon').val(data.longitude);
        $('#cfg-name').val(data.name);

        if (data.settings) {
            $('#cfg-ssh-host').val(data.settings.ssh_host || '');
            $('#cfg-ssh-user').val(data.settings.ssh_user || '');
            $('#cfg-ssh-pass').val(data.settings.ssh_password || '');
        }

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
        let cmd = s.ssh_command || '';
        let rate = s.samplerate || '250k';

        html += `
        <div class="p-3 border-bottom border-secondary sat-row bg-dark bg-opacity-25">
            <input type="hidden" class="sat-id" value="${id}">
            
            <div class="row g-2 align-items-center mb-2">
                <!-- ID & Name -->
                <div class="col-md-1 text-center">
                    <span class="badge bg-secondary font-monospace" style="font-size: 0.9em;">${id}</span>
                </div>
                <div class="col-md-3">
                    <label class="form-label text-muted small mb-0 d-none d-md-block">Name</label>
                    <input class="form-control form-control-sm bg-dark text-white border-secondary sat-name" value="${name}" placeholder="Name">
                </div>
                
                <!-- Params -->
                <div class="col-md-2">
                    <label class="form-label text-muted small mb-0 d-none d-md-block">Freq (MHz)</label>
                    <input class="form-control form-control-sm bg-dark text-white border-secondary sat-freq" value="${freq}" placeholder="Freq (MHz)">
                </div>
                <div class="col-md-2">
                    <label class="form-label text-muted small mb-0 d-none d-md-block">Rate</label>
                    <input class="form-control form-control-sm bg-dark text-white border-secondary sat-rate" value="${rate}" placeholder="Rate (e.g. 48k)">
                </div>
                <div class="col-md-2">
                    <label class="form-label text-muted small mb-0 d-none d-md-block">Radius (km)</label>
                    <input type="number" class="form-control form-control-sm bg-dark text-white border-secondary sat-rad" value="${rad}" placeholder="Radius (km)">
                </div>

                <!-- Delete -->
                <div class="col-md-2 text-end">
                    <label class="form-label d-block mb-0">&nbsp;</label>
                    <button class="btn btn-sm btn-outline-danger w-100" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
                        <i class="fa-solid fa-trash me-2"></i>Remove
                    </button>
                </div>
            </div>

            <!-- Command -->
            <div class="row g-2">
                <div class="col-12">
                     <div class="input-group input-group-sm">
                        <span class="input-group-text bg-dark border-secondary text-muted"><i class="fa-solid fa-terminal"></i></span>
                        <input class="form-control bg-dark text-warning border-secondary sat-cmd font-monospace" 
                            value="${cmd.replace(/"/g, '&quot;')}" 
                            placeholder="SSH Command Template (use {filename}, {freq}, {rate}...)">
                     </div>
                </div>
            </div>
        </div>`;
    });
    $('#sat-editor-list').html(html);
    updateSatCount();
}

function addSatRow() {
    let html = `
    <div class="p-2 border-bottom border-secondary sat-row">
        <div class="d-flex align-items-center mb-2">
            <div class="flex-grow-1">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-id" placeholder="NORAD ID">
            </div>
            <div class="ms-2 flex-grow-1">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-name" placeholder="Name">
            </div>
            <div class="ms-2" style="width: 80px;">
                <input type="number" class="form-control form-control-sm bg-dark text-white border-0 sat-rad" value="1500" placeholder="km">
            </div>
             <div class="ms-2" style="width: 100px;">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-freq" placeholder="Freq">
            </div>
             <div class="ms-2" style="width: 80px;">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-rate" value="250k" placeholder="Rate">
            </div>
            <button class="btn btn-sm btn-outline-danger ms-2" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
        <div class="mt-1">
             <input class="form-control form-control-sm bg-dark text-warning border-secondary sat-cmd" 
                placeholder="SSH Command Template">
        </div>
    </div>`;
    $('#sat-editor-list').prepend(html);
    updateSatCount();
}

function addSatFromSearch(noradId, name) {
    let html = `
    <div class="p-2 border-bottom border-secondary sat-row">
        <div class="d-flex align-items-center mb-2">
            <input type="hidden" class="sat-id" value="${noradId}">
            <div class="flex-grow-1">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-name" value="${name}">
                <small class="text-muted">#${noradId}</small>
            </div>
            <div class="ms-2" style="width: 80px;">
                <input type="number" class="form-control form-control-sm bg-dark text-white border-0 sat-rad" value="1500" placeholder="km">
            </div>
            <div class="ms-2" style="width: 100px;">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-freq" placeholder="Freq">
            </div>
             <div class="ms-2" style="width: 80px;">
                <input class="form-control form-control-sm bg-dark text-white border-0 sat-rate" value="250k" placeholder="Rate">
            </div>
            <button class="btn btn-sm btn-outline-danger ms-2" onclick="$(this).closest('.sat-row').remove(); updateSatCount();">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
        <div class="mt-1">
             <input class="form-control form-control-sm bg-dark text-warning border-secondary sat-cmd" 
                placeholder="SSH Command Template">
        </div>
    </div>`;

    $('#sat-editor-list').prepend(html);
    $('#sat-search').val('');
    $('#search-results').html('<div class="text-success small p-2"><i class="fa-solid fa-check"></i> Added! Don\'t forget to save.</div>');
    updateSatCount();
}

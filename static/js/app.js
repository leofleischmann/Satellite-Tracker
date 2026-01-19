// ========== MAIN ENTRY ==========

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

function animationLoop(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
    let delta = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    if (isPlaying) {
        let simDelta = delta * playSpeed;
        simulationTime += simDelta;
        scrubberBaseTime += simDelta;
        updateClock();

        if (Math.abs(simDelta) > 5000) {
            lastTrajectoryUpdate = 0;
        }
    }

    if (isDataLoaded) {
        let forceTrajectory = (timestamp - lastTrajectoryUpdate > 500);
        if (forceTrajectory) lastTrajectoryUpdate = timestamp;

        updateVisuals(forceTrajectory);

        if (timestamp - lastPassUpdate > 1000) {
            lastPassUpdate = timestamp;
            renderPassList();
        }

        if (timestamp % 5000 < 100) {
            checkEphemerisBounds();
        }
    }

    requestAnimationFrame(animationLoop);
}

function checkEphemerisBounds() {
    if (isLoadingEphemeris) return;

    let margin = 2 * 60 * 60 * 1000;
    if (simulationTime < ephemerisStartTs + margin || simulationTime > ephemerisEndTs - margin) {
        console.log('Loading new ephemeris centered on', new Date(simulationTime));
        loadEphemeris(simulationTime, null);
    }
}

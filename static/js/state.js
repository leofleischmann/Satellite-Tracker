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

// Ephemeris bounds
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

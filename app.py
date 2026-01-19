from flask import Flask, jsonify, request, render_template
from flask_compress import Compress
import datetime
import threading
import time
import os
from dateutil import parser
from sattrack import config, tle, calculations

app = Flask(__name__)
Compress(app)  # Enable GZIP compression

# ========== LAZY LOADING STATE ==========
sat_config = None
all_sats = None
my_sats = None
calculator = None
cached_ephemeris = None
cached_ephemeris_time = None
_initialized = False
_init_lock = threading.Lock()

def ensure_initialized():
    """Lazy initialization - loads data on first request."""
    global sat_config, all_sats, my_sats, calculator, _initialized
    
    if _initialized:
        return
    
    with _init_lock:
        if _initialized:  # Double-check after acquiring lock
            return
        
        print("First request - initializing satellite data...")
        sat_config = config.load_sat_config()
        
        print("Downloading/Loading TLE data...")
        all_sats = tle.get_tle_data()
        my_sats = tle.filter_satellites(all_sats, sat_config)
        print(f"Tracking {len(my_sats)} satellites")
        
        enrich_sats()
        calculator = calculations.OrbitCalculator()
        
        print("Pre-calculating ephemeris...")
        refresh_ephemeris()
        
        # Start background TLE refresh thread
        tle_thread = threading.Thread(target=tle_refresh_thread, daemon=True)
        tle_thread.start()
        print("Background TLE refresh thread started")
        
        _initialized = True
        print("Initialization complete!")

# Attach metadata to satellite objects
def enrich_sats():
    for sat in my_sats:
        sid = str(sat.model.satnum)
        meta = sat_config.get(sid, {})
        sat.transmission_radius_km = float(meta.get('transmission_radius_km', 1500))

# ========== EPHEMERIS CACHING ==========
def refresh_ephemeris():
    global cached_ephemeris, cached_ephemeris_time
    now = datetime.datetime.now(datetime.timezone.utc)
    cached_ephemeris = calculator.generate_ephemeris(my_sats, now, hours_radius=48, step_seconds=15)
    cached_ephemeris_time = now
    print(f"Ephemeris cached at {now.isoformat()} (±48 hours)")

def refresh_tle_and_ephemeris():
    """Refreshes TLE data and recalculates ephemeris."""
    global all_sats, my_sats
    print("Background TLE refresh triggered...")
    
    # Force download by deleting cache file age check
    all_sats = tle.get_tle_data(max_age_days=0)  # Force fresh download
    my_sats = tle.filter_satellites(all_sats, sat_config)
    enrich_sats()
    refresh_ephemeris()
    print(f"TLE and ephemeris refreshed. Tracking {len(my_sats)} satellites.")

def tle_refresh_thread():
    """Background thread that checks TLE age every hour and refreshes if >12h old."""
    while True:
        time.sleep(3600)  # Check every hour
        
        try:
            cache_file = config.TLE_CACHE_FILE
            if os.path.exists(cache_file):
                file_age = datetime.datetime.fromtimestamp(os.path.getmtime(cache_file))
                age_hours = (datetime.datetime.now() - file_age).total_seconds() / 3600
                
                if age_hours >= 12:
                    print(f"TLE cache is {age_hours:.1f} hours old. Refreshing...")
                    refresh_tle_and_ephemeris()
                else:
                    print(f"TLE cache is {age_hours:.1f} hours old. No refresh needed.")
        except Exception as e:
            print(f"Error in TLE refresh thread: {e}")

print("Server starting (lazy loading enabled)...")

# ========== ROUTES ==========
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/status')
def get_status():
    ensure_initialized()
    return jsonify({
        'server_time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'location': { 'lat': config.LATITUDE, 'lon': config.LONGITUDE, 'name': config.LOCATION_NAME },
        'tracking_count': len(my_sats) if my_sats else 0,
        'min_elevation': config.MIN_ELEVATION
    })

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    ensure_initialized()
    global sat_config, my_sats
    if request.method == 'POST':
        data = request.json
        if 'latitude' in data: config.LATITUDE = float(data['latitude'])
        if 'longitude' in data: config.LONGITUDE = float(data['longitude'])
        if 'min_elevation' in data: config.MIN_ELEVATION = float(data['min_elevation'])
        calculator.reload_observer()
        return jsonify({'status': 'updated'})
    else:
        return jsonify({
            'latitude': config.LATITUDE,
            'longitude': config.LONGITUDE,
            'altitude': config.ALTITUDE_METERS,
            'name': config.LOCATION_NAME,
            'min_elevation': config.MIN_ELEVATION,
            'satellites': sat_config
        })

@app.route('/api/satellites', methods=['POST'])
def update_satellites():
    ensure_initialized()
    global sat_config, my_sats, cached_ephemeris
    new_config = request.json
    if config.save_sat_config(new_config):
        sat_config = new_config
        my_sats = tle.filter_satellites(all_sats, sat_config)
        enrich_sats()
        refresh_ephemeris()
        return jsonify({'status': 'saved'})
    return jsonify({'status': 'error'}), 500

@app.route('/api/ephemeris')
def get_ephemeris():
    """Returns ephemeris for client-side interpolation."""
    ensure_initialized()
    center_time_str = request.args.get('center_time')
    
    if center_time_str:
        center_time = parser.parse(center_time_str)
        if center_time.tzinfo is None: 
            center_time = center_time.replace(tzinfo=datetime.timezone.utc)
        ephemeris = calculator.generate_ephemeris(my_sats, center_time, hours_radius=48, step_seconds=15)
        return jsonify({
            'center_time': center_time.isoformat(),
            'ephemeris': ephemeris,
            'satellites': sat_config,
            'min_elevation': config.MIN_ELEVATION
        })
    else:
        return jsonify({
            'center_time': cached_ephemeris_time.isoformat(),
            'ephemeris': cached_ephemeris,
            'satellites': sat_config,
            'min_elevation': config.MIN_ELEVATION
        })

@app.route('/api/passes')
def get_passes():
    ensure_initialized()
    time_str = request.args.get('time')
    if time_str:
        start_time = parser.parse(time_str)
        if start_time.tzinfo is None: start_time = start_time.replace(tzinfo=datetime.timezone.utc)
    else:
        start_time = datetime.datetime.now(datetime.timezone.utc)

    passes = calculator.compute_passes(my_sats, start_time, 24)
    return jsonify(passes)

@app.route('/api/polar')
def get_polar_data():
    """Returns Az/El data points for polar plot visualization."""
    ensure_initialized()
    sat_id = request.args.get('sat_id')
    start_ts = request.args.get('start')
    end_ts = request.args.get('end')
    
    if not all([sat_id, start_ts, end_ts]):
        return jsonify({'error': 'Missing parameters'}), 400
    
    # Find the satellite
    sat = None
    for s in my_sats:
        if str(s.model.satnum) == sat_id:
            sat = s
            break
    
    if not sat:
        return jsonify({'error': 'Satellite not found'}), 404
    
    start_time = datetime.datetime.fromtimestamp(float(start_ts)/1000, tz=datetime.timezone.utc)
    end_time = datetime.datetime.fromtimestamp(float(end_ts)/1000, tz=datetime.timezone.utc)
    
    # Generate data points every 10 seconds
    points = []
    ts = calculator.ts
    current = start_time
    
    while current <= end_time:
        t = ts.from_datetime(current)
        diff = sat - calculator.observer
        topocentric = diff.at(t)
        alt, az, _ = topocentric.altaz()
        
        if alt.degrees > 0:  # Only above horizon
            points.append({
                'az': round(az.degrees, 1),
                'el': round(alt.degrees, 1),
                'time': current.isoformat()
            })
        
        current += datetime.timedelta(seconds=10)
    
    return jsonify({
        'sat_name': sat.name,
        'points': points
    })

# ========== SATELLITE SEARCH API ==========
@app.route('/api/search')
def search_satellites():
    """Search for satellites in TLE database by name or NORAD ID."""
    ensure_initialized()
    query = request.args.get('q', '').strip().lower()
    if len(query) < 2:
        return jsonify([])
    
    results = []
    for sat in all_sats:
        name = sat.name.lower()
        norad = str(sat.model.satnum)
        
        if query in name or query in norad:
            results.append({
                'norad_id': norad,
                'name': sat.name,
                'already_tracked': norad in sat_config
            })
        
        if len(results) >= 20:
            break
    
    return jsonify(results)

if __name__ == '__main__':
    print("Starting GalaxyTrack V3...")
    app.run(debug=True, host='0.0.0.0', port=5000)

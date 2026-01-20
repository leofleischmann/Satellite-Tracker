from flask import Flask, jsonify, request, render_template
from flask_compress import Compress
import datetime
import threading
import time
import os
from dateutil import parser
from sattrack import config, tle, calculations, ssh_manager
from apscheduler.schedulers.background import BackgroundScheduler

# Scheduler init
scheduler = BackgroundScheduler()
scheduler.start()
scheduled_jobs = {}  # Track scheduler metadata
pending_recordings = {}  # Queue for Pi-Polling: job_id -> recording details


app = Flask(__name__)
Compress(app)  # Enable GZIP compression

# ========== LAZY LOADING STATE ==========
sat_config = None
app_settings = None
all_sats = None
my_sats = None
calculator = None
cached_ephemeris = None
cached_ephemeris_time = None
_initialized = False
_init_lock = threading.Lock()

def ensure_initialized():
    """Lazy initialization - loads data on first request."""
    global sat_config, all_sats, my_sats, calculator, _initialized, app_settings
    
    if _initialized:
        return
    
    with _init_lock:
        if _initialized:  # Double-check after acquiring lock
            return
        
        print("First request - initializing satellite data...")
        sat_config = config.load_sat_config()
        app_settings = config.load_settings()
        if not app_settings:
            # Defaults
            app_settings = {
                'ssh_host': '192.168.1.50',
                'ssh_user': 'pi',
                'ssh_password': '',
                'ssh_enabled': False
            }
        
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
    global sat_config, my_sats, app_settings
    if request.method == 'POST':
        data = request.json
        if 'latitude' in data: config.LATITUDE = float(data['latitude'])
        if 'longitude' in data: config.LONGITUDE = float(data['longitude'])
        if 'min_elevation' in data: config.MIN_ELEVATION = float(data['min_elevation'])
        
        # Update settings
        if 'ssh_host' in data: app_settings['ssh_host'] = data['ssh_host']
        if 'ssh_user' in data: app_settings['ssh_user'] = data['ssh_user']
        if 'ssh_password' in data: app_settings['ssh_password'] = data['ssh_password']
        
        # Save settings
        config.save_settings(app_settings)
        
        calculator.reload_observer()
        return jsonify({'status': 'updated'})
    else:
        return jsonify({
            'latitude': config.LATITUDE,
            'longitude': config.LONGITUDE,
            'altitude': config.ALTITUDE_METERS,
            'name': config.LOCATION_NAME,
            'min_elevation': config.MIN_ELEVATION,
            'satellites': sat_config,
            'settings': app_settings
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

@app.route('/api/record', methods=['POST'])
def record_satellite():
    ensure_initialized()
    data = request.json
    sat_id = data.get('sat_id')
    
    if not sat_id or sat_id not in sat_config:
        return jsonify({'success': False, 'message': 'Satellite config not found'}), 404
        
    sat_data = sat_config[sat_id]
    duration = data.get('duration')
    
    # Check if SSH is configured
    host = app_settings.get('ssh_host')
    user = app_settings.get('ssh_user')
    password = app_settings.get('ssh_password')
    
    if not host or not user or not password:
         return jsonify({'success': False, 'message': 'SSH not configured. Please check settings.'}), 400

    # Check if satellite has a command
    command_template = sat_data.get('ssh_command')
    if not command_template:
        # Default template fallback? Or error?
        # User requested per-satellite custom command.
        # Use a sensible default if missing?
        return jsonify({'success': False, 'message': 'No SSH command configured for this satellite.'}), 400

    # Scheduler Logic
    start_ts_ms = data.get('start_time')
    
    if start_ts_ms:
        start_time = datetime.datetime.fromtimestamp(start_ts_ms / 1000.0, tz=datetime.timezone.utc)
        job_id = f"rec_{sat_id}_{start_ts_ms}"
        
        # Check if job exists -> Cancel
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
            if job_id in scheduled_jobs:
                del scheduled_jobs[job_id]
            print(f"Cancelled recording job {job_id}")
            return jsonify({'success': True, 'message': 'Recording cancelled', 'status': 'cancelled', 'job_id': job_id})
        
        # Schedule new job
        now = datetime.datetime.now(datetime.timezone.utc)
        if start_time > now:
            # Add sat_id to sat_data for the queued recording
            sat_data_with_id = sat_data.copy()
            sat_data_with_id['sat_id'] = sat_id
            
            scheduler.add_job(
                execute_recording, 
                'date', 
                run_date=start_time, 
                args=[job_id, command_template, sat_data_with_id, duration],
                id=job_id
            )
            scheduled_jobs[job_id] = {
                'sat_id': sat_id,
                'start_time': start_ts_ms,
                'end_time': start_ts_ms + (duration * 1000),
                'duration': duration,
                'sat_name': sat_data.get('name')
            }
            print(f"Scheduled recording {job_id} for {start_time}")
            return jsonify({'success': True, 'message': f'Scheduled for {start_time.strftime("%H:%M:%S")}', 'status': 'scheduled', 'job_id': job_id})
            
    # Immediate execution fallback
    immediate_job_id = f"rec_{sat_id}_{int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)}"
    sat_data_with_id = sat_data.copy()
    sat_data_with_id['sat_id'] = sat_id
    execute_recording(immediate_job_id, command_template, sat_data_with_id, duration)
    return jsonify({'success': True, 'message': 'Recording queued for Pi', 'status': 'started'})

def execute_recording(job_id, command_template, sat_data, duration_override=None):
    """
    Instead of SSH, queue the recording for Pi-Polling.
    The Pi client will fetch and execute it.
    """
    if duration_override:
        sat_data_exec = sat_data.copy()
        sat_data_exec['duration'] = str(duration_override)
    else:
        sat_data_exec = sat_data
    
    # Format the command
    cmd = format_recording_command(command_template, sat_data_exec)
    
    # Add to pending queue for Pi to pick up
    pending_recordings[job_id] = {
        'job_id': job_id,
        'sat_id': str(sat_data.get('sat_id', '')),
        'sat_name': sat_data.get('name', 'Unknown'),
        'command': cmd,
        'duration': int(sat_data_exec.get('duration', 600)),
        'status': 'pending',  # pending | running | completed | failed
        'queued_at': int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000),
        'result': None
    }
    print(f"[Pi-Polling] Recording queued: {job_id} -> {sat_data.get('name')}")

def format_recording_command(template, sat_data):
    """Format command template with satellite data."""
    now = datetime.datetime.now()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    
    name = sat_data.get('name', 'Unknown')
    safe_name = "".join([c if c.isalnum() or c in '-_' else '_' for c in name])
    
    freq = sat_data.get('frequency', '0M').replace(' ', '')
    rate = sat_data.get('samplerate', '250k')
    filename = f"{safe_name}_{freq}_{rate}_{timestamp}"
    
    context = {
        'name': safe_name,
        'freq': freq,
        'rate': rate,
        'timestamp': timestamp,
        'filename': filename,
        'duration': sat_data.get('duration', '600'),
        'gain': sat_data.get('gain', '40')
    }
    
    full_context = sat_data.copy()
    full_context.update(context)
    
    return template.format(**full_context)

@app.route('/api/scheduled')
def get_scheduled_jobs():
    """Returns list of currently scheduled jobs with time ranges for conflict detection."""
    jobs = []
    for job_id, job_info in scheduled_jobs.items():
        if scheduler.get_job(job_id):  # Only include jobs that are still scheduled
            jobs.append({
                'job_id': job_id,
                'sat_id': job_info.get('sat_id'),
                'sat_name': job_info.get('sat_name'),
                'start_time': job_info.get('start_time'),
                'end_time': job_info.get('end_time'),
                'duration': job_info.get('duration')
            })
    return jsonify({'jobs': jobs})

@app.route('/api/test_ssh', methods=['POST'])
def test_ssh():
    """
    Legacy endpoint - now checks Pi-Polling status instead of SSH.
    Returns whether the Pi client has been seen recently.
    """
    # Check if we have any recent activity from the Pi
    # The Pi client updates pending_recordings status when it runs
    
    # For now, we do a simple echo test - the Pi client will pick this up
    # and report back, proving it's online
    
    test_job_id = f"test_connection_{int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)}"
    
    pending_recordings[test_job_id] = {
        'job_id': test_job_id,
        'sat_id': 'TEST',
        'sat_name': 'Connection Test',
        'command': 'echo "Pi Client is connected and working!" && hostname && date',
        'duration': 5,
        'status': 'pending',
        'queued_at': int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000),
        'result': None,
        'is_test': True  # Mark as test so we can identify it
    }
    
    return jsonify({
        'success': True, 
        'message': 'Test-Befehl gesendet! Der Pi-Client wird ihn innerhalb von 15 Sekunden abholen. Prüfe die Logs auf dem Pi oder warte auf Status-Update.'
    })

# ========== PI-POLLING API ENDPOINTS ==========

@app.route('/api/pi/pending')
def get_pending_recordings():
    """
    Pi client polls this endpoint to get recordings that need to be executed.
    Returns all pending recordings.
    """
    pending = []
    for job_id, rec in pending_recordings.items():
        if rec['status'] == 'pending':
            pending.append(rec)
    return jsonify({'recordings': pending})

@app.route('/api/pi/status', methods=['POST'])
def update_recording_status():
    """
    Pi client reports recording status (running, completed, failed).
    """
    data = request.json
    job_id = data.get('job_id')
    status = data.get('status')  # running | completed | failed
    result = data.get('result', '')
    
    if not job_id or not status:
        return jsonify({'success': False, 'message': 'Missing job_id or status'}), 400
    
    if job_id in pending_recordings:
        pending_recordings[job_id]['status'] = status
        pending_recordings[job_id]['result'] = result
        pending_recordings[job_id]['updated_at'] = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
        print(f"[Pi-Polling] Status update: {job_id} -> {status}")
        return jsonify({'success': True})
    
    return jsonify({'success': False, 'message': 'Job not found'}), 404

@app.route('/api/pi/recordings')
def get_all_recordings():
    """
    Returns all recordings (for debugging/monitoring).
    """
    return jsonify({'recordings': list(pending_recordings.values())})

@app.route('/api/pi/clear', methods=['POST'])
def clear_completed_recordings():
    """
    Clear completed/failed recordings older than 1 hour.
    """
    now = datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000
    one_hour_ago = now - (60 * 60 * 1000)
    
    to_remove = []
    for job_id, rec in pending_recordings.items():
        if rec['status'] in ('completed', 'failed'):
            updated_at = rec.get('updated_at', rec.get('queued_at', 0))
            if updated_at < one_hour_ago:
                to_remove.append(job_id)
    
    for job_id in to_remove:
        del pending_recordings[job_id]
    
    return jsonify({'success': True, 'removed': len(to_remove)})

if __name__ == '__main__':
    print("Starting GalaxyTrack V3...")
    app.run(debug=True, host='0.0.0.0', port=5000)

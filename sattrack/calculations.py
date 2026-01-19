import math
import datetime
from skyfield.api import Topos, load, wgs84
from . import config

def degrees_to_cardinal(d):
    """Converts azimuth degrees to cardinal direction string."""
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    ix = int((d + 11.25)/22.5)
    return dirs[ix % 16]

class OrbitCalculator:
    def __init__(self):
        self.ts = load.timescale()
        self.reload_observer()

    def reload_observer(self):
        self.observer = Topos(
            latitude_degrees=config.LATITUDE, 
            longitude_degrees=config.LONGITUDE, 
            elevation_m=config.ALTITUDE_METERS
        )

    def compute_passes(self, satellites, start_time_utc=None, hours=24):
        """
        Computes pass events strictly based on Distance < Transmission Radius.
        Uses discrete sampling + binary search refinement.
        """
        if start_time_utc is None: t0 = self.ts.now()
        else: t0 = self.ts.from_datetime(start_time_utc)
        
        # 1. Define time vector (step = 60 seconds)
        duration_days = hours / 24.0
        steps = int(duration_days * 1440) + 2 # epoch + extra
        t_vector = self.ts.tt_jd([t0.tt + i * (1.0/1440.0) for i in range(steps)])
        
        passes = []

        for sat in satellites:
            # Radius
            radius_km = 2500
            if hasattr(sat, 'transmission_radius_km'):
                radius_km = sat.transmission_radius_km
            
            # Vectorized position & distance check
            geocentric = sat.at(t_vector)
            subpoints = wgs84.latlon_of(geocentric)
            
            # Helper to calc distance array
            # We iterate manually for clarity and to handle transitions
            # Optimization: compute all distances? Or check efficiently?
            # Doing 1440 distance calcs per sat is trivial.
            
            on_pass = False
            pass_start_idx = 0
            
            # Extract lat/lon arrays for speed
            lats = subpoints[0].degrees
            lons = subpoints[1].degrees
            
            # We iterate through the time steps
            for i in range(len(t_vector)):
                # Dist calc
                dist = self.great_circle_distance(config.LATITUDE, config.LONGITUDE, lats[i], lons[i])
                
                is_in_range = (dist < radius_km)
                
                if is_in_range and not on_pass:
                    # AOS Transition detected between i-1 and i
                    on_pass = True
                    pass_start_idx = i
                
                elif not is_in_range and on_pass:
                    # LOS Transition detected between i-1 and i
                    on_pass = False
                    
                    # Found a complete pass (or raw segment)
                    # Refine Start: between t[pass_start_idx-1] and t[pass_start_idx]
                    t_prev = t_vector[pass_start_idx-1] if pass_start_idx > 0 else t_vector[0]
                    t_curr = t_vector[pass_start_idx]
                    t_aos = self.find_precise_crossing(sat, t_prev, t_curr, radius_km, 'enter')
                    
                    # Refine End: between t[i-1] and t[i]
                    t_prev_end = t_vector[i-1]
                    t_curr_end = t_vector[i]
                    t_los = self.find_precise_crossing(sat, t_prev_end, t_curr_end, radius_km, 'exit')
                    
                    # Calculate Max Elevation (approximate by checking middle or max of samples?)
                    # Let's check the sample with min distance (approx max el)
                    # Or just check middle time
                    t_mid = self.ts.tt_jd((t_aos.tt + t_los.tt)/2)
                    alt, az, _ = (sat - self.observer).at(t_mid).altaz()
                    
                    passes.append({
                        'sat_id': sat.model.satnum,
                        'name': sat.name,
                        'start_time_iso': t_aos.utc_datetime().isoformat(),
                        'end_time_iso': t_los.utc_datetime().isoformat(),
                        'max_alt': int(alt.degrees),
                        'max_dir': degrees_to_cardinal(az.degrees),
                        'duration_m': int((t_los.tt - t_aos.tt) * 1440)
                    })
                    
            # Handle case where pass is active at end of window?
            # For now ignore or cap at window end.
            
        passes.sort(key=lambda x: x['start_time_iso'])
        return passes

    def find_precise_crossing(self, sat, t_outside, t_inside, radius_km, mode):
        """Refines time where distance == radius."""
        low = t_outside.tt
        high = t_inside.tt
        
        # Binary search for 1 second precision (~15 iterations for 60s window)
        for _ in range(12): 
            mid = (low + high) / 2
            d = self.get_distance(sat, self.ts.tt_jd(mid))
            
            if mode == 'enter': # Moving Outside -> Inside
                if d < radius_km: high = mid # Inside, look earlier
                else: low = mid # Outside, look later
            else: # Moving Inside -> Outside
                if d < radius_km: low = mid # Inside, look later
                else: high = mid # Outside, look earlier
                
        return self.ts.tt_jd(high if mode == 'enter' else low)

    def get_distance(self, sat, t):
        geo = sat.at(t)
        sub = wgs84.latlon_of(geo)
        return self.great_circle_distance(config.LATITUDE, config.LONGITUDE, sub[0].degrees, sub[1].degrees)


    def great_circle_distance(self, lat1, lon1, lat2, lon2):
        R = 6371.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R * c

    def generate_ephemeris(self, satellites, center_time_utc, hours_radius=24, step_seconds=60):
        """
        Generates dense position data for interpolation.
        Now includes altitude for elevation calculation.
        """
        t0 = self.ts.from_datetime(center_time_utc - datetime.timedelta(hours=hours_radius))
        
        # Determine number of steps
        total_seconds = (hours_radius * 2) * 3600
        steps = int(total_seconds / step_seconds)
        
        times = self.ts.tt_jd([t0.tt + i * (step_seconds / 86400.0) for i in range(steps)])
        
        # Prepare result dict
        ephemeris = {}
        
        for sat in satellites:
            sat_id = sat.model.satnum
            geocentric = sat.at(times)
            lat, lon = wgs84.latlon_of(geocentric)
            alt = wgs84.height_of(geocentric)  # Altitude in km
            
            # Pack data: [ts, lat, lon, alt_km]
            # Timestamps as Unix (seconds) for easier JS parsing
            # Unix = (JD - 2440587.5) * 86400
            
            points = []
            for i in range(len(times)):
                unixts = (times[i].tt - 2440587.5) * 86400.0
                pts_lat = lat.degrees[i]
                pts_lon = lon.degrees[i]
                pts_alt = alt.km[i]
                if not (math.isnan(pts_lat)):
                    points.append([unixts, round(pts_lat,4), round(pts_lon,4), round(pts_alt, 1)])
            
            ephemeris[sat_id] = points

        return ephemeris

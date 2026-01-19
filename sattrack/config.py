import json
import os
from colorama import Fore

# --- CONSTANTS ---
# Use variables so they can be modified by API
LATITUDE = 48.417203
LONGITUDE = 8.752587
ALTITUDE_METERS = 445.0
LOCATION_NAME = "Horb am Neckar"

TLE_UPDATE_INTERVAL_DAYS = 0.5  # 12 hours
JSON_FILE = 'satellites.json'
TLE_CACHE_FILE = 'active_satellites.txt'
TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
MIN_ELEVATION = 10.0
EARTH_RADIUS_KM = 6371.0

def load_sat_config(filepath=JSON_FILE):
    try:
        if not os.path.exists(filepath):
            return {}
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(Fore.RED + f"Error loading config: {e}")
        return {}

def save_sat_config(data, filepath=JSON_FILE):
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        return True
    except Exception:
        return False

import os
import datetime
import requests
from skyfield.api import load
from colorama import Fore
from . import config

def get_tle_data(cache_file=config.TLE_CACHE_FILE, max_age_days=config.TLE_UPDATE_INTERVAL_DAYS):
    """
    Ensures valid TLE data exists locally. Downloads if missing or old.
    Returns: List of EarthSatellite objects.
    """
    download_needed = False
    
    # 1. Check for directory conflict
    if os.path.isdir(cache_file):
        print(f"{Fore.RED}CRITICAL ERROR: {cache_file} is a directory, expected a file.")
        print(f"{Fore.YELLOW}Attempting to remove directory...{Fore.RESET}")
        try:
            os.rmdir(cache_file) # Only works if empty
            print(f"{Fore.GREEN}Directory removed.{Fore.RESET}")
            download_needed = True
        except OSError:
             print(f"{Fore.RED}Could not remove directory. Please delete {cache_file} manually.{Fore.RESET}")
             return []

    # 2. Check if file exists and is valid
    if not os.path.exists(cache_file):
        download_needed = True
    elif os.path.getsize(cache_file) == 0:
        print(f"{Fore.YELLOW}TLE file is empty.{Fore.RESET}")
        download_needed = True
    else:
        try:
            file_age = datetime.datetime.fromtimestamp(os.path.getmtime(cache_file))
            age_delta = datetime.datetime.now() - file_age
            if age_delta.total_seconds() > (max_age_days * 86400):
                 print(f"{Fore.YELLOW}TLE data is old ({age_delta}).{Fore.RESET}")
                 download_needed = True
        except OSError:
            download_needed = True

    if download_needed:
        print(f"{Fore.CYAN}Downloading fresh TLE data from Celestrak...")
        headers = {'User-Agent': 'Sattrack/2.0 (Mozilla/5.0)'}
        try:
            r = requests.get(config.TLE_URL, headers=headers, timeout=20)
            r.raise_for_status()
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            
            with open(cache_file, 'wb') as f:
                f.write(r.content)
            print(f"{Fore.GREEN}TLE Download Successful!")
        except Exception as e:
            print(f"{Fore.RED}TLE Download Failed: {e}")
            # Try to use existing file even if old
            if not os.path.exists(cache_file):
                return []

    try:
        # Skyfield loader
        return load.tle_file(cache_file)
    except Exception as e:
        print(f"{Fore.RED}Error parsing TLE file: {e}")
        return []

def filter_satellites(all_sats, config_data):
    """
    Filters the full list of satellites to only those in our config.
    Returns a list of EarthSatellite objects enriched with config names.
    """
    target_ids = set()
    for k in config_data.keys():
        if k.isdigit():
            target_ids.add(int(k))
    
    my_sats = []
    for sat in all_sats:
        sat_id = sat.model.satnum
        if sat_id in target_ids:
            # Overwrite name with custom name from config
            cfg_entry = config_data.get(str(sat_id))
            if cfg_entry and isinstance(cfg_entry, dict):
                 sat.name = cfg_entry.get('name', sat.name)
            elif cfg_entry and isinstance(cfg_entry, str): # Legacy support
                 sat.name = cfg_entry
            
            my_sats.append(sat)
            
    return my_sats

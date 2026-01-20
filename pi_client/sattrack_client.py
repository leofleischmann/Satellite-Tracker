#!/usr/bin/env python3
"""
SatTrack Pi Client - Polling-based recording executor

This script runs on the Raspberry Pi and:
1. Polls the SatTrack server for pending recordings
2. Executes recording commands locally
3. Reports status back to the server

Usage:
    python sattrack_client.py --server http://your-server:5000

Requirements:
    pip install requests
"""

import argparse
import subprocess
import time
import sys
from datetime import datetime

try:
    import requests
except ImportError:
    print("ERROR: 'requests' module not found. Install with: pip install requests")
    sys.exit(1)


class SatTrackClient:
    def __init__(self, server_url, poll_interval=30):
        self.server_url = server_url.rstrip('/')
        self.poll_interval = poll_interval
        self.current_process = None
        self.current_job_id = None
    
    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")
    
    def get_pending_recordings(self):
        """Fetch pending recordings from server."""
        try:
            resp = requests.get(f"{self.server_url}/api/pi/pending", timeout=10)
            if resp.status_code == 200:
                return resp.json().get('recordings', [])
            else:
                self.log(f"Server returned {resp.status_code}", "WARN")
                return []
        except requests.exceptions.RequestException as e:
            self.log(f"Failed to contact server: {e}", "ERROR")
            return []
    
    def report_status(self, job_id, status, result=""):
        """Report recording status to server."""
        try:
            resp = requests.post(
                f"{self.server_url}/api/pi/status",
                json={'job_id': job_id, 'status': status, 'result': result},
                timeout=10
            )
            if resp.status_code == 200:
                self.log(f"Reported status: {job_id} -> {status}")
            else:
                self.log(f"Failed to report status: {resp.status_code}", "WARN")
        except requests.exceptions.RequestException as e:
            self.log(f"Failed to report status: {e}", "ERROR")
    
    def execute_recording(self, recording):
        """Execute a recording command."""
        job_id = recording['job_id']
        command = recording['command']
        sat_name = recording.get('sat_name', 'Unknown')
        duration = recording.get('duration', 600)
        
        self.log(f"Starting recording: {sat_name} (duration: {duration}s)")
        self.log(f"Command: {command}")
        
        # Report that we're starting
        self.report_status(job_id, 'running')
        self.current_job_id = job_id
        
        try:
            # Execute the command
            self.current_process = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Wait for completion
            stdout, stderr = self.current_process.communicate()
            return_code = self.current_process.returncode
            
            self.current_process = None
            self.current_job_id = None
            
            if return_code == 0:
                self.log(f"Recording completed: {sat_name}")
                result = stdout.decode('utf-8', errors='ignore')[:500]  # Limit result size
                self.report_status(job_id, 'completed', result)
            else:
                error_msg = stderr.decode('utf-8', errors='ignore')[:500]
                self.log(f"Recording failed: {sat_name} (exit code {return_code})", "ERROR")
                self.log(f"Error: {error_msg}", "ERROR")
                self.report_status(job_id, 'failed', error_msg)
                
        except Exception as e:
            self.log(f"Exception during recording: {e}", "ERROR")
            self.report_status(job_id, 'failed', str(e))
            self.current_process = None
            self.current_job_id = None
    
    def run(self):
        """Main polling loop."""
        self.log(f"SatTrack Pi Client starting...")
        self.log(f"Server: {self.server_url}")
        self.log(f"Poll interval: {self.poll_interval}s")
        self.log("-" * 50)
        
        while True:
            try:
                # Check for pending recordings
                recordings = self.get_pending_recordings()
                
                if recordings:
                    self.log(f"Found {len(recordings)} pending recording(s)")
                    
                    # Execute the first pending recording
                    # (only one at a time since RTL-SDR is exclusive)
                    recording = recordings[0]
                    self.execute_recording(recording)
                
                # Wait before next poll
                time.sleep(self.poll_interval)
                
            except KeyboardInterrupt:
                self.log("Shutting down...")
                if self.current_process:
                    self.log("Terminating current recording...")
                    self.current_process.terminate()
                break
            except Exception as e:
                self.log(f"Unexpected error: {e}", "ERROR")
                time.sleep(self.poll_interval)


def main():
    parser = argparse.ArgumentParser(description='SatTrack Pi Client')
    parser.add_argument(
        '--server', '-s',
        required=True,
        help='SatTrack server URL (e.g., http://192.168.2.192:5000)'
    )
    parser.add_argument(
        '--interval', '-i',
        type=int,
        default=15,
        help='Polling interval in seconds (default: 15)'
    )
    
    args = parser.parse_args()
    
    client = SatTrackClient(args.server, args.interval)
    client.run()


if __name__ == '__main__':
    main()

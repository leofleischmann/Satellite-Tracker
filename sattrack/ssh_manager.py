import paramiko
import socket
from datetime import datetime
from colorama import Fore

class SSHManager:
    def __init__(self):
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    def execute_command(self, host, user, password, command_template, sat_data, background=True):
        """
        Connects to the remote host and executes the formatted command.
        If background=True, the command runs asynchronously on the remote and SSH returns immediately.
        """
        try:
            # Format command with satellite data
            cmd = self._format_command(command_template, sat_data)
            print(f"{Fore.CYAN}[SSH] Connecting to {user}@{host}:22 ...{Fore.RESET}")
            
            # Try to resolve hostname first
            try:
                resolved_ip = socket.gethostbyname(host)
                print(f"{Fore.CYAN}[SSH] Resolved {host} -> {resolved_ip}{Fore.RESET}")
            except socket.gaierror as dns_err:
                print(f"{Fore.RED}[SSH] DNS resolution failed for {host}: {dns_err}{Fore.RESET}")
                return False, f"DNS resolution failed: {dns_err}"
            
            self.client.connect(host, username=user, password=password, timeout=10)
            print(f"{Fore.GREEN}[SSH] Connected!{Fore.RESET}")
            
            if background:
                # Wrap command to run in background with nohup
                # This ensures the command keeps running even after SSH disconnects
                # Log output to a file on the Pi for debugging
                log_file = f"/tmp/sattrack_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
                bg_cmd = f"nohup bash -c '{cmd}' > {log_file} 2>&1 &"
                print(f"{Fore.YELLOW}[SSH] Background command: {bg_cmd}{Fore.RESET}")
                print(f"{Fore.CYAN}[SSH] Log file on Pi: {log_file}{Fore.RESET}")
                
                stdin, stdout, stderr = self.client.exec_command(bg_cmd)
                
                # Give it a moment to start, then close
                import time
                time.sleep(0.5)
                
                self.client.close()
                print(f"{Fore.GREEN}[SSH] Command started in background. Connection closed.{Fore.RESET}")
                return True, f"Recording started! Check {log_file} on Pi for output."
            else:
                # Synchronous execution (for test commands)
                print(f"{Fore.YELLOW}[SSH] Sync command: {cmd}{Fore.RESET}")
                stdin, stdout, stderr = self.client.exec_command(cmd, timeout=30)
                
                # Read output
                error = stderr.read().decode().strip()
                output = stdout.read().decode().strip()
                
                self.client.close()
                print(f"{Fore.GREEN}[SSH] Connection closed.{Fore.RESET}")
                
                if error:
                    print(f"{Fore.RED}[SSH] stderr: {error}{Fore.RESET}")
                if output:
                    print(f"{Fore.GREEN}[SSH] stdout: {output}{Fore.RESET}")
                
                if error and not output:
                    return False, error
                    
                return True, output if output else "Command executed (no output)"

        except socket.timeout:
            print(f"{Fore.RED}[SSH] Connection timed out to {host}{Fore.RESET}")
            return False, f"Connection timed out to {host}. Check if SSH port 22 is open and the IP is correct."
        except paramiko.AuthenticationException:
            print(f"{Fore.RED}[SSH] Authentication failed for {user}@{host}{Fore.RESET}")
            return False, f"Authentication failed. Check username/password."
        except paramiko.SSHException as ssh_err:
            print(f"{Fore.RED}[SSH] SSH error: {ssh_err}{Fore.RESET}")
            return False, f"SSH error: {ssh_err}"
        except Exception as e:
            print(f"{Fore.RED}[SSH] Exception: {type(e).__name__}: {e}{Fore.RESET}")
            return False, f"{type(e).__name__}: {e}"

    def execute_local_command(self, command_template, sat_data, background=True):
        """
        Executes the command locally on the device running the app.
        Uses subprocess with nohup for background execution.
        """
        try:
            import subprocess
            import os
            
            # Format command
            cmd = self._format_command(command_template, sat_data)
            print(f"{Fore.CYAN}[LOCAL] Executing: {cmd}{Fore.RESET}")
            
            if background:
                # Log file for local execution
                log_file = f"/tmp/sattrack_local_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
                
                # Prepare nohup command for local shell
                # We use subprocess.Popen with shell=True and setsid to detach
                full_cmd = f"nohup bash -c '{cmd}' > {log_file} 2>&1 &"
                print(f"{Fore.YELLOW}[LOCAL] Background command: {full_cmd}{Fore.RESET}")
                print(f"{Fore.CYAN}[LOCAL] Log file: {log_file}{Fore.RESET}")
                
                process = subprocess.Popen(full_cmd, shell=True, preexec_fn=os.setsid)
                
                print(f"{Fore.GREEN}[LOCAL] Command started (PID: {process.pid}){Fore.RESET}")
                return True, f"Local recording started! Check {log_file}"
            else:
                # Synchronous local execution
                process = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                
                if process.returncode == 0:
                    print(f"{Fore.GREEN}[LOCAL] Success: {process.stdout}{Fore.RESET}")
                    return True, process.stdout
                else:
                    print(f"{Fore.RED}[LOCAL] Error: {process.stderr}{Fore.RESET}")
                    return False, process.stderr
                    
        except Exception as e:
            print(f"{Fore.RED}[LOCAL] Exception: {e}{Fore.RESET}")
            return False, str(e)

    def _format_command(self, template, sat_data):
        """
        Substitutes variables into the command template.
        Supported variables: {name}, {freq}, {rate}, {timestamp}, {filename}, {duration}, {gain}
        """
        now = datetime.now()
        timestamp = now.strftime("%Y%m%d_%H%M%S")
        
        name = sat_data.get('name', 'Unknown')
        # Clean name for filename usage
        safe_name = "".join([c if c.isalnum() or c in '-_' else '_' for c in name])
        
        freq = sat_data.get('frequency', '0M').replace(' ', '')
        rate = sat_data.get('samplerate', '250k')
        
        # Derived variables
        filename = f"{safe_name}_{freq}_{rate}_{timestamp}"
        
        # Create full context for formatting
        context = {
            'name': safe_name,
            'freq': freq,
            'rate': rate,
            'timestamp': timestamp,
            'filename': filename,
            'duration': sat_data.get('duration', '600'),
            'gain': sat_data.get('gain', '40')
        }
        
        # Merge with sat_data (sat_data takes precedence for overrides)
        full_context = sat_data.copy()
        full_context.update(context)
        
        return template.format(**full_context)

import paramiko
import time
import socket
from datetime import datetime
from colorama import Fore

class SSHManager:
    def __init__(self):
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    def execute_command(self, host, user, password, command_template, sat_data):
        """
        Connects to the remote host and executes the formatted command.
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
            print(f"{Fore.GREEN}[SSH] Connected! Executing command...{Fore.RESET}")
            print(f"{Fore.YELLOW}[SSH] Command: {cmd}{Fore.RESET}")
            
            stdin, stdout, stderr = self.client.exec_command(cmd)
            
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
                
            return True, f"Output: {output}" if output else "Command sent (no output)"

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

    def _format_command(self, template, sat_data):
        """
        Substitutes variables into the command template.
        Supported variables: {name}, {freq}, {rate}, {timestamp}, {filename}
        """
        now = datetime.now()
        timestamp = now.strftime("%Y%m%d_%H%M%S")
        
        name = sat_data.get('name', 'Unknown')
        # Clean name for filename usage
        safe_name = "".join([c if c.isalnum() or c in '-_' else '_' for c in name])
        
        freq = sat_data.get('frequency', '0M').replace(' ', '')
        rate = sat_data.get('samplerate', '250k') # Default to 250k if missing
        
        # Derived variables
        filename = f"{safe_name}_{freq}_{rate}_{timestamp}"
        
        # Create full context for formatting
        context = {
            'name': safe_name,
            'freq': freq,
            'rate': rate,
            'timestamp': timestamp,
            'filename': filename,
            'duration': sat_data.get('duration', '600'), # Allow duration override if needed
            'gain': sat_data.get('gain', '40')
        }
        
        # Use safe formatting (ignore missing keys if user adds their own?)
        # For now, using standard format, which raises KeyError if missing.
        # Let's wrap in a way that handles partials or custom keys provided in sat_data
        full_context = sat_data.copy()
        full_context.update(context)
        
        return template.format(**full_context)

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
            print(f"{Fore.CYAN}Connecting to {host}...{Fore.RESET}")
            
            self.client.connect(host, username=user, password=password, timeout=10)
            
            print(f"{Fore.GREEN}Executing: {cmd}{Fore.RESET}")
            stdin, stdout, stderr = self.client.exec_command(cmd)
            
            # Read output (non-blocking if possible, but for record we might want to wait a bit or just return)
            # Since the user example used "timeout" in the command, it might run for minutes.
            # We should probably not wait for it to finish if it's long running, 
            # BUT the user example runs `sshpass ... "timeout ... rtl_sdr ..."`
            # If we run this via paramiko exec_command, it returns immediately with the streams.
            # We can check for immediate errors.
            
            error = stderr.read().decode().strip()
            output = stdout.read().decode().strip()
            
            self.client.close()
            
            if error and not output:
                # Some warnings go to stderr, so only treat as error if it looks bad?
                # For now return both.
                print(f"{Fore.RED}SSH Error: {error}{Fore.RESET}")
                return False, error
                
            return True, f"Command sent. Output: {output}"

        except Exception as e:
            print(f"{Fore.RED}SSH Exception: {e}{Fore.RESET}")
            return False, str(e)

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

import json
import subprocess
from datetime import datetime
from colorama import Fore
import threading


class WebhookManager:
    def __init__(self):
        self.timeout = 30  # seconds

    def send_webhook(self, url, payload, fire_and_forget=False):
        """
        Sends a JSON payload to the specified Webhook URL using curl.
        Uses curl because Python requests has IPv6 issues in Docker.
        
        Args:
            url: The webhook URL
            payload: Dictionary to send as JSON
            fire_and_forget: If True, send in background thread and return immediately
        """
        if not url:
            return False, "No Webhook URL configured."

        if fire_and_forget:
            thread = threading.Thread(target=self._send_request, args=(url, payload))
            thread.daemon = True
            thread.start()
            return True, "Webhook sent (fire-and-forget mode)"

        return self._send_request(url, payload)

    def _send_request(self, url, payload):
        """Send webhook using curl subprocess - works with IPv6."""
        try:
            # Add timestamp if not present
            if 'timestamp' not in payload:
                payload['timestamp'] = datetime.now().isoformat()

            json_data = json.dumps(payload)
            
            print(f"{Fore.CYAN}[Webhook] Sending to {url}...{Fore.RESET}")
            
            # Use curl with IPv6 preference (-6 flag)
            # Falls back automatically if IPv6 fails
            result = subprocess.run(
                [
                    'curl', '-6',  # Prefer IPv6
                    '-X', 'POST',
                    '-H', 'Content-Type: application/json',
                    '-d', json_data,
                    '-s',  # Silent mode
                    '-w', '%{http_code}',  # Output status code
                    '-o', '/dev/null',  # Discard response body
                    '--connect-timeout', '10',
                    '--max-time', str(self.timeout),
                    url
                ],
                capture_output=True,
                text=True,
                timeout=self.timeout + 5
            )
            
            status_code = result.stdout.strip()
            
            if result.returncode == 0 and status_code.startswith('2'):
                print(f"{Fore.GREEN}[Webhook] Success: {status_code}{Fore.RESET}")
                return True, f"Webhook sent successfully (Status: {status_code})"
            elif result.returncode == 0:
                print(f"{Fore.RED}[Webhook] Failed: {status_code}{Fore.RESET}")
                return False, f"Webhook failed with status {status_code}"
            else:
                # curl error
                error_msg = result.stderr.strip() or f"curl returned {result.returncode}"
                print(f"{Fore.RED}[Webhook] curl error: {error_msg}{Fore.RESET}")
                return False, f"Connection error: {error_msg}"

        except subprocess.TimeoutExpired:
            msg = f"Request timed out after {self.timeout}s"
            print(f"{Fore.YELLOW}[Webhook] {msg}{Fore.RESET}")
            return False, msg
        except FileNotFoundError:
            # curl not installed - fall back to requests
            print(f"{Fore.YELLOW}[Webhook] curl not found, using requests...{Fore.RESET}")
            return self._send_with_requests(url, payload)
        except Exception as e:
            print(f"{Fore.RED}[Webhook] Error: {e}{Fore.RESET}")
            return False, f"Webhook error: {str(e)}"

    def _send_with_requests(self, url, payload):
        """Fallback to requests library if curl is not available."""
        import requests as req
        try:
            response = req.post(url, json=payload, timeout=self.timeout)
            if response.status_code >= 200 and response.status_code < 300:
                return True, f"Webhook sent (Status: {response.status_code})"
            return False, f"Failed with status {response.status_code}"
        except Exception as e:
            return False, f"Request error: {str(e)}"

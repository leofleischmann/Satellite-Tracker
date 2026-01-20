import requests
import json
from datetime import datetime
from colorama import Fore
import threading
import socket

# Force IPv6 preference - fixes Cloudflare routing issues where IPv4 hangs
# This monkey-patches urllib3 to prefer IPv6 over IPv4
import urllib3.util.connection as urllib3_conn

_orig_allowed_gai_family = urllib3_conn.allowed_gai_family

def _prefer_ipv6():
    """Return AF_INET6 to prefer IPv6 connections."""
    return socket.AF_INET6

# Apply the patch
urllib3_conn.allowed_gai_family = _prefer_ipv6
print("[Webhook] IPv6 preference enabled")

class WebhookManager:
    def __init__(self):
        # (connect_timeout, read_timeout) in seconds
        # Connect timeout: time to establish connection
        # Read timeout: time to wait for server response
        self.default_timeout = (5, 60)  # 5s connect, 60s read

    def send_webhook(self, url, payload, fire_and_forget=False):
        """
        Sends a JSON payload to the specified Webhook URL.
        
        Args:
            url: The webhook URL
            payload: Dictionary to send as JSON
            fire_and_forget: If True, send in background thread and return immediately
        """
        if not url:
            return False, "No Webhook URL configured."

        if fire_and_forget:
            # Run in background thread - don't wait for response
            thread = threading.Thread(target=self._send_request, args=(url, payload))
            thread.daemon = True
            thread.start()
            return True, "Webhook sent (fire-and-forget mode)"

        return self._send_request(url, payload)

    def _send_request(self, url, payload):
        """Internal method to actually send the request."""
        try:
            print(f"{Fore.CYAN}[Webhook] Sending payload to {url}...{Fore.RESET}")
            
            # Add timestamp to payload if not present
            if 'timestamp' not in payload:
                payload['timestamp'] = datetime.now().isoformat()

            headers = {'Content-Type': 'application/json'}
            
            # Use tuple timeout: (connect_timeout, read_timeout)
            response = requests.post(
                url, 
                json=payload, 
                headers=headers, 
                timeout=self.default_timeout
            )
            
            if response.status_code >= 200 and response.status_code < 300:
                print(f"{Fore.GREEN}[Webhook] Success: {response.status_code}{Fore.RESET}")
                return True, f"Webhook sent successfully (Status: {response.status_code})"
            else:
                print(f"{Fore.RED}[Webhook] Failed: {response.status_code} - {response.text}{Fore.RESET}")
                return False, f"Webhook failed with status {response.status_code}: {response.text}"

        except requests.exceptions.ConnectTimeout:
            msg = "Connection timeout - could not reach server within 5 seconds"
            print(f"{Fore.RED}[Webhook] {msg}{Fore.RESET}")
            return False, msg
        except requests.exceptions.ReadTimeout:
            # The request was SENT, but server took too long to respond
            msg = "Request was sent, but server did not respond in time (60s). The webhook may still have been processed."
            print(f"{Fore.YELLOW}[Webhook] {msg}{Fore.RESET}")
            return False, msg
        except requests.exceptions.ConnectionError as e:
            msg = f"Connection error - server unreachable: {str(e)}"
            print(f"{Fore.RED}[Webhook] {msg}{Fore.RESET}")
            return False, msg
        except requests.exceptions.RequestException as e:
            print(f"{Fore.RED}[Webhook] Error: {e}{Fore.RESET}")
            return False, f"Webhook error: {str(e)}"


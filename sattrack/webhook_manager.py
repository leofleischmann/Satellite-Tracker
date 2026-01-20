import requests
import json
from datetime import datetime
from colorama import Fore

class WebhookManager:
    def __init__(self):
        pass

    def send_webhook(self, url, payload):
        """
        Sends a JSON payload to the specified Webhook URL.
        """
        if not url:
            return False, "No Webhook URL configured."

        try:
            print(f"{Fore.CYAN}[Webhook] Sending payload to {url}...{Fore.RESET}")
            
            # Add timestamp to payload if not present
            if 'timestamp' not in payload:
                payload['timestamp'] = datetime.now().isoformat()

            headers = {'Content-Type': 'application/json'}
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            
            if response.status_code >= 200 and response.status_code < 300:
                print(f"{Fore.GREEN}[Webhook] Success: {response.status_code}{Fore.RESET}")
                return True, f"Webhook sent successfully (Status: {response.status_code})"
            else:
                print(f"{Fore.RED}[Webhook] Failed: {response.status_code} - {response.text}{Fore.RESET}")
                return False, f"Webhook failed with status {response.status_code}: {response.text}"

        except requests.exceptions.RequestException as e:
            print(f"{Fore.RED}[Webhook] Error: {e}{Fore.RESET}")
            return False, f"Webhook error: {str(e)}"

import os
import sys
import json
from datetime import datetime, timedelta

class YouTubeKeyManager:
    def __init__(self, keys_file='youtube_api_keys.json'):
        self.keys_file = keys_file
        self.keys_data = self.load_keys()

    def load_keys(self):
        """Load keys from JSON file or create a new one"""
        try:
            with open(self.keys_file, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return {
                "keys": [],
                "usage_log": {}
            }

    def save_keys(self):
        """Save keys to JSON file"""
        with open(self.keys_file, 'w') as f:
            json.dump(self.keys_data, f, indent=2)

    def add_key(self, key):
        """Add a new API key"""
        if key and key not in self.keys_data['keys']:
            self.keys_data['keys'].append(key)
            self.keys_data['usage_log'][key] = {
                "added_at": datetime.now().isoformat(),
                "total_requests": 0,
                "last_reset": datetime.now().isoformat()
            }
            self.save_keys()
            print(f"Added key: {key[:10]}...")

    def get_available_key(self):
        """Get an available key that hasn't exceeded quota"""
        now = datetime.now()
        for key in self.keys_data['keys']:
            key_data = self.keys_data['usage_log'][key]
            last_reset = datetime.fromisoformat(key_data['last_reset'])
            
            # Reset key if more than 24 hours have passed
            if now - last_reset > timedelta(hours=24):
                key_data['total_requests'] = 0
                key_data['last_reset'] = now.isoformat()
                self.save_keys()
                return key

            # Check if key is under quota (assuming 10,000 daily quota)
            if key_data['total_requests'] < 9000:
                return key

        return None

    def log_request(self, key):
        """Log a request for a specific key"""
        if key in self.keys_data['usage_log']:
            self.keys_data['usage_log'][key]['total_requests'] += 1
            self.save_keys()

    def print_key_status(self):
        """Print status of all keys"""
        print("\nYouTube API Key Status:")
        if not self.keys_data['keys']:
            print("No API keys configured.")
            return
        
        for key, data in self.keys_data['usage_log'].items():
            last_reset = datetime.fromisoformat(data['last_reset'])
            print(f"Key: {key[:10]}...")
            print(f"  Total Requests: {data['total_requests']}")
            print(f"  Last Reset: {last_reset}")
            print(f"  Days Since Reset: {(datetime.now() - last_reset).days}")
            print()

def main():
    key_manager = YouTubeKeyManager()
    
    # Check environment variables for keys
    env_keys = [
        os.getenv('YOUTUBE_API_KEY_1'),
        os.getenv('YOUTUBE_API_KEY_2'),
        os.getenv('YOUTUBE_API_KEY_3'),
        os.getenv('YOUTUBE_API_KEY_4'),
        os.getenv('YOUTUBE_API_KEY_5'),
        os.getenv('YOUTUBE_API_KEY_6'),
        os.getenv('YOUTUBE_API_KEY_7'),
        os.getenv('YOUTUBE_API_KEY_8'),
        os.getenv('YOUTUBE_API_KEY_9'),
        os.getenv('YOUTUBE_API_KEY_10'),
        os.getenv('YOUTUBE_API_KEY_11'),
        os.getenv('YOUTUBE_API_KEY_12'),
        os.getenv('YOUTUBE_API_KEY_13')
    ]
    
    # Filter out None values
    env_keys = [key for key in env_keys if key]
    
    # Add keys from environment
    for key in env_keys:
        key_manager.add_key(key)
    
    # Print status
    key_manager.print_key_status()

if __name__ == "__main__":
    main()

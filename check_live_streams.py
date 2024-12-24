import json
import feedparser
import sys
import traceback
from datetime import datetime
import re
import io
import requests
import os

def is_live_stream(entry):
    """
    Determine if an RSS feed entry represents a live stream
    
    Args:
        entry: A feedparser entry object
    
    Returns:
        dict or None: Live stream details if live, None otherwise
    """
    # Check for specific live stream indicators
    live_indicators = [
        r'\bLIVE\b',  # Exact word LIVE
        r'\bLive\b',  # Capitalized Live
        r'\blive\b',  # lowercase live
        r'\bNow\b',   # Indicates current streaming
        r'\bnow\b'
    ]
    
    # Check title and link for live indicators
    title = entry.get('title', '')
    link = entry.get('link', '')
    
    # Check if any live indicator is in the title
    for indicator in live_indicators:
        if re.search(indicator, title, re.IGNORECASE):
            return {
                "title": title,
                "link": link
            }
    
    # Check if link contains /live
    if '/live' in link:
        return {
            "title": title,
            "link": link
        }
    
    return None

def check_channel_live_status(channel_id, platform):
    """
    Check if a YouTube channel is currently streaming live
    
    Args:
        channel_id (str): Channel ID
        platform (str): Streaming platform
    
    Returns:
        dict: Live stream information or None if not streaming
    """
    # Only process YouTube channels
    if platform.lower() != 'youtube':
        return None

    # Validate channel_id
    if not channel_id or not isinstance(channel_id, str):
        print(f"Invalid channel ID: {channel_id}")
        return None

    rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    
    try:
        feed = feedparser.parse(rss_url)
        
        for entry in feed.entries:
            # More robust live stream detection
            live_details = is_live_stream(entry)
            if live_details:
                return {
                    "title": live_details['title'],
                    "link": live_details['link'],
                    "checked_at": datetime.now().isoformat()
                }
        
        return None
    
    except Exception as e:
        print(f"Error checking channel {channel_id}:")
        print(str(e))
        return None

def update_json_file(streamers):
    """
    Update the streamers.json file with live status
    
    Args:
        streamers (list): List of streamers to update
    """
    try:
        file_path = os.path.join(os.path.dirname(__file__), 'streamers.json')
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Update streamers in the loaded data
        for streamer in data['streamers']:
            # Find the matching streamer from the processed list
            matching_streamer = next(
                (s for s in streamers if 
                 s.get('channelId') == streamer.get('channelId') and 
                 s.get('platform') == streamer.get('platform')),
                None
            )
            
            if matching_streamer and matching_streamer.get('isLive'):
                streamer['isLive'] = True
                streamer['title'] = matching_streamer.get('title')
                streamer['liveLink'] = matching_streamer.get('liveLink')
            else:
                streamer['isLive'] = False
                streamer.pop('title', None)
                streamer.pop('liveLink', None)
        
        # Write back to file
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print("Successfully updated streamers.json")
    
    except Exception as e:
        print(f"Error updating JSON file: {e}")

def safe_print(text):
    """
    Print text safely, handling Unicode characters
    """
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode('utf-8', errors='ignore').decode('utf-8'))

def main():
    # Ensure UTF-8 output
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

    # Load streamers from JSON
    try:
        with open('streamers.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            streamers = data.get('streamers', [])
    except Exception as e:
        print("Error loading streamers.json:")
        print(str(e))
        return

    live_channels = []
    processed_channels = 0
    updated_streamers = []
    
    # Check each streamer's channel
    for streamer in streamers:
        # More flexible channel ID extraction
        channel_id = streamer.get('channelId')
        platform = streamer.get('platform', '')
        
        if not channel_id:
            print(f"No channel ID found for streamer: {streamer.get('name', 'Unknown')}")
            continue
        
        processed_channels += 1
        live_status = check_channel_live_status(channel_id, platform)
        
        if live_status:
            # Prepare updated streamer data
            updated_streamer = streamer.copy()
            updated_streamer['isLive'] = True
            updated_streamer['title'] = live_status['title']
            updated_streamer['liveLink'] = live_status['link']
            updated_streamers.append(updated_streamer)
            
            live_status['streamer_name'] = streamer.get('name', 'Unknown')
            live_channels.append(live_status)
        else:
            # Prepare updated streamer data
            updated_streamer = streamer.copy()
            updated_streamer['isLive'] = False
            updated_streamers.append(updated_streamer)
    
    # Update JSON file
    update_json_file(updated_streamers)
    
    # Output results
    safe_print(f"\nProcessed {processed_channels} channels")
    if live_channels:
        safe_print("\nLive Channels:")
        for channel in live_channels:
            safe_print(f"Streamer: {channel['streamer_name']}")
            safe_print(f"Stream Title: {channel['title']}")
            safe_print(f"Stream Link: {channel['link']}")
            safe_print(f"Checked At: {channel['checked_at']}\n")
    else:
        safe_print("No live streams found.")

if __name__ == "__main__":
    main()

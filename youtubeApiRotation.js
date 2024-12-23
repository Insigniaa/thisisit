import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYS_FILE = path.join(__dirname, 'youtube_api_keys.json');

function loadKeys() {
    try {
        const rawData = fs.readFileSync(KEYS_FILE, 'utf8');
        const data = JSON.parse(rawData);
        return data.keys || [];
    } catch (error) {
        console.error('Error loading YouTube API keys:', error);
        return [];
    }
}

function saveKeys(keysData) {
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keysData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving YouTube API keys:', error);
    }
}

let currentKeyIndex = 0;

export function getNextYouTubeApiKey() {
    const keys = loadKeys();
    if (keys.length === 0) {
        throw new Error('No YouTube API keys configured');
    }
    const key = keys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    return key;
}

export function getCurrentYouTubeApiKey() {
    const keys = loadKeys();
    return keys[currentKeyIndex];
}

export async function makeYouTubeRequest(url) {
    const keys = loadKeys();
    const startIndex = currentKeyIndex;
    
    // Load existing keys data
    let keysData;
    try {
        keysData = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    } catch (error) {
        keysData = { keys: [], usage_log: {} };
    }

    // Ensure usage_log exists for all keys
    keys.forEach(key => {
        if (!keysData.usage_log[key]) {
            keysData.usage_log[key] = {
                added_at: new Date().toISOString(),
                total_requests: 0,
                last_reset: new Date().toISOString()
            };
        }
    });
    
    // Try each key until one works or we've tried them all
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const key = keys[currentKeyIndex];
        const keyData = keysData.usage_log[key];
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}key=${key}`;
        
        // Check if key is still within quota (assuming 10,000 daily quota)
        const now = new Date();
        const lastReset = new Date(keyData.last_reset);
        const daysSinceReset = (now - lastReset) / (1000 * 60 * 60 * 24);
        
        if (daysSinceReset >= 1) {
            // Reset key if more than 24 hours have passed
            keyData.total_requests = 0;
            keyData.last_reset = now.toISOString();
        }
        
        if (keyData.total_requests >= 9000) {
            // Skip this key if it's near quota limit
            currentKeyIndex = (currentKeyIndex + 1) % keys.length;
            continue;
        }
        
        try {
            const response = await fetch(fullUrl);
            const data = await response.json();
            
            if (response.ok) {
                // Log successful request
                keyData.total_requests++;
                saveKeys(keysData);
                
                // Move to next key for future requests
                currentKeyIndex = (currentKeyIndex + 1) % keys.length;
                return data;
            }
            
            // Check if it's a quota error
            if (data.error && data.error.errors && 
                data.error.errors.some(e => e.reason === 'quotaExceeded')) {
                // Mark key as exhausted
                keyData.total_requests = 10000;
                saveKeys(keysData);
                
                // Try next key
                currentKeyIndex = (currentKeyIndex + 1) % keys.length;
                
                // If we've tried all keys, throw error
                if (currentKeyIndex === startIndex) {
                    throw new Error('All API keys have exceeded their quota');
                }
                continue;
            }
            
            // If it's not a quota error, throw the error
            throw new Error(data.error ? data.error.message : 'YouTube API request failed');
        } catch (error) {
            if (error.message === 'All API keys have exceeded their quota') {
                throw error;
            }
            // For other errors, try the next key
            currentKeyIndex = (currentKeyIndex + 1) % keys.length;
            
            // If we've tried all keys, throw the last error
            if (currentKeyIndex === startIndex) {
                throw error;
            }
        }
    }
}

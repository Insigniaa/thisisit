// YouTube API key rotation system
function getYouTubeApiKeys() {
    const keys = [
        process.env.YOUTUBE_API_KEY_1,
        process.env.YOUTUBE_API_KEY_2,
        process.env.YOUTUBE_API_KEY_3,
        process.env.YOUTUBE_API_KEY_4,
        process.env.YOUTUBE_API_KEY_5,
        process.env.YOUTUBE_API_KEY_6,
        process.env.YOUTUBE_API_KEY_7,
        process.env.YOUTUBE_API_KEY_8,
        process.env.YOUTUBE_API_KEY_9,
        process.env.YOUTUBE_API_KEY_10
    ].filter(key => key); // Only keep non-null keys
    
    if (keys.length === 0) {
        throw new Error('No YouTube API keys configured');
    }
    return keys;
}

let currentKeyIndex = 0;

export function getNextYouTubeApiKey() {
    const keys = getYouTubeApiKeys();
    const key = keys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    return key;
}

export function getCurrentYouTubeApiKey() {
    const keys = getYouTubeApiKeys();
    return keys[currentKeyIndex];
}

export async function makeYouTubeRequest(url) {
    const keys = getYouTubeApiKeys();
    const startIndex = currentKeyIndex;
    
    // Try each key until one works or we've tried them all
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const key = keys[currentKeyIndex];
        const fullUrl = `${url}${url.includes('?') ? '&' : '?'}key=${key}`;
        
        try {
            const response = await fetch(fullUrl);
            const data = await response.json();
            
            if (response.ok) {
                // Success! Move to next key for future requests
                currentKeyIndex = (currentKeyIndex + 1) % keys.length;
                return data;
            }
            
            // Check if it's a quota error
            if (data.error && data.error.errors && 
                data.error.errors.some(e => e.reason === 'quotaExceeded')) {
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

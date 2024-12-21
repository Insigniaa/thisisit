import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { makeYouTubeRequest } from './youtubeApiRotation.js';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Session middleware
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secure-secret-key',
    name: 'sessionId',
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600000 // 1 hour
    },
    resave: false,
    saveUninitialized: false
}));

// YouTube API quota configuration
const YOUTUBE_CONFIG = {
    QUOTA_LIMIT: 10000,
    SAFETY_BUFFER: 1000, // Keep 1000 quota points as buffer
    WARNING_THRESHOLD: 0.7, // 70% of quota
    CRITICAL_THRESHOLD: 0.9, // 90% of quota
    COSTS: {
        CHANNELS: 1,
        VIDEOS: 1,
        SEARCH: 100
    },
    CACHE_DURATIONS: {
        NORMAL: 5 * 60 * 1000, // 5 minutes
        WARNING: 15 * 60 * 1000, // 15 minutes
        CRITICAL: 30 * 60 * 1000, // 30 minutes
        EMERGENCY: 60 * 60 * 1000 // 1 hour
    },
    PROFILE_PICTURE: {
        UPDATE_INTERVAL: 8 * 60 * 60 * 1000, // 8 hours
        LAST_UPDATED: new Map() // Store last update time for each channel
    }
};

let youtubeQuotaUsed = 0;
let quotaResetTime = new Date();
quotaResetTime.setUTCHours(24, 0, 0, 0); // Next midnight UTC

// Function to reset YouTube quota at midnight UTC
function resetYoutubeQuota() {
    const now = new Date();
    if (now >= quotaResetTime) {
        youtubeQuotaUsed = 0;
        quotaResetTime = new Date();
        quotaResetTime.setUTCHours(24, 0, 0, 0);
        console.log('YouTube quota reset at:', now.toISOString());
    }
}

// Function to get appropriate cache duration based on quota usage
function getYouTubeCacheDuration() {
    const quotaPercentage = youtubeQuotaUsed / YOUTUBE_CONFIG.QUOTA_LIMIT;
    
    if (quotaPercentage >= YOUTUBE_CONFIG.CRITICAL_THRESHOLD) {
        console.log(`CRITICAL quota usage: ${youtubeQuotaUsed}/${YOUTUBE_CONFIG.QUOTA_LIMIT}`);
        return YOUTUBE_CONFIG.CACHE_DURATIONS.EMERGENCY;
    }
    
    if (quotaPercentage >= YOUTUBE_CONFIG.WARNING_THRESHOLD) {
        console.log(`WARNING: High quota usage: ${youtubeQuotaUsed}/${YOUTUBE_CONFIG.QUOTA_LIMIT}`);
        return YOUTUBE_CONFIG.CACHE_DURATIONS.CRITICAL;
    }
    
    if (quotaPercentage >= 0.5) {
        return YOUTUBE_CONFIG.CACHE_DURATIONS.WARNING;
    }
    
    return YOUTUBE_CONFIG.CACHE_DURATIONS.NORMAL;
}

// Function to check if we can make a YouTube API call
function canMakeYoutubeCall(cost = 1) {
    resetYoutubeQuota();
    const availableQuota = YOUTUBE_CONFIG.QUOTA_LIMIT - YOUTUBE_CONFIG.SAFETY_BUFFER;
    const wouldExceedQuota = (youtubeQuotaUsed + cost) > availableQuota;
    
    if (wouldExceedQuota) {
        console.log(`Quota protection: Current: ${youtubeQuotaUsed}, Cost: ${cost}, Available: ${availableQuota}`);
        return false;
    }
    
    return true;
}

// Ban detection configuration
const BAN_DETECTION_CONFIG = {
    MAX_OFFLINE_DAYS: 5,  // Number of days offline before checking for ban
    CHECK_INTERVAL: 24 * 60 * 60 * 1000, // Check every 24 hours
    LAST_CHECKED: new Map() // Store last check time for each streamer
};

// Separate caches for different types of data
const streamerCache = new Map();
const channelInfoCache = new Map();

// Helper function to get YouTube streamer status
async function getYouTubeStreamerStatus(channelId) {
    return getCachedStatus('youtube', channelId, async () => {
        try {
            // Check for bans during status check
            const banStatus = await checkStreamerBan({ channelId, platform: 'youtube' });
            if (banStatus.banned) {
                console.log(`YouTube streamer ${channelId} detected as banned: ${banStatus.reason}`);
                return {
                    isLive: false,
                    title: 'Channel Banned',
                    viewers: 0,
                    thumbnail: null,
                    banned: true,
                    banReason: banStatus.reason
                };
            }

            // First, get channel info
            const channelInfo = await getChannelInfo(channelId);
            console.log('YouTube Channel Info:', channelInfo);

            if (!channelInfo) {
                console.error(`Failed to get channel info for ${channelId}`);
                return {
                    isLive: false,
                    title: 'Channel Not Found',
                    viewers: 0,
                    thumbnail: null,
                    error: true
                };
            }

            // Then check if they're live
            const data = await makeYouTubeRequest(
                `https://www.googleapis.com/youtube/v3/search?` +
                `part=snippet&channelId=${channelId}&type=video&eventType=live`
            );

            if (!data.items || data.items.length === 0) {
                console.log(`No live streams found for ${channelId}`);
                return {
                    isLive: false,
                    title: 'Offline',
                    viewers: 0,
                    thumbnail: channelInfo.thumbnail
                };
            }

            const videoId = data.items[0].id.videoId;
            // Get live stream details including viewer count
            const statsData = await makeYouTubeRequest(
                `https://www.googleapis.com/youtube/v3/videos?` +
                `part=liveStreamingDetails,snippet&id=${videoId}`
            );

            if (!statsData.items || statsData.items.length === 0) {
                console.error('No video data found in YouTube response');
                return {
                    isLive: false,
                    title: 'Error',
                    viewers: 0,
                    thumbnail: null,
                    error: true
                };
            }

            const isLive = true;
            let title = 'Offline';
            let viewers = 0;

            if (isLive) {
                title = statsData.items[0].snippet.title;
                viewers = statsData.items[0].liveStreamingDetails?.concurrentViewers || 0;
            }

            return {
                isLive,
                title,
                viewers: parseInt(viewers) || 0,
                thumbnail: channelInfo.thumbnail
            };
        } catch (error) {
            console.error('Error in getYouTubeStreamerStatus:', error);
            return {
                isLive: false,
                title: 'Error',
                viewers: 0,
                thumbnail: null,
                error: true
            };
        }
    }, getYouTubeCacheDuration());
}

// Get cached channel info
async function getChannelInfo(channelId) {
    try {
        console.log(`Fetching YouTube channel info for ${channelId}`);
        const data = await makeYouTubeRequest(
            `https://www.googleapis.com/youtube/v3/channels?` +
            `part=snippet&id=${channelId}`
        );

        if (!data.items || data.items.length === 0) {
            console.error('No channel found for ID:', channelId);
            return null;
        }

        const channel = data.items[0];
        return {
            title: channel.snippet.title,
            thumbnail: channel.snippet.thumbnails?.default?.url || null
        };
    } catch (error) {
        console.error('Error fetching channel info:', error);
        return null;
    }
}

// Function to check if a channel is banned on YouTube
async function checkYouTubeBan(channelId) {
    try {
        const data = await makeYouTubeRequest(
            `https://www.googleapis.com/youtube/v3/channels?part=status&id=${channelId}`
        );
        
        if (!data.items || data.items.length === 0) {
            return { banned: true, reason: 'Channel not found' };
        }

        const status = data.items[0].status;
        if (status.privacyStatus === 'terminated') {
            return { banned: true, reason: 'Channel terminated' };
        }

        return { banned: false };
    } catch (error) {
        console.error('Error checking YouTube ban:', error);
        return { banned: false, error: error.message };
    }
}

// Function to check if a channel is banned on Kick
async function checkKickBan(channelId) {
    try {
        const response = await fetch(`https://kick.com/api/v1/channels/${channelId}`);
        if (response.status === 404) {
            return { banned: true, reason: 'Channel not found' };
        }
        
        const data = await response.json();
        if (data.error === 'Channel banned' || data.error === 'Account suspended') {
            return { banned: true, reason: data.error };
        }

        return { banned: false };
    } catch (error) {
        console.error('Error checking Kick ban:', error);
        return { banned: false, error: error.message };
    }
}

// Function to check if a channel is banned on Twitch
async function checkTwitchBan(channelId) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelId}`, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${process.env.TWITCH_AUTH_TOKEN}`
            }
        });
        
        const data = await response.json();
        if (!data.data || data.data.length === 0) {
            return { banned: true, reason: 'Channel not found' };
        }

        return { banned: false };
    } catch (error) {
        console.error('Error checking Twitch ban:', error);
        return { banned: false, error: error.message };
    }
}

// Function to check if a streamer is banned based on platform
async function checkStreamerBan(streamer) {
    const now = Date.now();
    let banCheck;

    // Skip ban check if it was done recently
    if (streamer.lastBanCheck && (now - streamer.lastBanCheck < BAN_DETECTION_CONFIG.CHECK_INTERVAL)) {
        return streamer.banned || false;
    }

    switch (streamer.platform.toLowerCase()) {
        case 'youtube':
            banCheck = await checkYouTubeBan(streamer.channelId);
            break;
        case 'kick':
            banCheck = await checkKickBan(streamer.channelId);
            break;
        case 'twitch':
            banCheck = await checkTwitchBan(streamer.channelId);
            break;
        default:
            banCheck = { banned: false };
    }

    // Update last ban check timestamp
    streamer.lastBanCheck = now;
    
    return banCheck.banned || false;
}

// Helper function to get Kick streamer status
async function getKickStreamerStatus(channelId) {
    return getCachedStatus('kick', channelId, async () => {
        try {
            // Check for bans during status check
            const banStatus = await checkStreamerBan({ channelId, platform: 'kick' });
            if (banStatus.banned) {
                console.log(`Kick streamer ${channelId} detected as banned: ${banStatus.reason}`);
                return {
                    isLive: false,
                    title: 'Channel Banned',
                    viewers: 0,
                    thumbnail: null,
                    banned: true,
                    banReason: banStatus.reason
                };
            }

            const response = await fetch(`https://kick.com/api/v1/channels/${channelId}`);
            if (response.status === 404) {
                return { banned: true, reason: 'Channel not found' };
            }
            
            const data = await response.json();
            return {
                isLive: data.livestream !== null,
                viewers: data.livestream ? data.livestream.viewer_count : 0,
                title: data.livestream ? data.livestream.session_title : 'Offline',
                thumbnail: data.user?.profile_pic || null
            };
        } catch (error) {
            console.error('Error fetching Kick streamer status:', error);
            return {
                isLive: false,
                title: 'Error',
                viewers: 0,
                thumbnail: null,
                error: true
            };
        }
    }, getYouTubeCacheDuration());
}

// Helper function to get Twitch streamer status
async function getTwitchStreamerStatus(channelId) {
    return getCachedStatus('twitch', channelId, async () => {
        try {
            // Check for bans during status check
            const banStatus = await checkStreamerBan({ channelId, platform: 'twitch' });
            if (banStatus.banned) {
                console.log(`Twitch streamer ${channelId} detected as banned: ${banStatus.reason}`);
                return {
                    isLive: false,
                    title: 'Channel Banned',
                    viewers: 0,
                    thumbnail: null,
                    banned: true,
                    banReason: banStatus.reason
                };
            }

            const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channelId}`, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${process.env.TWITCH_AUTH_TOKEN}`
                }
            });

            if (!response.ok) {
                throw new Error(`Twitch API error: ${response.status}`);
            }

            const data = await response.json();
            const isLive = data.data && data.data.length > 0;

            return {
                isLive,
                viewers: isLive ? data.data[0].viewer_count : 0,
                title: isLive ? data.data[0].title : 'Offline',
                thumbnail: null // We'll get this from user info
            };
        } catch (error) {
            console.error('Error fetching Twitch streamer status:', error);
            return {
                isLive: false,
                title: 'Error',
                viewers: 0,
                thumbnail: null,
                error: true
            };
        }
    }, getYouTubeCacheDuration());
}

// Cache for storing streamer status
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Get cached status or fetch new status
async function getCachedStatus(platform, channelId, fetchFunction, cacheDuration) {
    const cacheKey = `${platform}-${channelId}`;
    const cached = streamerCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cacheDuration) {
        return { ...cached.data, cached: true };
    }

    try {
        // For YouTube, check quota before making API call
        if (platform.toLowerCase() === 'youtube') {
            if (!canMakeYoutubeCall()) {
                console.log('YouTube API quota exceeded, returning cached data if available');
                if (cached) {
                    return { ...cached.data, cached: true, quotaExceeded: true };
                }
                return { isLive: false, viewerCount: 0, quotaExceeded: true, cached: false };
            }
            youtubeQuotaUsed++;
        }

        const status = await fetchFunction();
        const statusWithMetadata = {
            ...status,
            cached: false,
            lastUpdated: now
        };

        streamerCache.set(cacheKey, {
            timestamp: now,
            data: statusWithMetadata
        });

        return statusWithMetadata;
    } catch (error) {
        console.error(`Error fetching status for ${platform} channel ${channelId}:`, error);
        if (cached) {
            return { ...cached.data, cached: true, error: true };
        }
        return { 
            isLive: false, 
            viewerCount: 0, 
            error: true,
            cached: false,
            errorMessage: error.message 
        };
    }
}

// Function to ensure profiles directory exists
async function ensureProfilesDirectory() {
    const profilesDir = path.join(__dirname, 'images', 'profiles');
    try {
        await fs.access(profilesDir);
    } catch {
        await fs.mkdir(profilesDir, { recursive: true });
    }
    return profilesDir;
}

// Function to safely write file
async function safeWriteFile(filepath, buffer) {
    try {
        // Try to remove existing file first
        try {
            await fs.unlink(filepath);
            console.log(`Removed existing file: ${filepath}`);
        } catch (err) {
            // File doesn't exist, which is fine
            if (err.code !== 'ENOENT') {
                console.error(`Error removing existing file: ${filepath}`, err);
            }
        }

        // Write the new file
        await fs.writeFile(filepath, buffer);
        console.log(`Successfully wrote file: ${filepath}`);
        return true;
    } catch (error) {
        console.error(`Error writing file: ${filepath}`, error);
        return false;
    }
}

// Configuration
const PROFILE_PICTURE_CONFIG = {
    COSTS: {
        CHANNELS: 1,
        SEARCH: 100,
        VIDEOS: 1
    },
    CACHE_DURATIONS: {
        NORMAL: 5 * 60 * 1000, // 5 minutes
        EXTENDED: 15 * 60 * 1000, // 15 minutes
        LONG: 60 * 60 * 1000 // 1 hour
    },
    PROFILE_PICTURE: {
        UPDATE_INTERVAL: 8 * 60 * 60 * 1000, // 8 hours in milliseconds
        LAST_UPDATED: new Map()
    },
    QUOTA: {
        DAILY_LIMIT: 10000,
        RESET_HOUR: 0 // UTC midnight
    }
};

// Cache for profile pictures
const PROFILE_PICTURE_CACHE_FILE = path.join(__dirname, 'cache', 'profile-pictures.json');

// Initialize profile picture cache from file
let PROFILE_PICTURE_CACHE = new Map();
try {
    const cacheData = JSON.parse(await fs.readFile(PROFILE_PICTURE_CACHE_FILE, 'utf8'));
    PROFILE_PICTURE_CACHE = new Map(Object.entries(cacheData));
} catch (error) {
    // Cache file doesn't exist yet, will be created on first update
    console.log('No profile picture cache file found, starting fresh');
}

// Function to save profile picture cache to file
async function saveProfilePictureCache() {
    try {
        await fs.mkdir(path.join(__dirname, 'cache'), { recursive: true });
        const cacheData = Object.fromEntries(PROFILE_PICTURE_CACHE);
        await fs.writeFile(PROFILE_PICTURE_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
        console.error('Error saving profile picture cache:', error);
    }
}

// Function to update profile picture cache
async function updateProfilePictureCache(channelId, platform) {
    const cacheKey = `${platform}-${channelId}`;
    PROFILE_PICTURE_CACHE.set(cacheKey, Date.now());
    await saveProfilePictureCache();
}

// Function to download and save profile picture
async function downloadProfilePicture(url, channelId, platform) {
    try {
        // Check if we already have this profile picture and it's not time to update
        if (!needsProfilePictureUpdate(channelId, platform)) {
            const existingFile = await findExistingProfilePicture(channelId, platform);
            if (existingFile) {
                console.log(`Using existing profile picture for ${platform}-${channelId}`);
                return {
                    channelId,
                    platform,
                    localPath: `/images/profiles/${existingFile}`
                };
            }
        }

        console.log(`Downloading profile picture from: ${url}`);
        
        // Add user agent and headers to avoid blocking
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'image/*',
                'Referer': platform === 'youtube' ? 'https://www.youtube.com/' : 
                          platform === 'kick' ? 'https://kick.com/' : 
                          'https://www.twitch.tv/'
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            throw new Error(`Failed to download profile picture: ${response.status} ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        if (!buffer || buffer.byteLength === 0) {
            throw new Error('Received empty buffer for profile picture');
        }

        await ensureProfilesDirectory();
        
        // Get content type from response
        const contentType = response.headers.get('content-type');
        let ext = 'jpg';  // default extension
        if (contentType) {
            if (contentType.includes('png')) ext = 'png';
            else if (contentType.includes('webp')) ext = 'webp';
            else if (contentType.includes('gif')) ext = 'gif';
        }
        
        const filename = `${platform}-${channelId}.${ext}`;
        const filepath = path.join(__dirname, 'images', 'profiles', filename);

        // Write new file without deleting old one first
        await fs.writeFile(filepath, Buffer.from(buffer));
        console.log(`Successfully wrote file: ${filepath}`);
        
        // Update cache timestamp
        await updateProfilePictureCache(channelId, platform);
        
        return {
            channelId,
            platform,
            localPath: `/images/profiles/${filename}`
        };
    } catch (error) {
        console.error(`Error downloading profile picture for ${platform}-${channelId}:`, error.message);
        // If download fails, try to return existing cached image if available
        const existingFile = await findExistingProfilePicture(channelId, platform);
        if (existingFile) {
            console.log(`Using existing cached profile picture: ${existingFile}`);
            return {
                channelId,
                platform,
                localPath: `/images/profiles/${existingFile}`
            };
        }
        return {
            channelId,
            platform,
            localPath: '/default-avatar.png'  // Fallback to default avatar
        };
    }
}

// Helper function to find existing profile picture
async function findExistingProfilePicture(channelId, platform) {
    try {
        const files = await fs.readdir(path.join(__dirname, 'images', 'profiles'));
        return files.find(f => f.startsWith(`${platform}-${channelId}.`));
    } catch (error) {
        console.error('Error checking for existing profile picture:', error);
        return null;
    }
}

// Function to check if profile picture needs update
function needsProfilePictureUpdate(channelId, platform) {
    const cacheKey = `${platform}-${channelId}`;
    const lastUpdated = PROFILE_PICTURE_CACHE.get(cacheKey);
    const now = Date.now();
    
    if (!lastUpdated) {
        return true;
    }

    const timeSinceUpdate = now - lastUpdated;
    return timeSinceUpdate >= PROFILE_PICTURE_CONFIG.PROFILE_PICTURE.UPDATE_INTERVAL;
}

// Function to get cached profile picture path
function getCachedProfilePicturePath(channelId, platform) {
    const filename = `${platform}-${channelId}.jpg`;
    return `/images/profiles/${filename}`;
}

// Endpoint to proxy profile picture requests
app.get('/proxy-image', async (req, res) => {
    try {
        const { url, channelId, platform } = req.query;
        if (!url || !channelId || !platform) {
            return res.status(400).send('Missing required parameters');
        }

        const result = await downloadProfilePicture(url, channelId, platform);
        if (!result) {
            return res.status(404).send('Failed to get profile picture');
        }

        res.json(result);
    } catch (error) {
        console.error('Error in proxy-image endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to save a streamer's profile picture
app.post('/save-profile-picture', async (req, res) => {
    try {
        const { url, channelId, platform } = req.body;
        
        // Add request logging
        console.log('Received profile picture save request:', { url, channelId, platform });
        
        if (!url || !channelId || !platform) {
            console.error('Missing required fields:', { url, channelId, platform });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let localPath;
        if (platform === 'youtube') {
            localPath = await downloadYouTubeProfilePicture(channelId);
        } else {
            localPath = await downloadProfilePicture(url, channelId, platform);
        }

        if (!localPath) {
            console.error('Failed to save profile picture for:', { channelId, platform });
            return res.status(500).json({ error: 'Failed to save profile picture' });
        }

        console.log('Successfully processed profile picture:', { channelId, platform, localPath });
        res.json({ success: true, path: localPath });
    } catch (error) {
        console.error('Error in save-profile-picture endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to get streamer status with quota information
app.get('/streamers-status', async (req, res) => {
    try {
        const data = await fs.readFile('streamers.json', 'utf8');
        const { streamers } = JSON.parse(data);
        
        if (!Array.isArray(streamers)) {
            throw new Error('Invalid streamers data format');
        }

        const statusPromises = streamers.map(async (streamer) => {
            try {
                let status;
                switch (streamer.platform.toLowerCase()) {
                    case 'kick':
                        status = await getCachedStatus('kick', streamer.channelId, 
                            () => getKickStreamerStatus(streamer.channelId), getYouTubeCacheDuration());
                        break;
                    case 'twitch':
                        status = await getCachedStatus('twitch', streamer.channelId, 
                            () => getTwitchStreamerStatus(streamer.channelId), getYouTubeCacheDuration());
                        break;
                    case 'youtube':
                        status = await getCachedStatus('youtube', streamer.channelId, 
                            () => getYouTubeStreamerStatus(streamer.channelId), getYouTubeCacheDuration());
                        break;
                    default:
                        status = { 
                            isLive: false, 
                            viewerCount: 0, 
                            cached: false,
                            error: true,
                            errorMessage: 'Unknown platform' 
                        };
                }
                
                return { 
                    ...streamer,
                    ...status
                };
            } catch (error) {
                console.error(`Error getting status for ${streamer.name}:`, error);
                return { 
                    ...streamer, 
                    isLive: false, 
                    viewerCount: 0, 
                    error: true,
                    cached: false,
                    errorMessage: error.message 
                };
            }
        });
        
        const results = await Promise.all(statusPromises);
        
        res.json({
            streamers: results,
            quotaInfo: {
                youtube: {
                    used: youtubeQuotaUsed,
                    remaining: YOUTUBE_CONFIG.QUOTA_LIMIT - YOUTUBE_CONFIG.SAFETY_BUFFER - youtubeQuotaUsed,
                    resetTime: quotaResetTime,
                }
            }
        });
    } catch (error) {
        console.error('Error getting streamer status:', error);
        res.status(500).json({ error: 'Failed to get streamer status' });
    }
});

// Endpoint to save streamers
app.post('/save-streamers', async (req, res) => {
    try {
        const { streamers } = req.body;
        await fs.writeFile(
            path.join(__dirname, 'streamers.json'),
            JSON.stringify({ streamers }, null, 4)
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving streamers:', error);
        res.status(500).json({ error: 'Failed to save streamers' });
    }
});

// Secure admin authentication middleware
const adminAuth = (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Admin login endpoint
app.post('/admin-login', async (req, res) => {
    const { password } = req.body;
    
    if (!process.env.ADMIN_PASSWORD) {
        console.error('ADMIN_PASSWORD not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
        if (isValid) {
            req.session.isAdmin = true;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Check auth status endpoint
app.get('/check-auth', (req, res) => {
    res.json({ isAuthenticated: !!req.session.isAdmin });
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('sessionId');
        res.json({ success: true });
    });
});

// Get all streamers
app.get('/streamers', async (req, res) => {
    try {
        const data = await fs.readFile('streamers.json', 'utf8');
        const streamers = JSON.parse(data);
        res.json(streamers.streamers);
    } catch (error) {
        console.error('Error reading streamers:', error);
        res.status(500).json({ error: 'Failed to load streamers' });
    }
});

// Endpoint to get banned streamers
app.get('/banned-streamers', async (req, res) => {
    try {
        const data = await fs.readFile('streamers.json', 'utf8');
        const jsonData = JSON.parse(data);
        const bannedStreamers = jsonData.streamers.filter(streamer => streamer.banned === true);
        res.json({ bannedStreamers });
    } catch (error) {
        console.error('Error getting banned streamers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin endpoints
app.post('/add-streamer', adminAuth, async (req, res) => {
    try {
        const { name, platform, channelId, banned } = req.body;
        console.log(`Adding new streamer: ${name}, Platform: ${platform}, Channel: ${channelId}`);
        const data = await fs.readFile('streamers.json', 'utf8');
        const fileData = JSON.parse(data);
        
        // Fetch Twitch user profile picture if platform is Twitch
        let thumbnail = null;
        if (platform === 'twitch') {
            try {
                console.log(`Fetching Twitch profile for ${channelId}`);
                const twitchUrl = `https://api.twitch.tv/helix/users?login=${channelId}`;
                console.log(`Twitch API URL: ${twitchUrl}`);
                console.log(`Using Client-ID: ${process.env.TWITCH_CLIENT_ID ? 'Present' : 'Missing'}`);
                console.log(`Using Auth Token: ${process.env.TWITCH_AUTH_TOKEN ? 'Present' : 'Missing'}`);
                
                const response = await fetch(twitchUrl, {
                    headers: {
                        'Client-ID': process.env.TWITCH_CLIENT_ID,
                        'Authorization': `Bearer ${process.env.TWITCH_AUTH_TOKEN}`
                    }
                });
                
                console.log(`Twitch API Response Status: ${response.status}`);
                if (response.ok) {
                    const userData = await response.json();
                    console.log('Twitch API Response:', userData);
                    if (userData.data && userData.data.length > 0) {
                        thumbnail = userData.data[0].profile_image_url;
                        console.log(`Found profile URL: ${thumbnail}`);
                    } else {
                        console.log('No user data found in Twitch response');
                    }
                } else {
                    const errorText = await response.text();
                    console.error('Twitch API error response:', errorText);
                }
            } catch (error) {
                console.error('Error fetching Twitch profile picture:', error);
            }
        }
        
        // Add new streamer
        const newStreamer = {
            name,
            platform,
            channelId,
            banned: banned || false,
            title: "Offline",
            thumbnail: thumbnail,
            viewers: 0,
            isLive: false,
            lastOnline: null
        };
        console.log('Adding new streamer with data:', newStreamer);
        
        fileData.streamers.push(newStreamer);
        
        await fs.writeFile('streamers.json', JSON.stringify(fileData, null, 2));
        res.json({ success: true, streamers: fileData.streamers });
    } catch (error) {
        console.error('Failed to save streamer:', error);
        res.status(500).json({ success: false, error: 'Failed to save streamer' });
    }
});

app.post('/update-streamer/:index', adminAuth, async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const { name, platform, channelId, banned } = req.body;
        const data = await fs.readFile('streamers.json', 'utf8');
        const fileData = JSON.parse(data);
        
        if (index >= 0 && index < fileData.streamers.length) {
            // Preserve existing values not included in update
            const existingStreamer = fileData.streamers[index];
            fileData.streamers[index] = {
                ...existingStreamer,
                name,
                platform,
                channelId,
                banned: banned || false
            };
            
            await fs.writeFile('streamers.json', JSON.stringify(fileData, null, 2));
            res.json({ success: true, streamers: fileData.streamers });
        } else {
            res.status(404).json({ success: false, error: 'Streamer not found' });
        }
    } catch (error) {
        console.error('Failed to update streamer:', error);
        res.status(500).json({ success: false, error: 'Failed to update streamer' });
    }
});

app.delete('/delete-streamer/:index', adminAuth, async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const data = await fs.readFile('streamers.json', 'utf8');
        const fileData = JSON.parse(data);
        
        if (index < 0 || index >= fileData.streamers.length) {
            return res.status(404).json({ error: 'Streamer not found' });
        }

        fileData.streamers.splice(index, 1);
        await fs.writeFile('streamers.json', JSON.stringify(fileData, null, 2));
        res.json({ success: true, streamers: fileData.streamers });
    } catch (error) {
        console.error('Error deleting streamer:', error);
        res.status(500).json({ error: 'Failed to delete streamer' });
    }
});

app.post('/admin/streamers', async (req, res) => {
    try {
        const data = await fs.readFile(path.join(__dirname, 'streamers.json'), 'utf8');
        const jsonData = JSON.parse(data);
        const newStreamer = req.body;
        
        // Add new streamer
        jsonData.streamers.push(newStreamer);
        
        await fs.writeFile(
            path.join(__dirname, 'streamers.json'),
            JSON.stringify(jsonData, null, 4)
        );
        
        res.json({ message: 'Streamer added successfully', streamer: newStreamer });
    } catch (error) {
        console.error('Error adding streamer:', error);
        res.status(500).json({ error: 'Failed to add streamer' });
    }
});

app.delete('/admin/streamers/:channelId', async (req, res) => {
    try {
        const channelId = req.params.channelId;
        const data = await fs.readFile(path.join(__dirname, 'streamers.json'), 'utf8');
        const jsonData = JSON.parse(data);
        
        // Remove streamer
        jsonData.streamers = jsonData.streamers.filter(s => s.channelId !== channelId);
        
        await fs.writeFile(
            path.join(__dirname, 'streamers.json'),
            JSON.stringify(jsonData, null, 4)
        );
        
        res.json({ message: 'Streamer removed successfully' });
    } catch (error) {
        console.error('Error removing streamer:', error);
        res.status(500).json({ error: 'Failed to remove streamer' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log('Press Ctrl+C to quit.');
});

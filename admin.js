// Global state
let streamers = [];
let streamingLeaderboard = new Map(); // Track streaming duration for daily leaderboard
let activityLog = [];

// Constants
const PLATFORMS = {
    TWITCH: 'twitch',
    KICK: 'kick',
    YOUTUBE: 'youtube'
};

const PLATFORM_COLORS = {
    [PLATFORMS.TWITCH]: '#9146ff',
    [PLATFORMS.KICK]: '#53fc18',
    [PLATFORMS.YOUTUBE]: '#ff0000'
};

// Initialize the admin panel
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkAuthStatus();
    loadLeaderboardData();
});

function initializeEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Add/Edit streamer form
    document.getElementById('streamerDetailsForm').addEventListener('submit', handleStreamerSubmit);
    document.getElementById('addNewBtn').addEventListener('click', showStreamerForm);
    
    // Search and filter
    document.getElementById('searchStreamer').addEventListener('input', handleSearch);
    document.getElementById('filterPlatform').addEventListener('change', handlePlatformFilter);
    
    // Start periodic updates
    setInterval(updateStreamingStats, 60000); // Update every minute
    setInterval(updateLeaderboard, 300000); // Update every 5 minutes
}

// Authentication
async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('adminPassword').value;
    
    try {
        const response = await fetch('/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            credentials: 'include' // Important for cookies
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showAdminPanel();
            loadStreamers();
        } else {
            showError('Invalid password');
        }
    } catch (error) {
        showError('Login failed: ' + error.message);
    }
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/check-auth', {
            credentials: 'include' // Important for cookies
        });
        const data = await response.json();
        
        if (data.isAuthenticated) {
            showAdminPanel();
            loadStreamers();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

async function logout() {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            window.location.reload();
        }
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

// Streamer Management
async function loadStreamers() {
    try {
        const response = await fetch('/streamers', {
            credentials: 'include'
        });
        
        if (response.ok) {
            streamers = await response.json();
            updateDashboard();
            updateStreamerSections();
        } else {
            showError('Failed to load streamers');
        }
    } catch (error) {
        showError('Error loading streamers: ' + error.message);
    }
}

async function handleStreamerSubmit(e) {
    e.preventDefault();
    
    const formData = {
        name: document.getElementById('name').value,
        platform: document.getElementById('platform').value,
        channelId: document.getElementById('channelId').value,
        banned: document.getElementById('banStatus').checked
    };
    
    const editIndex = document.getElementById('editIndex').value;
    
    try {
        const endpoint = editIndex === '' ? '/add-streamer' : `/update-streamer/${editIndex}`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': localStorage.getItem('adminToken')
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save streamer');
        }
        
        const data = await response.json();
        if (data.success) {
            streamers = data.streamers;
            updateDashboard();
            hideStreamerForm();
        } else {
            showError('Failed to save streamer');
        }
    } catch (error) {
        console.error('Error saving streamer:', error);
        showError(error.message || 'Failed to save streamer');
    }
}

async function deleteStreamer(index) {
    if (!confirm('Are you sure you want to delete this streamer?')) {
        return;
    }
    
    try {
        const response = await fetch(`/delete-streamer/${index}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete streamer');
        }
        
        const data = await response.json();
        if (data.success) {
            streamers = data.streamers;
            updateDashboard();
        } else {
            showError('Failed to delete streamer');
        }
    } catch (error) {
        console.error('Error deleting streamer:', error);
        showError(error.message || 'Failed to delete streamer');
    }
}

// UI Updates
function updateDashboard() {
    updateStats();
    updateLeaderboard();
    updateActivityLog();
}

function updateStats() {
    const totalStreamers = streamers.length;
    const liveStreamers = streamers.filter(s => s.isLive).length;
    const bannedStreamers = streamers.filter(s => s.isBanned).length;

    // Platform breakdown
    const platformCounts = {
        twitch: streamers.filter(s => s.platform === 'twitch').length,
        kick: streamers.filter(s => s.platform === 'kick').length,
        youtube: streamers.filter(s => s.platform === 'youtube').length
    };

    // Update DOM
    document.getElementById('totalStreamers').textContent = totalStreamers;
    document.getElementById('liveStreamers').textContent = liveStreamers;
    document.getElementById('bannedStreamers').textContent = bannedStreamers;

    // Update platform breakdown
    const breakdownDiv = document.getElementById('platformBreakdown');
    breakdownDiv.innerHTML = `
        <div class="platform-count twitch">${platformCounts.twitch}</div>
        <div class="platform-count kick">${platformCounts.kick}</div>
        <div class="platform-count youtube">${platformCounts.youtube}</div>
    `;
}

function updateStreamerSections() {
    const sections = {
        [PLATFORMS.TWITCH]: document.querySelector('#twitchStreamers .streamers-grid'),
        [PLATFORMS.KICK]: document.querySelector('#kickStreamers .streamers-grid'),
        [PLATFORMS.YOUTUBE]: document.querySelector('#youtubeStreamers .streamers-grid')
    };
    
    // Clear existing content
    Object.values(sections).forEach(section => section.innerHTML = '');
    
    // Group streamers by platform
    streamers.forEach((streamer, index) => {
        const section = sections[streamer.platform];
        if (!section) return;
        
        section.appendChild(createStreamerCard(streamer, index));
    });
}

function createStreamerCard(streamer, index) {
    const card = document.createElement('div');
    card.className = 'streamer-card';
    card.innerHTML = `
        <div class="streamer-avatar"></div>
        <div class="streamer-info">
            <div class="streamer-name">${streamer.name}</div>
            <div class="streamer-status">
                ${streamer.banned ? 
                    '<span class="status-badge status-banned">Banned</span>' :
                    streamer.isLive ?
                        `<span class="status-badge status-live">Live · ${streamer.viewers} viewers</span>` :
                        '<span class="status-badge status-offline">Offline</span>'
                }
            </div>
        </div>
        <div class="streamer-actions">
            <button class="action-btn edit-btn" onclick="editStreamer(${index})">Edit</button>
            <button class="action-btn delete-btn" onclick="deleteStreamer(${index})">Delete</button>
        </div>
    `;
    return card;
}

// Activity Log
function logActivity(message) {
    const activity = {
        message,
        timestamp: new Date().toISOString()
    };
    
    activityLog.unshift(activity);
    if (activityLog.length > 50) activityLog.pop();
    
    updateActivityLog();
}

function updateActivityLog() {
    const logDiv = document.getElementById('activityLog');
    logDiv.innerHTML = activityLog.map(activity => `
        <div class="log-entry">
            <span class="log-time">${formatTime(activity.timestamp)}</span>
            <span class="log-message">${activity.message}</span>
        </div>
    `).join('');
}

// Utility Functions
function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString();
}

function showError(message) {
    // Implement error notification
    console.error(message);
}

// Form Helpers
function showStreamerForm() {
    // Reset form and clear any previous values
    const form = document.getElementById('streamerDetailsForm');
    form.reset();
    document.getElementById('editIndex').value = '';
    document.getElementById('streamerForm').style.display = 'block';
    updateChannelIdHelp();
}

function hideStreamerForm() {
    document.getElementById('streamerForm').style.display = 'none';
}

function editStreamer(index) {
    const streamer = streamers[index];
    if (!streamer) {
        console.error('Streamer not found:', index);
        return;
    }

    // Show form first
    document.getElementById('streamerForm').style.display = 'block';
    
    // Then set values
    setTimeout(() => {
        document.getElementById('editIndex').value = index;
        document.getElementById('name').value = streamer.name || '';
        document.getElementById('platform').value = streamer.platform || 'twitch';
        document.getElementById('channelId').value = streamer.channelId || '';
        document.getElementById('banStatus').checked = streamer.banned || false;
        updateChannelIdHelp();
    }, 0);
}

function updateChannelIdHelp() {
    const platform = document.getElementById('platform').value;
    const helpText = {
        twitch: 'Enter the Twitch username (e.g., "username" from twitch.tv/username)',
        kick: 'Enter the Kick username (e.g., "username" from kick.com/username)',
        youtube: 'Enter the YouTube channel ID (e.g., the ID from youtube.com/channel/ID)'
    };
    
    document.getElementById('platformHelp').textContent = helpText[platform] || '';
}

// Search and Filter
function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    filterStreamers(searchTerm, document.getElementById('filterPlatform').value);
}

function handlePlatformFilter(e) {
    const platform = e.target.value;
    filterStreamers(document.getElementById('searchStreamer').value.toLowerCase(), platform);
}

function filterStreamers(searchTerm, platform) {
    const filtered = streamers.filter(streamer => {
        const matchesSearch = streamer.name.toLowerCase().includes(searchTerm);
        const matchesPlatform = platform === 'all' || streamer.platform === platform;
        return matchesSearch && matchesPlatform;
    });
    
    updateStreamerSections(filtered);
}

// Initialize the admin panel
async function showAdminPanel() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    await loadStreamers();
    updateDashboard();
}

// Update streaming stats periodically
async function updateStreamingStats() {
    try {
        const response = await fetch('/streamers-status', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.streamers) {
            streamers = data.streamers;
            updateDashboard();
            
            // Update streaming duration for live streamers
            streamers.forEach(streamer => {
                if (streamer.isLive) {
                    updateStreamerStatus(streamer.channelId, true, streamer.viewerCount);
                } else {
                    updateStreamerStatus(streamer.channelId, false);
                }
            });
        }
    } catch (error) {
        console.error('Error updating streaming stats:', error);
    }
}

function updateStreamerStatus(streamerId, isLive, viewerCount = 0) {
    const streamer = streamers.find(s => s.channelId === streamerId);
    if (!streamer) return;

    const wasLive = streamer.isLive;
    streamer.isLive = isLive;
    streamer.viewerCount = viewerCount;

    // If streamer just went live, record the start time
    if (!wasLive && isLive) {
        streamingLeaderboard.set(streamerId, Date.now());
        saveLeaderboardData();
    }
    // If streamer went offline, remove from leaderboard
    else if (wasLive && !isLive) {
        streamingLeaderboard.delete(streamerId);
        saveLeaderboardData();
    }

    updateStreamerUI(streamer);
    updateStats();
    updateLeaderboard();
}

// Format duration for display
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

// Leaderboard
function updateLeaderboard() {
    const leaderboardElement = document.getElementById('streamingLeaderboard');
    leaderboardElement.innerHTML = '';

    // Get live streamers with their durations from localStorage
    const currentTime = Date.now();
    const liveStreamers = streamers
        .filter(streamer => streamer.isLive)
        .map(streamer => {
            const startTime = streamingLeaderboard.get(streamer.channelId) || currentTime;
            const duration = Math.floor((currentTime - startTime) / 1000);
            return { ...streamer, duration };
        })
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5);

    liveStreamers.forEach((streamer, index) => {
        const hours = Math.floor(streamer.duration / 3600);
        const minutes = Math.floor((streamer.duration % 3600) / 60);
        
        const leaderboardItem = document.createElement('div');
        leaderboardItem.className = 'leaderboard-item';
        leaderboardItem.innerHTML = `
            <span class="leaderboard-rank">#${index + 1}</span>
            <div class="leaderboard-info">
                <div class="streamer-name">
                    ${streamer.name}
                    <span class="platform-badge ${streamer.platform}">${streamer.platform}</span>
                </div>
                <div class="stream-duration">${hours}h ${minutes}m</div>
            </div>
        `;
        leaderboardElement.appendChild(leaderboardItem);
    });
}

// Store leaderboard data in localStorage
function saveLeaderboardData() {
    localStorage.setItem('streamingLeaderboard', JSON.stringify(Array.from(streamingLeaderboard.entries())));
}

// Load leaderboard data from localStorage
function loadLeaderboardData() {
    const savedData = localStorage.getItem('streamingLeaderboard');
    if (savedData) {
        streamingLeaderboard = new Map(JSON.parse(savedData));
    }
}

// Save leaderboard data before page unload
window.addEventListener('beforeunload', saveLeaderboardData);

function updateStreamerUI(streamer) {
    const streamerCard = document.querySelector(`.streamer-card[data-channel-id="${streamer.channelId}"]`);
    if (!streamerCard) return;

    const statusBadge = streamerCard.querySelector('.streamer-status .status-badge');
    if (streamer.banned) {
        statusBadge.classList.remove('status-live', 'status-offline');
        statusBadge.classList.add('status-banned');
        statusBadge.textContent = 'Banned';
    } else if (streamer.isLive) {
        statusBadge.classList.remove('status-banned', 'status-offline');
        statusBadge.classList.add('status-live');
        statusBadge.textContent = `Live · ${streamer.viewerCount} viewers`;
    } else {
        statusBadge.classList.remove('status-banned', 'status-live');
        statusBadge.classList.add('status-offline');
        statusBadge.textContent = 'Offline';
    }
}

// Updated on: 2024-01-21
// Constants
const CONFIG = {
    STORAGE_KEY: 'streamers',
    UPDATE_INTERVAL: 60000, // 1 minute
    TOAST_DURATION: 3000,
    MAX_RETRIES: 3
};

// Global state
let STREAMERS = [];
let currentFilter = 'all';
let isLoading = false;
let loadingOperations = 0;

// DOM Elements
const streamList = document.getElementById('streamList');
const searchInput = document.getElementById('searchInput');
const loadingOverlay = document.getElementById('loadingOverlay');
const refreshNotification = document.getElementById('refreshNotification');
const lastUpdateTime = document.getElementById('lastUpdateTime');
const backToTop = document.getElementById('backToTop');
const errorMessage = document.getElementById('errorMessage');
const streamFilters = document.getElementById('streamFilters');
const toastContainer = document.getElementById('toastContainer');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    try {
        showLoading(true);
        setupEventListeners();
        await loadStreamers();
        
        if (!Array.isArray(STREAMERS)) {
            throw new Error('STREAMERS is not an array after loading');
        }

        if (STREAMERS.length === 0) {
            throw new Error('No streamers loaded');
        }

        await updateViewerCounts();
        updateBannedStreamers();
        showLoading(false);
        
        // Start update interval
        setInterval(async () => {
            if (Array.isArray(STREAMERS) && STREAMERS.length > 0) {
                showLoading(true);
                await updateViewerCounts();
                updateBannedStreamers();
                showLoading(false);
            }
        }, CONFIG.UPDATE_INTERVAL);

    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize. Please refresh the page.');
        showLoading(false);
    }
});

// Event Listeners
function setupEventListeners() {
    // Search functionality
    searchInput.addEventListener('input', debounce(handleSearch, 300));

    // Platform filters
    streamFilters.addEventListener('click', (e) => {
        const filterBtn = e.target.closest('.filter-btn');
        if (filterBtn) {
            const platform = filterBtn.dataset.filter;
            setActiveFilter(platform);
            updateStreamList();
        }
    });

    // Back to top button
    window.addEventListener('scroll', () => {
        backToTop.classList.toggle('visible', window.scrollY > 500);
    });

    backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Listen for changes from admin panel
    window.addEventListener('storage', (e) => {
        if (e.key === CONFIG.STORAGE_KEY && e.newValue) {
            try {
                const newStreamers = JSON.parse(e.newValue);
                if (Array.isArray(newStreamers)) {
                    STREAMERS = newStreamers;
                    updateViewerCounts();
                    updateStreamList();
                    updateBannedStreamers();
                    showToast('Streamer list updated from admin panel');
                }
            } catch (error) {
                console.error('Error processing admin panel update:', error);
                showError('Failed to process admin panel update');
            }
        }
    });
}

// Load streamers from localStorage or default
async function loadStreamers() {
    try {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    STREAMERS = parsed;
                    return;
                }
            } catch (e) {
                console.error('Error parsing stored streamers:', e);
                localStorage.removeItem(CONFIG.STORAGE_KEY);
            }
        }

        // If we get here, either there was no stored data or it was invalid
        console.log('Loading streamers from streamers.json...');
        const response = await fetch('streamers.json');
        if (!response.ok) {
            throw new Error(`Failed to load streamers.json: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        try {
            const data = JSON.parse(text);
            // Check if data has the streamers array property
            if (data && Array.isArray(data.streamers)) {
                STREAMERS = data.streamers;
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
            } else {
                throw new Error('streamers.json does not contain a valid streamers array');
            }
        } catch (e) {
            console.error('Error parsing streamers.json:', e);
            console.log('Content of streamers.json:', text);
            throw e;
        }
    } catch (error) {
        console.error('Error loading streamers:', error);
        STREAMERS = [];
        showError('Failed to load streamers. Please refresh the page.');
    }
}

// Update viewer counts
async function updateViewerCounts() {
    if (isLoading || !Array.isArray(STREAMERS)) return;
    
    isLoading = true;
    showLoading(true);
    
    try {
        for (const streamer of STREAMERS) {
            await updateStreamerStatus(streamer);
        }
        
        // Sort streamers: Live first (by viewers), then offline (by last online)
        STREAMERS.sort((a, b) => {
            if (a.isLive && !b.isLive) return -1;
            if (!a.isLive && b.isLive) return 1;
            if (a.isLive && b.isLive) return b.viewers - a.viewers;
            return (b.lastOnline || 0) - (a.lastOnline || 0);
        });

        // Save updated streamers
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
        
        // Update UI
        updateStreamList();
        updateLastUpdateTime();
        showToast('Streams updated successfully');
    } catch (error) {
        console.error('Error updating streams:', error);
        showError('Failed to update streams. Retrying...');
    } finally {
        isLoading = false;
        showLoading(false);
    }
}

// Update individual streamer status
async function updateStreamerStatus(streamer) {
    try {
        if (streamer.platform === 'kick') {
            const response = await fetch(`https://kick.com/api/v2/channels/${streamer.channelId}`, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (response.ok) {
                const data = await response.json();
                // Check ONLY livestream object for Kick streams
                streamer.isLive = data.livestream !== null;
                streamer.viewers = data.livestream ? data.livestream.viewer_count : 0;
                streamer.title = data.livestream ? data.livestream.session_title : (data.previous_live_stream ? data.previous_live_stream.session_title : 'Offline');
                
                // Update thumbnail directly from API if not banned
                if (!streamer.banned && data.user && data.user.profile_pic) {
                    streamer.thumbnail = data.user.profile_pic;
                }
                
                if (streamer.isLive) streamer.lastOnline = Date.now();
            }
        } else {
            const platform = streamer.platform;
            const response = await fetch(`/streamers-status?platform=${platform}&channelId=${streamer.channelId}`);
            if (response.ok) {
                const data = await response.json();
                const streamerData = data.streamers.find(s => s.channelId === streamer.channelId);
                if (streamerData) {
                    streamer.isLive = streamerData.isLive;
                    streamer.title = streamerData.title;
                    streamer.viewers = streamerData.viewers;
                    
                    // Update thumbnail directly if not banned
                    if (!streamer.banned && streamerData.thumbnail) {
                        streamer.thumbnail = streamerData.thumbnail;
                    }
                    
                    if (streamerData.isLive) streamer.lastOnline = Date.now();
                }
            }
        }
    } catch (error) {
        console.error('Error updating streamer status:', error);
    }
}

// UI Updates
function updateStreamList() {
    const searchTerm = searchInput.value.toLowerCase();
    const filteredStreamers = STREAMERS.filter(streamer => {
        const matchesSearch = streamer.name.toLowerCase().includes(searchTerm) ||
                            streamer.title.toLowerCase().includes(searchTerm);
        const matchesFilter = currentFilter === 'all' || streamer.platform === currentFilter;
        return matchesSearch && matchesFilter;
    });

    // Split into live and offline streamers
    const liveStreamers = filteredStreamers.filter(s => s.isLive && !s.banned);
    const offlineStreamers = filteredStreamers.filter(s => !s.isLive && !s.banned);
    const bannedStreamers = filteredStreamers.filter(s => s.banned);

    streamList.innerHTML = '';
    
    if (filteredStreamers.length === 0) {
        streamList.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p>No streams found</p>
            </div>
        `;
        return;
    }

    // Add LIVE section
    if (liveStreamers.length > 0) {
        const liveSection = document.createElement('div');
        liveSection.className = 'stream-section';
        liveSection.innerHTML = `
            <div class="section-header">
                <span class="section-title">LIVE</span>
                <span class="stream-count">${liveStreamers.length} online</span>
            </div>
        `;
        
        liveStreamers.forEach((streamer, index) => {
            liveSection.appendChild(createStreamCard(streamer, index));
        });
        
        streamList.appendChild(liveSection);
    }

    // Add OFFLINE section
    if (offlineStreamers.length > 0) {
        const offlineSection = document.createElement('div');
        offlineSection.className = 'stream-section offline-section';
        offlineSection.innerHTML = `
            <div class="section-header">
                <span class="section-title">OFFLINE</span>
                <span class="stream-count">${offlineStreamers.length} offline</span>
            </div>
        `;

        // Initially show only first 3 offline streamers
        const initialOfflineCount = 3;
        const visibleOfflineStreamers = offlineStreamers.slice(0, initialOfflineCount);
        const remainingOfflineStreamers = offlineStreamers.slice(initialOfflineCount);

        visibleOfflineStreamers.forEach(streamer => {
            offlineSection.appendChild(createStreamCard(streamer));
        });

        // Add "Show More" button if there are more offline streamers
        if (remainingOfflineStreamers.length > 0) {
            const showMoreBtn = document.createElement('button');
            showMoreBtn.className = 'show-more-btn';
            showMoreBtn.innerHTML = `
                <i class="fas fa-chevron-down"></i>
                Show ${remainingOfflineStreamers.length} more offline streamers
            `;
            
            showMoreBtn.addEventListener('click', () => {
                // Remove the button
                showMoreBtn.remove();
                
                // Add remaining streamers
                remainingOfflineStreamers.forEach(streamer => {
                    offlineSection.appendChild(createStreamCard(streamer));
                });
            });
            
            offlineSection.appendChild(showMoreBtn);
        }

        streamList.appendChild(offlineSection);
    }

    // Add BANNED section if there are banned streamers
    if (bannedStreamers.length > 0) {
        const bannedSection = document.createElement('div');
        bannedSection.className = 'stream-section banned-section';
        bannedSection.innerHTML = `
            <div class="section-header">
                <span class="section-title">BANNED</span>
                <span class="stream-count">${bannedStreamers.length} banned</span>
            </div>
        `;
        
        bannedStreamers.forEach(streamer => {
            bannedSection.appendChild(createStreamCard(streamer));
        });
        
        streamList.appendChild(bannedSection);
    }
}

function createStreamCard(streamer, index) {
    const card = document.createElement('div');
    card.className = `stream-item ${!streamer.isLive ? 'offline' : ''} ${streamer.banned ? 'banned' : ''}`;
    
    const platformIcon = streamer.platform === 'twitch' ? 'fab fa-twitch' :
                        streamer.platform === 'kick' ? 'fas fa-gamepad' :
                        'fab fa-youtube';
    
    // Use profile from images/profiles for banned streamers
    const profilePath = streamer.banned ? 
        `images/profiles/${streamer.platform}-${streamer.channelId}.webp` : 
        (streamer.thumbnail || 'default-avatar.png');
    
    card.innerHTML = `
        <a href="${getStreamUrl(streamer)}" class="stream-link" target="_blank">
            <div class="platform-indicator">
                <i class="${platformIcon} platform-${streamer.platform}"></i>
            </div>
            <div class="thumbnail-container">
                <img src="${profilePath}" alt="${streamer.name}" class="profile-pic" onerror="this.src='default-avatar.png'">
            </div>
            <div class="stream-info">
                <div class="streamer-name">
                    ${streamer.isLive && !streamer.banned ? '<span class="live-indicator"></span>' : ''}
                    ${streamer.name}
                    ${streamer.banned ? '<span class="banned-indicator">BANNED</span>' : ''}
                </div>
                <div class="stream-title">${streamer.banned ? 'BANNED' : (streamer.title || 'Offline')}</div>
                ${getViewerCountHtml(streamer)}
            </div>
        </a>
    `;

    return card;
}

// Helper Functions
function getStreamUrl(streamer) {
    if (streamer.platform === 'youtube') {
        return `https://youtube.com/channel/${streamer.channelId}${streamer.isLive ? '/live' : ''}`;
    }
    return `https://${streamer.platform}${streamer.platform === 'kick' ? '.com' : '.tv'}/${streamer.channelId}`;
}

function getViewerCountHtml(streamer) {
    if (streamer.banned) {
        return `
            <div class="offline-status">
                <i class="fas fa-ban"></i>
                <span>Account Banned</span>
            </div>
        `;
    }
    
    if (streamer.isLive) {
        return `
            <div class="viewer-count">
                <i class="fas fa-user-friends"></i>
                <span class="viewer-number">${formatViewerCount(streamer.viewers)}</span>
                <span class="viewers-text">watching</span>
            </div>
        `;
    }
    
    return `
        <div class="offline-status">
            <i class="fas fa-clock"></i>
            <span>${streamer.lastOnline ? `Last live: ${getTimeAgo(new Date(streamer.lastOnline))}` : 'Offline'}</span>
        </div>
    `;
}

function formatViewerCount(count) {
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    }
    if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
        }
    }
    
    return 'Just now';
}

function setActiveFilter(platform) {
    currentFilter = platform;
    const buttons = streamFilters.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === platform);
    });
}

function updateLastUpdateTime() {
    lastUpdateTime.textContent = 'just now';
}

// UI Feedback
function showLoading(show) {
    if (show) {
        loadingOperations++;
    } else {
        loadingOperations = Math.max(0, loadingOperations - 1);
    }
    loadingOverlay.classList.toggle('visible', loadingOperations > 0);
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('visible');
    setTimeout(() => {
        errorMessage.classList.remove('visible');
    }, 5000);
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, CONFIG.TOAST_DURATION);
}

// Utility Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleSearch() {
    updateStreamList();
}

// Update banned streamers panel
function updateBannedStreamers() {
    const bannedList = document.getElementById('bannedStreamersList');
    const bannedStreamers = STREAMERS.filter(s => s.banned);
    
    bannedList.innerHTML = '';
    
    if (bannedStreamers.length === 0) {
        bannedList.innerHTML = `
            <div class="banned-streamer">
                <div class="banned-info">
                    <div class="banned-name">No banned streamers</div>
                </div>
            </div>
        `;
        return;
    }
    
    bannedStreamers.forEach(streamer => {
        const profilePath = `images/profiles/${streamer.platform}-${streamer.channelId}.webp`;
        const element = document.createElement('div');
        element.className = 'banned-streamer';
        element.innerHTML = `
            <div class="banned-avatar">
                <img src="${profilePath}" alt="${streamer.name}" onerror="this.src='default-avatar.png'">
            </div>
            <div class="banned-info">
                <div class="banned-name">
                    ${streamer.name}
                    <span class="banned-tag">BANNED</span>
                </div>
                <div class="violation-text">TOS VIOLATION</div>
            </div>
        `;
        bannedList.appendChild(element);
    });
}

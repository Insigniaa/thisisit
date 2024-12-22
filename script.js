// Constants
const CONFIG = {
    STORAGE_KEY: 'streamers',
    UPDATE_INTERVAL: 60000, // 1 minute
    TOAST_DURATION: 3000,
    MAX_RETRIES: 3,
    UPDATE_CHECK_INTERVAL: 1000, // Check every second for time updates
    JUST_LIVE_DURATION: 300000, // 5 minutes in milliseconds
    LAZY_LOAD_OFFSET: 100, // pixels before element comes into view
    PULL_REFRESH_THRESHOLD: 60, // pixels to pull before refresh triggers
};

// Global state
let STREAMERS = [];
let currentFilter = 'all';
let isLoading = false;
let updateTimeInterval = null;
let lastKnownStates = new Map(); // Store previous streamer states
let touchStartY = 0;
let pullDistance = 0;
let isPulling = false;

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
        await loadStreamers();
        
        if (!Array.isArray(STREAMERS)) {
            throw new Error('STREAMERS is not an array after loading');
        }

        if (STREAMERS.length === 0) {
            throw new Error('No streamers loaded');
        }

        setupEventListeners();
        await updateViewerCounts();
        updateBannedStreamers();
        updateLastUpdateTime();
        
        // Start update interval
        setInterval(async () => {
            if (Array.isArray(STREAMERS) && STREAMERS.length > 0) {
                await updateViewerCounts();
                updateBannedStreamers();
            }
        }, CONFIG.UPDATE_INTERVAL);

    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize. Please refresh the page.');
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

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
}

// Load streamers from localStorage or default
async function loadStreamers(retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    try {
        // First try to load from localStorage
        const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    console.log('Successfully loaded streamers from localStorage');
                    STREAMERS = parsed;
                    return;
                }
            } catch (e) {
                console.error('Error parsing stored streamers:', e);
                localStorage.removeItem(CONFIG.STORAGE_KEY);
            }
        }

        // If localStorage failed, try loading from streamers.json
        console.log(`Loading streamers from streamers.json (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const response = await fetch('streamers.json', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load streamers.json: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data || !Array.isArray(data.streamers)) {
            throw new Error('Invalid streamers.json format: missing streamers array');
        }

        if (data.streamers.length === 0) {
            throw new Error('No streamers found in streamers.json');
        }

        console.log(`Successfully loaded ${data.streamers.length} streamers from streamers.json`);
        STREAMERS = data.streamers;
        
        // Save to localStorage for future use
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
            console.log('Successfully saved streamers to localStorage');
        } catch (storageError) {
            console.error('Failed to save streamers to localStorage:', storageError);
        }

    } catch (error) {
        console.error('Error loading streamers:', error);
        
        // Retry logic
        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying in ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return loadStreamers(retryCount + 1);
        }
        
        // If all retries failed, use fallback data
        console.log('All retry attempts failed, using fallback data');
        STREAMERS = [
            {
                "name": "Example Streamer",
                "platform": "kick",
                "channelId": "example",
                "isLive": false,
                "viewers": 0,
                "title": "Loading...",
                "banned": false
            }
        ];
        
        showError('Failed to load streamers. Using fallback data. Please refresh the page in a few minutes.');
    }

    // Final validation
    if (!Array.isArray(STREAMERS) || STREAMERS.length === 0) {
        throw new Error('Failed to initialize streamers list');
    }
}

// Update viewer counts
async function updateViewerCounts() {
    if (isLoading || !Array.isArray(STREAMERS)) {
        console.log('Skipping update: ' + (isLoading ? 'Already loading' : 'Invalid STREAMERS array'));
        return;
    }
    
    isLoading = true;
    const refreshNotification = document.getElementById('refreshNotification');
    if (refreshNotification) {
        refreshNotification.classList.add('updating');
    }
    createLoadingSkeletons();
    
    try {
        const updatePromises = STREAMERS.map(streamer => 
            updateStreamerStatus(streamer).catch(error => {
                console.error(`Error updating ${streamer.name}:`, error);
                return {
                    ...streamer,
                    isLive: false,
                    viewers: 0,
                    title: 'Error loading stream',
                    error: true
                };
            })
        );
        
        await Promise.all(updatePromises);
        
        // Sort streamers: Live first (by viewers), then offline (by last online)
        STREAMERS.sort((a, b) => {
            if (a.isLive && !b.isLive) return -1;
            if (!a.isLive && b.isLive) return 1;
            if (a.isLive && b.isLive) return (b.viewers || 0) - (a.viewers || 0);
            return ((b.lastOnline || 0) - (a.lastOnline || 0));
        });

        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
        } catch (storageError) {
            console.error('Error saving to localStorage:', storageError);
        }
        
        updateStreamList();
        showToast('Streams updated successfully');
    } catch (error) {
        console.error('Error updating streams:', error);
        showError('Failed to update streams. Will retry in next interval.');
    } finally {
        isLoading = false;
        if (refreshNotification) {
            refreshNotification.classList.remove('updating');
        }
        updateLastUpdateTime();
    }
}

// Update individual streamer status
async function updateStreamerStatus(streamer) {
    if (!streamer || typeof streamer !== 'object') {
        throw new Error('Invalid streamer object');
    }

    try {
        // Store previous viewer count
        streamer.previousViewers = streamer.viewers || 0;
        
        if (streamer.platform === 'kick') {
            try {
                const response = await fetch(`https://kick.com/api/v2/channels/${streamer.channelId}`);
                if (!response.ok) {
                    throw new Error(`Kick API request failed: ${response.status}`);
                }
                
                const data = await response.json();
                
                // Update streamer data safely
                streamer.isLive = Boolean(data.livestream);
                streamer.viewers = data.livestream ? parseInt(data.livestream.viewer_count) || 0 : 0;
                streamer.title = data.livestream ? 
                    data.livestream.session_title : 
                    (data.previous_live_stream ? data.previous_live_stream.session_title : 'Offline');
                
                if (!streamer.banned && data.user && data.user.profile_pic) {
                    streamer.thumbnail = data.user.profile_pic;
                }
                
                if (streamer.isLive) {
                    streamer.lastOnline = Date.now();
                }
            } catch (error) {
                console.error(`Error fetching Kick data for ${streamer.name}:`, error);
                streamer.isLive = false;
                streamer.viewers = 0;
                streamer.title = 'Error loading stream';
            }
        } else {
            try {
                const response = await fetch(`/streamers-status?platform=${streamer.platform}&channelId=${streamer.channelId}`);
                if (!response.ok) {
                    throw new Error(`Streamers status request failed: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data && data.streamers && Array.isArray(data.streamers)) {
                    const streamerData = data.streamers.find(s => s.channelId === streamer.channelId);
                    if (streamerData) {
                        streamer.isLive = Boolean(streamerData.isLive);
                        streamer.title = streamerData.title || 'Offline';
                        streamer.viewers = parseInt(streamerData.viewers) || 0;
                        
                        if (!streamer.banned && streamerData.thumbnail) {
                            streamer.thumbnail = streamerData.thumbnail;
                        }
                        
                        if (streamer.isLive) {
                            streamer.lastOnline = Date.now();
                        }
                    } else {
                        throw new Error('Streamer data not found in response');
                    }
                } else {
                    throw new Error('Invalid API response format');
                }
            } catch (error) {
                console.error(`Error fetching status for ${streamer.name}:`, error);
                streamer.isLive = false;
                streamer.viewers = 0;
                streamer.title = 'Error loading stream';
            }
        }
    } catch (error) {
        console.error(`Error updating ${streamer.name}:`, error);
        streamer.isLive = false;
        streamer.viewers = 0;
        streamer.title = 'Error';
    }

    return streamer;
}

// UI Updates
function updateStreamList() {
    if (!Array.isArray(STREAMERS)) {
        console.error('STREAMERS is not an array:', STREAMERS);
        return;
    }
    
    const searchTerm = searchInput?.value?.toLowerCase() || '';
    const filteredStreamers = STREAMERS.filter(streamer => {
        if (!streamer || typeof streamer !== 'object') return false;
        
        const matchesSearch = (streamer.name?.toLowerCase() || '').includes(searchTerm) ||
                            (streamer.title?.toLowerCase() || '').includes(searchTerm);
        const matchesFilter = currentFilter === 'all' || streamer.platform === currentFilter;
        return matchesSearch && matchesFilter;
    });

    // Split into live and offline streamers
    const liveStreamers = filteredStreamers.filter(s => s.isLive && !s.banned);
    const offlineStreamers = filteredStreamers.filter(s => !s.isLive && !s.banned);
    const bannedStreamers = filteredStreamers.filter(s => s.banned);

    const streamList = document.getElementById('streamList');
    if (!streamList) {
        console.error('Stream list element not found');
        return;
    }

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
                <span class="section-title live">
                    LIVE
                </span>
                <span class="stream-count">
                    <i class="fas fa-circle-dot"></i>
                    ${liveStreamers.length} online
                </span>
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
                <span class="section-title">
                    OFFLINE
                </span>
                <span class="stream-count">
                    <i class="fas fa-circle-minus"></i>
                    ${offlineStreamers.length} offline
                </span>
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
            const showMoreBtn = createShowMoreButton(remainingOfflineStreamers.length);
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
                <span class="section-title">
                    BANNED
                </span>
                <span class="stream-count">
                    <i class="fas fa-ban"></i>
                    ${bannedStreamers.length} banned
                </span>
            </div>
        `;
        
        bannedStreamers.forEach(streamer => {
            bannedSection.appendChild(createStreamCard(streamer));
        });
        
        streamList.appendChild(bannedSection);
    }

    // Setup lazy loading after updating the DOM
    setupLazyLoading();
}

function createStreamCard(streamer) {
    const wasLive = lastKnownStates.get(streamer.channelId)?.isLive;
    const justWentLive = !wasLive && streamer.isLive;
    const statusChanged = wasLive !== streamer.isLive;
    
    const card = document.createElement('div');
    card.className = `stream-item ${!streamer.isLive ? 'offline' : ''} ${streamer.banned ? 'banned' : ''} platform-${streamer.platform}`;
    if (statusChanged) {
        card.classList.add('status-changing');
    }
    
    // Update last known state
    lastKnownStates.set(streamer.channelId, {
        isLive: streamer.isLive,
        timestamp: Date.now()
    });

    const profilePath = streamer.banned ? 
        `images/profiles/${streamer.platform}-${streamer.channelId}.webp` : 
        (streamer.thumbnail || 'default-avatar.png');

    const contentWrapper = streamer.banned ? 
        document.createElement('div') : 
        document.createElement('a');

    if (!streamer.banned) {
        contentWrapper.href = getStreamUrl(streamer);
        contentWrapper.target = "_blank";
    }
    
    contentWrapper.className = 'stream-link';
    
    // Add Just Live badge if streamer just went live
    const justLiveBadge = justWentLive ? `
        <div class="just-live-badge">
            <i class="fas fa-circle"></i>
            Just Live!
        </div>
    ` : '';

    contentWrapper.innerHTML = `
        <div class="thumbnail-wrapper">
            ${justLiveBadge}
            <div class="platform-logo-container ${streamer.platform}">
                <img src="images/${streamer.platform === 'twitch' ? 'twitch-logo.png' : streamer.platform === 'youtube' ? 'youtube-logo-new.svg' : streamer.platform + '-logo.png'}" alt="${streamer.platform}" class="platform-logo">
            </div>
            <div class="thumbnail-container">
                <div class="image-placeholder"></div>
                <img data-src="${profilePath}" alt="${streamer.name}" class="profile-pic lazy-image" onerror="this.src='default-avatar.png'">
                ${streamer.banned ? '<div class="banned-overlay"><i class="fas fa-ban"></i></div>' : ''}
            </div>
        </div>
        <div class="stream-info">
            <div class="streamer-name">
                <div class="name-container">
                    ${streamer.name}
                    ${streamer.isLive && !streamer.banned ? '<div class="live-indicator"></div>' : ''}
                </div>
                ${streamer.banned ? '<span class="banned-tag">BANNED</span>' : ''}
            </div>
            <div class="stream-title">${streamer.banned ? 'BANNED - Channel Unavailable' : (streamer.title || 'Offline')}</div>
            ${getViewerCountHtml(streamer)}
        </div>
    `;

    card.appendChild(contentWrapper);
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
        let viewerTrend = '';
        if (streamer.previousViewers) {
            const viewerDiff = streamer.viewers - streamer.previousViewers;
            const diffAbs = Math.abs(viewerDiff);
            const diffFormatted = formatViewerCount(diffAbs);
            
            if (viewerDiff > 0) {
                viewerTrend = `
                    <div class="viewer-trend positive">
                        <i class="fas fa-caret-up"></i>
                        <span>+${diffFormatted}</span>
                    </div>`;
            } else if (viewerDiff < 0) {
                viewerTrend = `
                    <div class="viewer-trend negative">
                        <i class="fas fa-caret-down"></i>
                        <span>-${diffFormatted}</span>
                    </div>`;
            }
        }

        // Check if this streamer has the highest viewer count
        const isTopViewer = STREAMERS.every(s => 
            !s.isLive || s.banned || streamer.viewers >= s.viewers
        );
            
        return `
            <div class="viewer-count ${isTopViewer ? 'top-viewers' : ''}">
                ${isTopViewer ? '<span class="crown-emoji">👑</span>' : ''}
                <i class="fas fa-user-friends"></i>
                <span class="viewer-number">${formatViewerCount(streamer.viewers)}</span>
                <span class="viewers-text">viewers</span>
                ${viewerTrend}
                ${isTopViewer ? '<span class="fire-emoji">🔥</span>' : ''}
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
        const k = (count / 1000).toFixed(1);
        // Remove trailing .0 if present
        return k.endsWith('.0') ? k.slice(0, -2) + 'K' : k + 'K';
    }
    return count.toLocaleString();
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
    // Clear any existing interval
    if (updateTimeInterval) {
        clearInterval(updateTimeInterval);
        updateTimeInterval = null;
    }

    const refreshNotification = document.getElementById('refreshNotification');
    
    // Update the DOM structure for better styling
    refreshNotification.innerHTML = `
        <i class="fas fa-sync-alt"></i>
        <span class="update-label">Next update in:</span>
        <span class="time-display">
            <span id="lastUpdateTime">60s</span>
            <span class="countdown-bar"></span>
        </span>
    `;

    let lastUpdate = Date.now();
    let countdown = 60; // 60 seconds countdown

    // Update the countdown every second
    updateTimeInterval = setInterval(() => {
        countdown = 60 - Math.floor((Date.now() - lastUpdate) / 1000);
        
        if (countdown <= 0) {
            lastUpdate = Date.now();
            countdown = 60;
            refreshNotification.classList.add('pulse');
            setTimeout(() => refreshNotification.classList.remove('pulse'), 500);
        }

        const timeDisplay = document.getElementById('lastUpdateTime');
        if (timeDisplay) {
            timeDisplay.textContent = `${countdown}s`;
            
            // Update progress bar
            const progress = (countdown / 60) * 100;
            const countdownBar = refreshNotification.querySelector('.countdown-bar');
            if (countdownBar) {
                countdownBar.style.setProperty('--progress', `${progress}%`);
            }
        }
    }, 1000);

    // Clean up interval on page unload
    window.addEventListener('unload', () => {
        if (updateTimeInterval) {
            clearInterval(updateTimeInterval);
            updateTimeInterval = null;
        }
    });
}

// UI Feedback
function showLoading(show) {
    loadingOverlay.classList.toggle('visible', show);
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

function createLoadingSkeletons(count = 8) {
    const streamList = document.getElementById('streamList');
    streamList.innerHTML = '';
    
    // Create Live Section
    const liveSection = document.createElement('div');
    liveSection.className = 'stream-section';
    
    // Add loading section header
    const liveSectionHeader = document.createElement('div');
    liveSectionHeader.className = 'section-header loading';
    liveSectionHeader.innerHTML = `
        <div class="title-skeleton skeleton"></div>
        <div class="count-skeleton skeleton"></div>
    `;
    liveSection.appendChild(liveSectionHeader);
    
    // Add loading stream items
    for (let i = 0; i < Math.ceil(count * 0.6); i++) {
        liveSection.appendChild(createLoadingCard());
    }
    
    // Create Offline Section
    const offlineSection = document.createElement('div');
    offlineSection.className = 'stream-section offline-section';
    
    // Add loading section header
    const offlineSectionHeader = document.createElement('div');
    offlineSectionHeader.className = 'section-header loading';
    offlineSectionHeader.innerHTML = `
        <div class="title-skeleton skeleton"></div>
        <div class="count-skeleton skeleton"></div>
    `;
    offlineSection.appendChild(offlineSectionHeader);
    
    // Add loading stream items
    for (let i = 0; i < Math.floor(count * 0.4); i++) {
        offlineSection.appendChild(createLoadingCard());
    }
    
    // Append sections to stream list
    streamList.appendChild(liveSection);
    streamList.appendChild(offlineSection);
}

function createLoadingCard() {
    const card = document.createElement('div');
    card.className = 'stream-item loading';
    
    card.innerHTML = `
        <div class="thumbnail-container skeleton"></div>
        <div class="stream-info-skeleton">
            <div class="name-skeleton skeleton"></div>
            <div class="title-skeleton skeleton"></div>
            <div class="title-skeleton-line skeleton"></div>
            <div class="viewers-skeleton skeleton"></div>
        </div>
    `;
    
    return card;
}

// Modify your existing fetchStreams function
async function fetchStreams() {
    try {
        createLoadingSkeletons(); // Show loading state
        
        const response = await fetch('/api/streams');
        if (!response.ok) {
            throw new Error('Failed to fetch streams');
        }
        
        const streams = await response.json();
        displayStreams(streams);
        updateLastRefreshTime();
    } catch (error) {
        console.error('Error fetching streams:', error);
        showError('Failed to load streams. Please try again later.');
    }
}

function createShowMoreButton(count) {
    const button = document.createElement('button');
    button.className = 'show-more-btn';
    button.innerHTML = `
        <span>Show ${count} more offline streamers</span>
        <i class="fas fa-chevron-down"></i>
    `;
    return button;
}

// Add new functions for lazy loading
function setupLazyLoading() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.classList.add('loading');
                    img.onload = () => {
                        img.classList.remove('loading');
                        img.classList.add('loaded');
                        observer.unobserve(img);
                    };
                }
            }
        });
    }, {
        rootMargin: `${CONFIG.LAZY_LOAD_OFFSET}px`
    });

    document.querySelectorAll('.profile-pic[data-src]').forEach(img => {
        observer.observe(img);
    });
}

// Add mobile touch handling functions
function handleTouchStart(e) {
    if (window.scrollY === 0) {
        touchStartY = e.touches[0].clientY;
        isPulling = true;
    }
}

function handleTouchMove(e) {
    if (!isPulling) return;
    
    const touch = e.touches[0];
    pullDistance = touch.clientY - touchStartY;
    
    if (pullDistance > 0) {
        const pullToRefresh = document.querySelector('.pull-to-refresh');
        pullToRefresh.classList.add('visible');
        
        if (pullDistance >= CONFIG.PULL_REFRESH_THRESHOLD) {
            pullToRefresh.classList.add('pulling');
        } else {
            pullToRefresh.classList.remove('pulling');
        }
        
        pullToRefresh.style.transform = `translateY(${Math.min(pullDistance, CONFIG.PULL_REFRESH_THRESHOLD)}px)`;
    }
}

function handleTouchEnd() {
    if (!isPulling) return;
    
    const pullToRefresh = document.querySelector('.pull-to-refresh');
    
    if (pullDistance >= CONFIG.PULL_REFRESH_THRESHOLD) {
        pullToRefresh.classList.add('refreshing');
        updateViewerCounts();
    }
    
    pullToRefresh.style.transform = '';
    pullToRefresh.classList.remove('visible', 'pulling');
    
    isPulling = false;
    pullDistance = 0;
}

// Add cache handling
const streamCache = new Map();
const CACHE_DURATION = 60000; // 1 minute

async function getCachedData(url) {
    const cached = streamCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    streamCache.set(url, {
        data,
        timestamp: Date.now()
    });
    return data;
}

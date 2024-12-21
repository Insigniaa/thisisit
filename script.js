// Configuration
const CONFIG = {
    UPDATE_INTERVAL: 60000, // 60 seconds
    STORAGE_KEY: 'streamers',
    STREAMERS_FILE: 'streamers.json'
};

// Add base URL configuration
const API_BASE_URL = 'http://localhost:3000';

// State management
const state = {
    hideInactiveStreamers: false,
    lastUpdateTime: Date.now(),
    jsonData: {
        online: [],
        offline: []
    }
};

// Load streamers from file
let STREAMERS = [];

async function loadStreamersFromFile() {
    try {
        const response = await fetch(CONFIG.STREAMERS_FILE);
        const data = await response.json();
        STREAMERS = data.streamers;
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
    } catch (error) {
        console.error('Error loading streamers from file:', error);
        // If file load fails, try localStorage as fallback
        STREAMERS = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || [];
    }
}

// Add storage event listener to update when changes are made from admin panel
window.addEventListener('storage', (e) => {
    if (e.key === CONFIG.STORAGE_KEY) {
        STREAMERS = JSON.parse(e.newValue);
        updateStreamData();
        createStreamList();
        // Save changes to file
        saveStreamersToFile();
    }
});

// Add custom event listener for same-tab updates
window.addEventListener('streamersUpdated', () => {
    STREAMERS = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
    updateStreamData();
    createStreamList();
    // Save changes to file
    saveStreamersToFile();
});

async function saveStreamersToFile() {
    try {
        const response = await fetch('/save-streamers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ streamers: STREAMERS })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save streamers');
        }
    } catch (error) {
        console.error('Error saving streamers to file:', error);
    }
}

async function saveProfilePicture(url, channelId, platform) {
    try {
        const response = await fetch(`/proxy-image?url=${encodeURIComponent(url)}&channelId=${encodeURIComponent(channelId)}&platform=${encodeURIComponent(platform)}`);
        if (!response.ok) {
            throw new Error(`Failed to save profile picture: ${response.status}`);
        }
        const data = await response.json();
        return data.localPath;
    } catch (error) {
        console.error('Error saving profile picture:', error);
        return '/default-avatar.png';
    }
}

async function updateViewerCounts() {
    for (const streamer of STREAMERS) {
        try {
            if (streamer.platform === 'kick') {
                const response = await fetch(`https://kick.com/api/v2/channels/${streamer.channelId}`);
                if (response.ok) {
                    const data = await response.json();
                    streamer.isLive = data.livestream !== null;
                    streamer.viewers = data.livestream ? data.livestream.viewer_count : 0;
                    streamer.title = data.livestream ? data.livestream.session_title : 'Offline';
                    
                    // Save profile picture if it's new or different
                    if (data.user.profile_pic && (!streamer.thumbnail || streamer.thumbnail !== data.user.profile_pic)) {
                        const localPath = await saveProfilePicture(data.user.profile_pic, streamer.channelId, 'kick');
                        if (localPath) {
                            streamer.thumbnail = localPath;
                        }
                    }
                    
                    if (data.livestream) {
                        streamer.lastOnline = Date.now();
                    }
                }
            } else if (streamer.platform === 'twitch') {
                const response = await fetch(`/streamers-status?platform=twitch&channelId=${streamer.channelId}`);
                if (response.ok) {
                    const data = await response.json();
                    const streamerData = data.streamers.find(s => s.channelId === streamer.channelId);
                    if (streamerData) {
                        streamer.isLive = streamerData.isLive;
                        streamer.title = streamerData.title;
                        streamer.viewers = streamerData.viewers;
                        
                        // Save profile picture if it's new or different
                        if (streamerData.thumbnail && (!streamer.thumbnail || streamer.thumbnail !== streamerData.thumbnail)) {
                            const localPath = await saveProfilePicture(streamerData.thumbnail, streamer.channelId, 'twitch');
                            if (localPath) {
                                streamer.thumbnail = localPath;
                            }
                        }
                        
                        if (streamerData.isLive) {
                            streamer.lastOnline = Date.now();
                        }
                    }
                }
            } else if (streamer.platform === 'youtube') {
                const response = await fetch(`/streamers-status?platform=youtube&channelId=${streamer.channelId}`);
                if (response.ok) {
                    const data = await response.json();
                    const streamerData = data.streamers.find(s => s.channelId === streamer.channelId);
                    if (streamerData) {
                        streamer.isLive = streamerData.isLive;
                        streamer.title = streamerData.title;
                        streamer.viewers = streamerData.viewers;
                        
                        // Save profile picture if it's new or different
                        if (streamerData.thumbnail && (!streamer.thumbnail || streamer.thumbnail !== streamerData.thumbnail)) {
                            const localPath = await saveProfilePicture(streamerData.thumbnail, streamer.channelId, 'youtube');
                            if (localPath) {
                                streamer.thumbnail = localPath;
                            }
                        }
                        
                        if (streamerData.isLive) {
                            streamer.lastOnline = Date.now();
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error fetching data for ${streamer.name}:`, error);
            streamer.isLive = false;
            streamer.viewers = 0;
            streamer.title = 'Error';
        }
    }
    
    // Save updated streamers to localStorage
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(STREAMERS));
    
    updateStreamData();
    createStreamList();
    showRefreshNotification();
}

function updateStreamData() {
    const online = STREAMERS.filter(s => s.isLive && !s.banned);
    const offline = STREAMERS.filter(s => !s.isLive || s.banned);
    
    state.jsonData = {
        online: online.sort((a, b) => b.viewers - a.viewers),
        offline: offline.sort((a, b) => {
            if (!a.lastOnline && !b.lastOnline) return 0;
            if (!a.lastOnline) return 1;
            if (!b.lastOnline) return -1;
            return b.lastOnline - a.lastOnline;
        })
    };
}

async function updateStreamList() {
    const streamList = document.getElementById('streamList');
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();

    // Add loading state
    streamList.classList.add('loading');

    try {
        // Filter streamers
        const filteredStreamers = STREAMERS.filter(streamer => 
            streamer.name.toLowerCase().includes(searchQuery)
        );

        // Clear current list
        streamList.innerHTML = '';

        // Add filtered streamers
        filteredStreamers.forEach((streamer, index) => {
            const streamItem = createStreamItem(streamer);
            streamList.appendChild(streamItem);
        });

    } catch (error) {
        console.error('Error updating stream list:', error);
        showError('Failed to update stream list');
    } finally {
        // Remove loading state after a short delay for smooth transition
        setTimeout(() => {
            streamList.classList.remove('loading');
        }, 300);
    }
}

function createStreamList() {
    const streamList = document.getElementById('streamList');
    streamList.innerHTML = '';
    
    // Add LIVE section header
    const liveHeader = document.createElement('div');
    liveHeader.className = 'section-header';
    liveHeader.textContent = 'LIVE';
    streamList.appendChild(liveHeader);
    
    // Add online streamers
    state.jsonData.online.forEach((streamer, index) => {
        streamList.appendChild(createStreamItem(streamer, index));
    });
    
    // Add OFFLINE section header
    const offlineHeader = document.createElement('div');
    offlineHeader.className = 'section-header';
    offlineHeader.textContent = 'OFFLINE';
    streamList.appendChild(offlineHeader);
    
    // Add offline streamers
    state.jsonData.offline.forEach(streamer => {
        streamList.appendChild(createStreamItem(streamer));
    });
}

function createStreamItem(streamer, index) {
    const item = document.createElement('div');
    item.className = `stream-item ${!streamer.isLive ? 'offline' : ''} ${streamer.banned ? 'banned' : ''}`;
    item.style.position = 'relative';

    // Add platform indicator before the link
    const platformIndicator = document.createElement('div');
    platformIndicator.style.position = 'absolute';
    platformIndicator.style.left = '0';
    platformIndicator.style.top = '0';
    platformIndicator.style.bottom = '0';
    platformIndicator.style.width = '4px';
    platformIndicator.style.backgroundColor = 
        streamer.platform === 'twitch' ? '#9146FF' : 
        streamer.platform === 'kick' ? '#53FC18' : 
        '#FF0000'; // YouTube red
    item.appendChild(platformIndicator);

    const streamLink = document.createElement('a');
    streamLink.href = streamer.platform === 'youtube' 
        ? `https://youtube.com/channel/${streamer.channelId}${streamer.isLive ? '/live' : ''}`
        : `https://${streamer.platform}${streamer.platform === 'kick' ? '.com' : '.tv'}/${streamer.channelId}`;
    streamLink.className = 'stream-link';
    streamLink.target = '_blank';

    const thumbnail = document.createElement('div');
    thumbnail.className = 'thumbnail-container';
    
    if (streamer.thumbnail) {
        const img = document.createElement('img');
        img.src = streamer.thumbnail;
        img.className = 'profile-pic';
        thumbnail.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'stream-info';

    const name = document.createElement('div');
    name.className = 'streamer-name';
    if (streamer.isLive && !streamer.banned) {
        const liveIndicator = document.createElement('span');
        liveIndicator.className = 'live-indicator';
        name.appendChild(liveIndicator);
    }
    name.appendChild(document.createTextNode(streamer.name));

    // Add banned indicator if streamer is banned
    if (streamer.banned) {
        const bannedIndicator = document.createElement('span');
        bannedIndicator.className = 'banned-indicator';
        bannedIndicator.textContent = 'BANNED';
        name.appendChild(bannedIndicator);
    }

    const title = document.createElement('div');
    title.className = 'stream-title';
    title.textContent = streamer.banned ? 'BANNED' : (streamer.title || 'Offline');

    const viewers = document.createElement('div');
    viewers.className = 'viewer-count';

    if (streamer.isLive && !streamer.banned) {
        viewers.innerHTML = `
            <i class="fas fa-user-friends"></i>
            <span class="viewer-number">${formatViewerCount(streamer.viewers)}</span>
            <span class="viewers-text">watching</span>
        `;
    } else if (streamer.banned) {
        viewers.className = 'offline-status';
        viewers.innerHTML = `
            <i class="fas fa-ban"></i>
            <span>Account Banned</span>
        `;
    } else {
        viewers.className = 'offline-status';
        viewers.innerHTML = `
            <i class="fas fa-clock"></i>
            <span>${streamer.lastOnline ? `Last live: ${getTimeAgo(new Date(streamer.lastOnline))}` : 'Offline'}</span>
        `;
    }

    info.appendChild(name);
    info.appendChild(title);
    info.appendChild(viewers);

    // Add medal class for top 3 live streamers
    if (streamer.isLive && index < 3) {
        if (index === 0) item.classList.add('gold-medal');
        else if (index === 1) item.classList.add('silver-medal');
        else if (index === 2) item.classList.add('bronze-medal');
    }

    streamLink.appendChild(thumbnail);
    streamLink.appendChild(info);
    item.appendChild(streamLink);

    return item;
}

function formatViewerCount(count) {
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

function toggleInactiveStreamers() {
    state.hideInactiveStreamers = !state.hideInactiveStreamers;
    createStreamList();
}

function showRefreshNotification() {
    const notification = document.getElementById('refreshNotification');
    notification.classList.add('show');
    
    // Hide after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
}

// Create snowflake effect
function createSnowflakes() {
    const numberOfSnowflakes = 20;
    
    for (let i = 0; i < numberOfSnowflakes; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = '❄';
        snowflake.style.left = Math.random() * 100 + 'vw';
        snowflake.style.animationDuration = (Math.random() * 3 + 2) + 's';
        snowflake.style.opacity = Math.random();
        snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
        document.body.appendChild(snowflake);
    }
}

// Add Christmas corner decorations
function addChristmasCorner() {
    const corner = document.createElement('div');
    corner.className = 'christmas-corner';
    
    const decorations = [
        '🎄', // Christmas tree
        '⛄', // Snowman
        '🦌', // Reindeer
    ];
    
    decorations.forEach(decoration => {
        const span = document.createElement('span');
        span.textContent = decoration;
        corner.appendChild(span);
    });
    
    document.body.appendChild(corner);
}

// Add frost accents to stream items
function addFrostAccents() {
    const streamItems = document.querySelectorAll('.stream-item');
    
    streamItems.forEach(item => {
        // Add Christmas decorations to each card
        const decorTop = document.createElement('div');
        decorTop.className = 'christmas-decor top-left';
        decorTop.textContent = Math.random() > 0.5 ? '🎄' : '⛄';
        
        const decorBottom = document.createElement('div');
        decorBottom.className = 'christmas-decor bottom-right';
        decorBottom.textContent = Math.random() > 0.5 ? '🦌' : '🎅';
        
        item.appendChild(decorTop);
        item.appendChild(decorBottom);
        
        // Add frost accents
        for (let i = 0; i < 3; i++) {
            const frost = document.createElement('div');
            frost.className = 'frost-accent';
            frost.style.width = (Math.random() * 30 + 20) + 'px';
            frost.style.height = frost.style.width;
            frost.style.left = Math.random() * 100 + '%';
            frost.style.top = Math.random() * 100 + '%';
            item.appendChild(frost);
        }
    });
}

// Function to mark a streamer as banned
async function banStreamer(channelId) {
    const streamer = STREAMERS.find(s => s.channelId === channelId);
    if (streamer) {
        // Save the current profile picture before marking as banned
        if (streamer.thumbnail) {
            await saveProfilePicture(streamer.thumbnail, streamer.channelId, streamer.platform);
        }
        streamer.banned = true;
        await saveStreamersToFile();
        updateBannedStreamers();
        createStreamList();
    }
}

function createBannedStreamerCard(streamer) {
    const card = document.createElement('div');
    card.className = 'banned-streamer-card';
    
    // Format profile picture path: platform-channelid.webp
    const profilePicUrl = `images/profiles/${streamer.platform}-${streamer.channelId}.webp`;
    
    card.innerHTML = `
        <div class="banned-streamer-info">
            <img src="${profilePicUrl}" 
                 alt="${streamer.name}" 
                 class="banned-streamer-image"
                 onerror="this.src='images/default-avatar.png'">
            <div>
                <div class="banned-streamer-name">${streamer.name}</div>
                <div class="violation-text">TOS VIOLATION</div>
            </div>
        </div>
        <div class="banned-tag">BANNED</div>
    `;
    
    return card;
}

function updateBannedStreamers() {
    const bannedStreamersContainer = document.getElementById('banned-streamers');
    if (!bannedStreamersContainer) return;

    bannedStreamersContainer.innerHTML = `
        <div class="banned-streamers-header">
            ⚠️ BANNED STREAMERS ⚠️
        </div>
    `;

    const bannedStreamers = STREAMERS.filter(s => s.banned);
    
    if (bannedStreamers.length === 0) {
        bannedStreamersContainer.style.display = 'none';
        return;
    }

    bannedStreamers.forEach(streamer => {
        const card = createBannedStreamerCard(streamer);
        bannedStreamersContainer.appendChild(card);
    });

    bannedStreamersContainer.style.display = 'block';
}

// Update the createStreamItem function to reinitialize frost effects
const originalCreateStreamItem = createStreamItem;
createStreamItem = (streamer, index) => {
    const item = originalCreateStreamItem(streamer, index);
    addFrostAccents();
    return item;
};

// Search functionality
const searchInput = document.getElementById('searchInput');

// Debounce search input
let searchTimeout;

searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        updateStreamList();
    }, 300);
});

function filterStreams(searchTerm) {
    const streamItems = document.querySelectorAll('.stream-item');
    const normalizedSearch = searchTerm.toLowerCase().trim();

    streamItems.forEach(item => {
        const streamerName = item.querySelector('.streamer-name').textContent.toLowerCase();
        const streamTitle = item.querySelector('.stream-title').textContent.toLowerCase();
        const shouldShow = streamerName.includes(normalizedSearch) || 
                          streamTitle.includes(normalizedSearch);
        
        item.style.display = shouldShow ? '' : 'none';
    });
}

function showLoadingSkeletons() {
    const streamList = document.getElementById('streamList');
    streamList.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading streams...</div>
        </div>
    `;

    // Create 5 skeleton items
    for (let i = 0; i < 5; i++) {
        const skeletonItem = document.createElement('div');
        skeletonItem.className = 'skeleton-stream';
        skeletonItem.innerHTML = `
            <div class="skeleton-avatar"></div>
            <div class="skeleton-content">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
            </div>
        `;
        streamList.appendChild(skeletonItem);
    }
}

function clearLoadingSkeletons() {
    const streamList = document.getElementById('streamList');
    const skeletons = streamList.querySelectorAll('.skeleton-stream');
    skeletons.forEach(skeleton => skeleton.remove());
}

async function updateStreamers() {
    const bannedStreamers = document.getElementById('banned-streamers');
    if (bannedStreamers) {
        bannedStreamers.style.display = 'none';
    }

    showLoadingSkeletons();

    try {
        await loadStreamersFromFile();
        await updateViewerCounts();
        await updateBannedStreamers();
        clearLoadingSkeletons();
        createStreamList();
        showRefreshNotification();
    } catch (error) {
        console.error('Error fetching streamers:', error);
        showError('Failed to load streamers. Please try again later.');
    } finally {
        if (bannedStreamers) {
            bannedStreamers.style.display = 'block';
        }
    }
}

// Initialize and start periodic updates
document.addEventListener('DOMContentLoaded', async () => {
    const bannedStreamers = document.getElementById('banned-streamers');
    if (bannedStreamers) {
        bannedStreamers.style.display = 'none';
    }

    showLoadingSkeletons();

    try {
        await loadStreamersFromFile();
        await updateViewerCounts();
        await updateBannedStreamers();
        clearLoadingSkeletons();
        createStreamList();
        showRefreshNotification();
    } catch (error) {
        console.error('Error initializing:', error);
    } finally {
        if (bannedStreamers) {
            bannedStreamers.style.display = 'block';
        }
    }

    // Start periodic updates
    setInterval(async () => {
        await updateStreamers();
    }, CONFIG.UPDATE_INTERVAL);
    
    // Add Christmas decorations
    createSnowflakes();
    addChristmasCorner();
    addFrostAccents();

    // Back to Top Button
    const backToTop = document.getElementById('backToTop');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTop.classList.add('visible');
        } else {
            backToTop.classList.remove('visible');
        }
    });

    backToTop.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
});

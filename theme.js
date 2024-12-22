// Theme handling
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = themeToggle.querySelector('i');
const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

// Load saved theme or use system preference
const savedTheme = localStorage.getItem('theme') || (prefersDarkScheme.matches ? 'dark' : 'light');
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
});

function updateThemeIcon(theme) {
    themeIcon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}

// Settings modal
const settingsButton = document.getElementById('settings-button');
const settingsModal = document.getElementById('settings-modal');
const closeButton = settingsModal.querySelector('.close-button');

settingsButton.addEventListener('click', () => {
    settingsModal.classList.add('show');
});

closeButton.addEventListener('click', () => {
    settingsModal.classList.remove('show');
});

// Close modal when clicking outside
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove('show');
    }
});

// Handle settings changes
const autoRefreshSelect = document.getElementById('auto-refresh');
const notificationsToggle = document.getElementById('notifications');

// Load saved settings
const savedInterval = localStorage.getItem('autoRefreshInterval') || '60';
const savedNotifications = localStorage.getItem('notifications') === 'true';

autoRefreshSelect.value = savedInterval;
notificationsToggle.checked = savedNotifications;

autoRefreshSelect.addEventListener('change', (e) => {
    localStorage.setItem('autoRefreshInterval', e.target.value);
    // Trigger refresh interval update in main script
    window.dispatchEvent(new CustomEvent('refreshIntervalChanged', {
        detail: { interval: parseInt(e.target.value) }
    }));
});

notificationsToggle.addEventListener('change', (e) => {
    localStorage.setItem('notifications', e.target.checked);
    if (e.target.checked) {
        requestNotificationPermission();
    }
});

// Notifications
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('This browser does not support notifications');
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        alert('We need notification permissions to alert you about stream changes');
        notificationsToggle.checked = false;
        localStorage.setItem('notifications', false);
    }
}

// Search functionality
const searchInput = document.getElementById('streamer-search');
const searchButton = document.querySelector('.search-button');

function performSearch() {
    const query = searchInput.value.toLowerCase();
    const streamItems = document.querySelectorAll('.stream-item');
    
    streamItems.forEach(item => {
        const streamerName = item.querySelector('.streamer-name').textContent.toLowerCase();
        const streamTitle = item.querySelector('.stream-title').textContent.toLowerCase();
        
        if (streamerName.includes(query) || streamTitle.includes(query)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

searchInput.addEventListener('input', performSearch);
searchButton.addEventListener('click', performSearch);

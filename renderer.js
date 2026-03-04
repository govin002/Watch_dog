// renderer.js - UI logic for WatchDog

// Helper to create an app card element
function createAppCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';
    card.id = `card-${app.name.replace(/\s+/g, '-')}`;

    const info = document.createElement('div');
    info.className = 'app-info';

    const name = document.createElement('div');
    name.className = 'app-name';
    name.textContent = app.name;

    const status = document.createElement('div');
    status.className = 'app-status';
    status.id = `status-${app.name.replace(/\s+/g, '-')}`;
    status.textContent = 'checking...';

    info.appendChild(name);
    info.appendChild(status);

    // Toggle switch for auto‑restart
    const toggleWrapper = document.createElement('label');
    toggleWrapper.className = 'toggle-switch';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!app.autoRestart;
    toggle.id = `toggle-${app.name.replace(/\s+/g, '-')}`;
    toggle.addEventListener('change', async (e) => {
        const newVal = e.target.checked;
        await window.watchdog.setAutoRestart(app.name, newVal);
        // Optimistically update UI
        app.autoRestart = newVal;
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleWrapper.appendChild(toggle);
    toggleWrapper.appendChild(slider);

    card.appendChild(info);
    card.appendChild(toggleWrapper);
    return card;
}

async function init() {
    const apps = await window.watchdog.getApps();
    const list = document.getElementById('app-list');
    apps.forEach(app => {
        const card = createAppCard(app);
        list.appendChild(card);
    });
}

// Listen for status updates from main process
window.watchdog.onAppStatusUpdated((data) => {
    const statusEl = document.getElementById(`status-${data.name.replace(/\s+/g, '-')}`);
    if (statusEl) {
        statusEl.textContent = data.status;
        // Change color based on status
        if (data.status === 'running') {
            statusEl.style.color = '#4caf50';
        } else if (data.status === 'restarted') {
            statusEl.style.color = '#ff9800';
        } else {
            statusEl.style.color = '#f44336';
        }
    }
});

// Kick off UI
init();

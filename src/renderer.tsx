import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

interface AppEntry {
    id: string;
    name: string;
    path: string;
    autoRestart: boolean;
    status: 'running' | 'stopped' | 'restarted' | 'checking';
    restartCount: number;
}

interface LogEntry {
    timestamp: string;
    rawTime: number;
    appId: string;
    appName: string;
    event: string;
}

declare global {
    interface Window {
        watchdog: {
            getConfig: () => Promise<{ apps: AppEntry[], interval: number, logRetentionDays: number }>;
            getLogs: () => Promise<LogEntry[]>;
            browseFile: () => Promise<string | null>;
            addApp: (app: { name: string, path: string }) => Promise<AppEntry>;
            removeApp: (id: string) => Promise<boolean>;
            toggleAutoRestart: (data: { id: string, value: boolean }) => Promise<boolean>;
            updateInterval: (interval: number) => Promise<boolean>;
            updateLogRetention: (days: number) => Promise<boolean>;
            openConfigFolder: () => Promise<void>;
            onStatusUpdate: (callback: (apps: AppEntry[]) => void) => () => void;
            onLogsUpdated: (callback: (logs: LogEntry[]) => void) => () => void;
        };
    }
}

const App: React.FC = () => {
    const [apps, setApps] = useState<AppEntry[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [interval, setIntervalVal] = useState(5);
    const [retentionDays, setRetentionDays] = useState(1);
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPath, setNewPath] = useState('');
    const [activeTab, setActiveTab] = useState<'monitor' | 'logs' | 'settings' | 'about'>('monitor');
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        window.watchdog.getConfig().then(cfg => {
            setApps(cfg.apps);
            setIntervalVal(cfg.interval);
            setRetentionDays(cfg.logRetentionDays || 1);
        });
        window.watchdog.getLogs().then(setLogs);

        const unsubStatus = window.watchdog.onStatusUpdate((updatedApps) => {
            setApps(updatedApps);
        });
        const unsubLogs = window.watchdog.onLogsUpdated((updatedLogs) => {
            setLogs(updatedLogs);
        });

        return () => {
            unsubStatus();
            unsubLogs();
        };
    }, []);

    const handleBrowse = async () => {
        const path = await window.watchdog.browseFile();
        if (path) setNewPath(path);
    };

    const handleAddApp = async () => {
        if (!newName || !newPath) return;
        const added = await window.watchdog.addApp({ name: newName, path: newPath });
        setApps([...apps, added]);
        setIsAdding(false);
        setNewName('');
        setNewPath('');
    };

    const handleRemove = async (id: string) => {
        if (confirm('Are you sure you want to stop watching this app?')) {
            await window.watchdog.removeApp(id);
            setApps(apps.filter(a => a.id !== id));
        }
    };

    const handleToggle = async (id: string, current: boolean) => {
        const newVal = !current;
        await window.watchdog.toggleAutoRestart({ id, value: newVal });
        setApps(apps.map(a => a.id === id ? { ...a, autoRestart: newVal } : a));
    };

    const handleIntervalChange = async (val: string) => {
        const num = parseInt(val);
        if (isNaN(num) || num < 1) return;
        setIntervalVal(num);
        await window.watchdog.updateInterval(num);
    };

    const handleRetentionChange = async (val: string) => {
        const num = parseInt(val);
        if (isNaN(num) || num < 1) return;
        setRetentionDays(num);
        await window.watchdog.updateLogRetention(num);
    };

    return (
        <div className="container">
            <header className="header">
                <h1 className="title">🛡️ WatchDog Pro</h1>
                <nav className="tabs">
                    <button className={activeTab === 'monitor' ? 'active' : ''} onClick={() => setActiveTab('monitor')}>Monitoring</button>
                    <button className={activeTab === 'logs' ? 'active' : ''} onClick={() => setActiveTab('logs')}>History Logs</button>
                    <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
                    <button className={activeTab === 'about' ? 'active' : ''} onClick={() => setActiveTab('about')}>About</button>
                </nav>
            </header>

            {activeTab === 'monitor' && (
                <section className="tab-content">
                    <div className="actions search-actions">
                        <div className="search-bar">
                            <input
                                type="text"
                                placeholder="Search apps by name or path..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>➕ Add New App</button>
                    </div>

                    {isAdding && (
                        <div className="modal-overlay">
                            <div className="modal-card">
                                <h3>Monitor New Application</h3>
                                <div className="form-group">
                                    <label>Display Name</label>
                                    <input type="text" placeholder="e.g. My Website Server" value={newName} onChange={e => setNewName(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label>Application Path (Auto-restarts this .exe)</label>
                                    <div className="path-input">
                                        <input
                                            type="text"
                                            placeholder="Paste path here or Browse..."
                                            value={newPath}
                                            onChange={e => setNewPath(e.target.value)}
                                        />
                                        <button className="btn-browse" onClick={handleBrowse}>Browse</button>
                                    </div>
                                </div>
                                <div className="modal-actions">
                                    <button className="btn" onClick={() => setIsAdding(false)}>Cancel</button>
                                    <button className="btn btn-primary" onClick={handleAddApp}>Start Watching</button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="app-list">
                        {apps.filter(app =>
                            app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            app.path.toLowerCase().includes(searchQuery.toLowerCase())
                        ).length === 0 ? (
                            <div className="empty-state">
                                {searchQuery ? `No apps matching "${searchQuery}"` : 'No apps are being monitored yet. Click "Add New App" to start.'}
                            </div>
                        ) : apps.filter(app =>
                            app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            app.path.toLowerCase().includes(searchQuery.toLowerCase())
                        ).map(app => (
                            <div className="app-card" key={app.id}>
                                <div className="app-info">
                                    <div className="app-main-info">
                                        <span className="app-name">{app.name}</span>
                                        <span className={`status-badge status-${app.status}`}>{app.status}</span>
                                        {app.restartCount > 0 && <span className="restart-count">Restarts: {app.restartCount}</span>}
                                    </div>
                                    <div className="app-path">{app.path}</div>
                                </div>
                                <div className="app-controls">
                                    <div className="auto-toggle">
                                        <span>Auto-Restart</span>
                                        <label className="toggle-switch">
                                            <input type="checkbox" checked={app.autoRestart} onChange={() => handleToggle(app.id, app.autoRestart)} />
                                            <span className="slider"></span>
                                        </label>
                                    </div>
                                    <button className="btn btn-sm" onClick={() => { setSelectedAppId(app.id); setActiveTab('logs'); }}>History</button>
                                    <button className="btn-icon delete" onClick={() => handleRemove(app.id)}>🗑️</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {activeTab === 'logs' && (
                <section className="tab-content">
                    <div className="log-filters">
                        <button className={!selectedAppId ? 'filter-btn active' : 'filter-btn'} onClick={() => setSelectedAppId(null)}>All</button>
                        {apps.map(app => (
                            <button
                                key={app.id}
                                className={selectedAppId === app.id ? 'filter-btn active' : 'filter-btn'}
                                onClick={() => setSelectedAppId(app.id)}
                            >
                                {app.name}
                            </button>
                        ))}
                    </div>

                    <div className="log-list">
                        {logs.filter(l => !selectedAppId || l.appId === selectedAppId).length === 0 ? (
                            <div className="empty-state">No events recorded yet.</div>
                        ) : logs.filter(l => !selectedAppId || l.appId === selectedAppId).map((log, i) => (
                            <div className="log-entry" key={i}>
                                <span className="log-time">{log.timestamp}</span>
                                <span className="log-app">[{log.appName}]</span>
                                <span className="log-event">{log.event}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {activeTab === 'settings' && (
                <section className="tab-content">
                    <div className="settings-card">
                        <h3>Global WatchDog Settings</h3>
                        <div className="setting-item">
                            <label>Monitoring Interval (Seconds)</label>
                            <div className="interval-control">
                                <input type="number" min="1" max="60" value={interval} onChange={e => handleIntervalChange(e.target.value)} />
                                <span>Seconds between status checks</span>
                            </div>
                            <p className="help-text">Lower values respond faster but use slightly more CPU.</p>
                        </div>
                        <div className="setting-item">
                            <label>History Log Retention (Days)</label>
                            <div className="interval-control">
                                <input type="number" min="1" max="365" value={retentionDays} onChange={e => handleRetentionChange(e.target.value)} />
                                <span>Days before automatic deletion</span>
                            </div>
                            <p className="help-text">Logs older than this will be permanently removed to keep the app lightweight.</p>
                        </div>
                        <div className="setting-item">
                            <label>Data & Logs Storage</label>
                            <div className="storage-control">
                                <button className="btn" onClick={() => window.watchdog.openConfigFolder()}>📂 Open AppData Folder</button>
                                <p className="help-text">View your configuration and logs in local storage.</p>
                            </div>
                        </div>
                    </div>
                </section>
            )}
            {activeTab === 'about' && (
                <section className="tab-content">
                    <div className="about-card">
                        <div className="about-header">
                            <span className="about-icon">🛡️</span>
                            <div>
                                <h2 className="about-name">WatchDog Pro</h2>
                                <p className="about-version">Version 1.0.0</p>
                            </div>
                        </div>
                        <div className="about-section">
                            <h3>Project Description</h3>
                            <p>WatchDog Pro is a professional utility designed to ensure your critical applications stay running. It monitors the status of specified executables and automatically restarts them if they crash or are closed unexpectedly.</p>
                        </div>
                        <div className="about-section">
                            <h3>Key Features</h3>
                            <ul className="about-list-dots">
                                <li>Real-time process monitoring</li>
                                <li>Configurable auto-restart logic</li>
                                <li>Smart log retention and automatic pruning</li>
                                <li>Individual app history tracking</li>
                                <li>Minimal & professional desktop aesthetic</li>
                            </ul>
                        </div>
                        <div className="about-footer">
                            <p>© 2026 WatchDog Pro by gowinda. All rights reserved.</p>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('app-root')!);
root.render(<App />);

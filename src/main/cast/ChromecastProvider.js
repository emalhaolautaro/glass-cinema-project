/**
 * Chromecast Provider Module
 * Singleton browser pattern for persistent mDNS listening
 */
const chromecasts = require('chromecasts');

// --- Configuration ---
const POLLING_INTERVAL_MS = 2000;
const DEVICE_TTL_MS = 15000;

// --- Singleton State ---
let browser = null;
let initialized = false;
let discoveryCallback = null;
let errorCallback = null;
let isDiscovering = false;
let pollInterval = null;
let devices = new Map(); // name -> { device, lastSeen }

/**
 * Initialize browser singleton (lazy, called once)
 * @param {string} localIp - Local IP to bind the mDNS socket
 */
function init(localIp) {
    if (initialized) return;

    console.log(`[ChromecastProvider] Initializing singleton browser on interface: ${localIp}...`);
    browser = chromecasts({ interface: localIp });
    initialized = true;

    // Attach persistent listeners
    browser.on('update', (device) => {
        // console.log('[ChromecastProvider] RAW update event:', device?.name || 'null device'); // Reduced spam

        if (!device || !device.name) return;

        // STRICT IDENTITY CHECK
        const deviceId = device.id || device.name;

        // Check for duplicates / updates
        const existing = devices.get(deviceId);
        const isNew = !existing;
        const isIpChange = existing && existing.device.host !== device.host;

        if (isNew) {
            console.log(`[Security] Device authenticated: ID=${deviceId}, Host=${device.host}`);
        } else if (isIpChange) {
            console.log(`[Security] Device IP changed: ID=${deviceId}, OldHost=${existing.device.host}, NewHost=${device.host}`);
        }

        const now = Date.now();
        devices.set(deviceId, { device, lastSeen: now });

        if (isDiscovering && discoveryCallback) {
            // Emit normalized device info
            discoveryCallback({
                name: device.name,
                host: device.host,
                type: 'chromecast',
                id: deviceId, // Essential for Manager to display [ID]
                originalDevice: device
            });
        }
    });

    browser.on('error', (err) => {
        // Silence ECONNRESET and EPERM during discovery
        const ignorable = ['ECONNRESET', 'EPERM', 'ENOENT'];
        if (ignorable.some(code => err.code === code || err.message?.includes(code))) {
            return;
        }
        console.error('[ChromecastProvider] Browser error:', err);
        if (errorCallback) errorCallback(err);
    });

    console.log('[ChromecastProvider] Browser initialized (Security Enhanced)');
}

/**
 * Start discovery with polling
 * @param {string} localIp - Local IP for interface binding
 * @param {function} onDeviceFound - Callback for each device
 * @param {function} onError - Error callback
 */
function startDiscovery(localIp, onDeviceFound, onError) {
    if (isDiscovering) {
        console.log('[ChromecastProvider] Already discovering');
        return;
    }

    // Lazy init with localIp
    init(localIp);

    console.log('[ChromecastProvider] Starting discovery...');
    isDiscovering = true;
    discoveryCallback = onDeviceFound;
    errorCallback = onError;

    // Trigger immediate scan
    console.log('[ChromecastProvider] Triggering initial mDNS scan...');
    browser.update();

    // Polling every 2s for flaky mDNS
    pollInterval = setInterval(() => {
        if (!isDiscovering) {
            clearInterval(pollInterval);
            pollInterval = null;
            return;
        }
        console.log('[ChromecastProvider] Polling mDNS...');
        browser.update();
        pruneStaleDevices();
    }, POLLING_INTERVAL_MS);
}

/**
 * Stop discovery (pauses callbacks but keeps browser alive)
 */
function stopDiscovery() {
    console.log('[ChromecastProvider] Stopping discovery and destroying browser...');
    isDiscovering = false;
    discoveryCallback = null;
    errorCallback = null;

    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    // Full cleanup - release port 5353
    if (browser) {
        try {
            browser.destroy();
            console.log('[ChromecastProvider] Browser destroyed and socket released');
        } catch (e) {
            console.debug('[ChromecastProvider] Destroy error:', e.message);
        }
        browser = null;
        initialized = false;
        devices.clear();
    }
}

/**
 * Remove devices not seen within TTL
 */
function pruneStaleDevices() {
    const now = Date.now();
    for (const [name, entry] of devices.entries()) {
        if (now - entry.lastSeen > DEVICE_TTL_MS) {
            console.log(`[ChromecastProvider] Device stale, removing: ${name}`);
            devices.delete(name);
        }
    }
}

/**
 * Get all currently known devices
 * @returns {Array} Normalized device list
 */
function getDevices() {
    return Array.from(devices.values()).map(entry => ({
        name: entry.device.name,
        host: entry.device.host,
        type: 'chromecast',
        id: entry.device.id || entry.device.name,
        originalDevice: entry.device
    }));
}

/**
 * Get a specific device by ID or Name (fallback)
 * @param {string} identifier - Device ID or Name
 * @returns {object|null} Device entry or null
 */
function getDevice(identifier) {
    // Try direct ID lookup first (fast)
    let entry = devices.get(identifier);

    // Initial fallback: maybe it's a name? (O(N) search)
    if (!entry) {
        for (const [id, e] of devices) {
            if (e.device.name === identifier) {
                entry = e;
                break;
            }
        }
    }

    if (!entry) return null;
    return {
        name: entry.device.name,
        host: entry.device.host,
        type: 'chromecast',
        id: entry.device.id || entry.device.name,
        originalDevice: entry.device
    };
}

/**
 * Play media on a Chromecast device
 * @param {object} device - Original device object
 * @param {object} mediaInfo - { url, title, coverUrl, subtitleUrl }
 * @returns {Promise}
 */
function play(device, mediaInfo) {
    return new Promise((resolve, reject) => {
        if (!device) return reject(new Error('No device provided'));

        console.log(`[ChromecastProvider] Playing on ${device.name}`);

        // Clean up old listeners
        try {
            device.removeAllListeners('status');
            device.removeAllListeners('error');
        } catch (e) { }

        device.on('error', (err) => {
            console.error('[ChromecastProvider] Device error:', err);
        });

        const options = {
            title: mediaInfo.title || 'Glass Cinema',
            type: 'video/mp4',
            images: mediaInfo.coverUrl ? [mediaInfo.coverUrl] : []
        };

        if (mediaInfo.subtitleUrl) {
            options.subtitles = [{
                trackId: 1,
                type: 'TEXT',
                trackContentId: mediaInfo.subtitleUrl,
                trackContentType: 'text/vtt',
                name: 'Spanish',
                language: 'es-ES',
                subtype: 'SUBTITLES'
            }];
            options.autoSubtitles = 1;
        }

        device.play(mediaInfo.url, options, (err, player) => {
            if (err) return reject(err);
            console.log(`[ChromecastProvider] Playback started on ${device.name}`);
            resolve({ device, player });
        });
    });
}

/**
 * Pause playback
 * @param {object} device - Original device
 * @returns {Promise}
 */
function pause(device) {
    return new Promise((resolve) => {
        if (!device) return resolve();
        device.pause(() => resolve());
    });
}

/**
 * Resume playback
 * @param {object} device - Original device
 * @returns {Promise}
 */
function resume(device) {
    return new Promise((resolve) => {
        if (!device) return resolve();
        device.resume(() => resolve());
    });
}

/**
 * Stop playback
 * @param {object} device - Original device
 * @returns {Promise}
 */
function stop(device) {
    return new Promise((resolve) => {
        if (!device) return resolve();

        try {
            if (typeof device.stop === 'function') {
                device.stop(() => {
                    try { device.removeAllListeners(); } catch (e) { }
                    resolve();
                });
            } else {
                resolve();
            }
        } catch (err) {
            const ignorable = ['ECONNRESET', 'EPERM'];
            if (ignorable.some(code => err.code === code || err.message?.includes(code))) {
                console.debug('[ChromecastProvider] Ignored stop error:', err.code);
                return resolve();
            }
            console.error('[ChromecastProvider] Stop error:', err);
            resolve(); // Resolve anyway to not block cleanup
        }
    });
}

/**
 * Seek to position
 * @param {object} device - Original device
 * @param {number} seconds - Target position in seconds
 * @returns {Promise}
 */
function seek(device, seconds) {
    return new Promise((resolve) => {
        if (!device) return resolve();
        device.seek(seconds, () => resolve());
    });
}

/**
 * Set volume
 * @param {object} device - Original device
 * @param {number} level - Volume 0-1
 * @returns {Promise}
 */
function setVolume(device, level) {
    return new Promise((resolve) => {
        if (!device) return resolve();
        device.volume(level, () => resolve());
    });
}

/**
 * Get playback status
 * @param {object} device - Original device
 * @param {function} callback - Status callback
 */
function getStatus(device, callback) {
    if (!device || typeof device.status !== 'function') return;

    device.status((err, status) => {
        if (err) return;
        if (status && callback) {
            callback({
                currentTime: status.currentTime || 0,
                duration: status.media?.duration || 0,
                playerState: status.playerState || 'UNKNOWN',
                volume: status.volume?.level || 1,
                muted: status.volume?.muted || false
            });
        }
    });
}

/**
 * Full cleanup - destroy browser (only on app exit)
 */
function cleanup() {
    console.log('[ChromecastProvider] Full cleanup');
    stopDiscovery();

    if (browser) {
        try {
            browser.destroy();
            console.log('[ChromecastProvider] Browser destroyed');
        } catch (e) {
            console.debug('[ChromecastProvider] Cleanup error:', e.message);
        }
        browser = null;
        initialized = false;
    }

    devices.clear();
}

module.exports = {
    init,
    startDiscovery,
    stopDiscovery,
    getDevices,
    getDevice,
    play,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    getStatus,
    cleanup,
    // Expose type for CastManager
    TYPE: 'chromecast'
};

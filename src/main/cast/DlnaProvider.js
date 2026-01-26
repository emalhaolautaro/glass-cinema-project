/**
 * DLNA Provider Module
 * Singleton browser pattern for persistent SSDP listening
 * Mirrors ChromecastProvider API for seamless CastManager integration
 */
const dlnacasts = require('dlnacasts');

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
let devices = new Map(); // id -> { device, lastSeen }

/**
 * Initialize browser singleton (lazy, called once)
 */
function init() {
    if (initialized) return;

    console.log('[DlnaProvider] Initializing singleton browser...');
    browser = dlnacasts();
    initialized = true;

    // Attach persistent listeners
    browser.on('update', (device) => {
        if (!device || !device.name) return;

        const deviceId = device.host || device.name;

        const existing = devices.get(deviceId);
        const isNew = !existing;

        if (isNew) {
            console.log(`[DlnaProvider] Device found: Name=${device.name}, Host=${device.host}`);
        }

        const now = Date.now();
        devices.set(deviceId, { device, lastSeen: now });

        if (isDiscovering && discoveryCallback) {
            discoveryCallback({
                name: device.name,
                host: device.host,
                type: 'dlna',
                id: deviceId,
                originalDevice: device
            });
        }
    });

    browser.on('error', (err) => {
        console.error('[DlnaProvider] Browser error:', err);
        if (errorCallback) errorCallback(err);
    });

    console.log('[DlnaProvider] Browser initialized');
}

/**
 * Start discovery with polling
 * @param {function} onDeviceFound - Callback for each device
 * @param {function} onError - Error callback
 */
function startDiscovery(onDeviceFound, onError) {
    if (isDiscovering) {
        console.log('[DlnaProvider] Already discovering');
        return;
    }

    init();

    console.log('[DlnaProvider] Starting discovery...');
    isDiscovering = true;
    discoveryCallback = onDeviceFound;
    errorCallback = onError;

    // Trigger immediate scan
    console.log('[DlnaProvider] Triggering initial SSDP scan...');
    browser.update();

    // Polling every 2s for device refresh
    pollInterval = setInterval(() => {
        if (!isDiscovering) {
            clearInterval(pollInterval);
            pollInterval = null;
            return;
        }
        console.log('[DlnaProvider] Polling SSDP...');
        browser.update();
        pruneStaleDevices();
    }, POLLING_INTERVAL_MS);
}

/**
 * Stop discovery (pauses callbacks and cleans up browser)
 */
function stopDiscovery() {
    console.log('[DlnaProvider] Stopping discovery...');
    isDiscovering = false;
    discoveryCallback = null;
    errorCallback = null;

    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    if (browser) {
        try {
            browser.destroy();
            console.log('[DlnaProvider] Browser destroyed');
        } catch (e) {
            console.debug('[DlnaProvider] Destroy error:', e.message);
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
    for (const [id, entry] of devices.entries()) {
        if (now - entry.lastSeen > DEVICE_TTL_MS) {
            console.log(`[DlnaProvider] Device stale, removing: ${entry.device.name}`);
            devices.delete(id);
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
        type: 'dlna',
        id: entry.device.host || entry.device.name,
        originalDevice: entry.device
    }));
}

/**
 * Get a specific device by ID or Name
 * @param {string} identifier - Device ID or Name
 * @returns {object|null} Device entry or null
 */
function getDevice(identifier) {
    let entry = devices.get(identifier);

    // Fallback: search by name
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
        type: 'dlna',
        id: entry.device.host || entry.device.name,
        originalDevice: entry.device
    };
}

/**
 * Play media on a DLNA device
 * @param {object} device - Original device object
 * @param {object} mediaInfo - { url, title, coverUrl, subtitleUrl }
 * @returns {Promise}
 */
function play(device, mediaInfo) {
    return new Promise((resolve, reject) => {
        if (!device) return reject(new Error('No device provided'));

        console.log(`[DlnaProvider] Playing on ${device.name}`);

        const options = {
            title: mediaInfo.title || 'Glass Cinema',
            type: 'video/mp4'
        };

        // DLNA subtitle support (if device supports it)
        if (mediaInfo.subtitleUrl) {
            options.subtitles = [mediaInfo.subtitleUrl];
        }

        device.play(mediaInfo.url, options, (err, status) => {
            if (err) return reject(err);
            console.log(`[DlnaProvider] Playback started on ${device.name}`);
            resolve({ device, status });
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
        if (!device || typeof device.pause !== 'function') return resolve();
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
        if (!device || typeof device.resume !== 'function') return resolve();
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
                device.stop(() => resolve());
            } else {
                resolve();
            }
        } catch (err) {
            console.error('[DlnaProvider] Stop error:', err);
            resolve();
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
        if (!device || typeof device.seek !== 'function') return resolve();
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
        if (!device || typeof device.volume !== 'function') return resolve();
        device.volume(level, () => resolve());
    });
}

/**
 * Get playback status
 * @param {object} device - Original device
 * @param {function} callback - Status callback
 */
function getStatus(device, callback) {
    if (!device || typeof device.status !== 'function') {
        if (callback) callback({ playerState: 'UNKNOWN' });
        return;
    }

    device.status((err, status) => {
        if (err || !status) {
            if (callback) callback({ playerState: 'UNKNOWN' });
            return;
        }
        if (callback) {
            callback({
                currentTime: status.currentTime || 0,
                duration: status.duration || 0,
                playerState: status.playerState || 'UNKNOWN',
                volume: status.volume || 1,
                muted: false
            });
        }
    });
}

/**
 * Full cleanup - destroy browser (only on app exit)
 */
function cleanup() {
    console.log('[DlnaProvider] Full cleanup');
    stopDiscovery();
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
    TYPE: 'dlna'
};

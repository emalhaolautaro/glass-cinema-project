/**
 * Cast Manager Module - Chromecast Exclusive
 * Simplified orchestrator for Chromecast devices only.
 * Coordinates discovery and playback.
 */
const ChromecastProvider = require('./cast/ChromecastProvider');

// --- State ---
let discoveryCallback = null;
let isDiscovering = false;
let activeDevice = null;
let statusCallback = null;
let statusInterval = null;

// --- Discovery ---

/**
 * Start discovery using only ChromecastProvider
 * @param {function} onDeviceFound - Callback for UI
 * @param {string} localIp - Local IP for interface binding
 */
function startDiscovery(onDeviceFound, localIp) {
    if (isDiscovering) return;

    if (!localIp) console.warn('[CastManager] Warning: No Local IP provided via IPC');

    console.log(`[CastManager] Starting Chromecast Discovery on interface: ${localIp || 'DEFAULT'}`);

    isDiscovering = true;
    discoveryCallback = onDeviceFound;

    // Use ChromecastProvider directly
    ChromecastProvider.startDiscovery(localIp, (device) => {
        let displayName = device.name;

        // Noblex / Generic Android TV Fix
        if (displayName.startsWith('AI-PONT-SA') || displayName.length > 20 || /^[a-f0-9]{12,}$/i.test(displayName)) {
            const original = device.originalDevice;
            if (original?.txtRecord?.fn) {
                displayName = original.txtRecord.fn;
            } else if (original?.fullname && original.fullname.includes('Noblex')) {
                displayName = 'Noblex TV (Smart Interface)';
            } else {
                displayName = 'Noblex TV (Android TV)';
            }
        }

        // Pass directly to UI
        if (discoveryCallback) {
            // User Request: Display FriendlyName [Unique_ID]
            const uniqueId = device.id;
            const uiName = `${displayName} [${uniqueId}]`;

            discoveryCallback({
                name: uiName, // This is what the UI shows
                id: uniqueId, // Original ID for connection
                host: device.host,
                type: 'chromecast',
                originalDevice: device.originalDevice
            });
        }
    }, (err) => {
        console.error('[CastManager] Discovery Error:', err);
    });
}

function stopDiscovery() {
    isDiscovering = false;
    discoveryCallback = null;
    ChromecastProvider.stopDiscovery();
    console.log('[CastManager] Discovery stopped');
}

function getDiscoveredDevices() {
    return ChromecastProvider.getDevices();
}

// --- Playback ---

async function playOnDevice(deviceName, mediaInfo) {
    console.log(`[CastManager] Requesting playback on ${deviceName}`);

    const deviceWrapper = ChromecastProvider.getDevice(deviceName);
    if (!deviceWrapper) throw new Error(`Device not found: ${deviceName}`);

    const device = deviceWrapper.originalDevice;
    activeDevice = device;

    // Delegate to Provider
    await ChromecastProvider.play(device, mediaInfo);

    startStatusPolling();
    return { device: deviceName };
}

function pause() {
    if (activeDevice) ChromecastProvider.pause(activeDevice);
}

function resume() {
    if (activeDevice) ChromecastProvider.resume(activeDevice);
}

function stopCasting() {
    return new Promise(async (resolve) => {
        stopStatusPolling();

        if (activeDevice) {
            console.log('[CastManager] Stopping session...');
            await ChromecastProvider.stop(activeDevice);
            activeDevice = null;
        }
        resolve();
    });
}

function seek(seconds) {
    if (activeDevice) ChromecastProvider.seek(activeDevice, seconds);
}

function setVolume(level) {
    if (activeDevice) ChromecastProvider.setVolume(activeDevice, level);
}

// --- Status & State ---

function startStatusPolling() {
    stopStatusPolling();
    if (!activeDevice) return;

    statusInterval = setInterval(() => {
        if (!activeDevice) {
            stopStatusPolling();
            return;
        }

        ChromecastProvider.getStatus(activeDevice, (status) => {
            if (statusCallback) statusCallback(status);
        });
    }, 1000);
}

function stopStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
}

function onStatusUpdate(callback) {
    statusCallback = callback;
}

function getActiveDevice() {
    if (!activeDevice) return null;
    const devices = ChromecastProvider.getDevices();
    const match = devices.find(d => d.originalDevice === activeDevice);
    return match ? { name: match.name, type: 'chromecast' } : null;
}

function isCasting() {
    return activeDevice !== null;
}

async function cleanup() {
    console.log('[CastManager] Full cleanup...');
    stopDiscovery();
    await stopCasting();
    ChromecastProvider.cleanup();
}

module.exports = {
    startDiscovery,
    stopDiscovery,
    getDiscoveredDevices,
    playOnDevice,
    pause,
    resume,
    stopCasting,
    seek,
    setVolume,
    getActiveDevice,
    isCasting,
    cleanup,
    onStatusUpdate
};

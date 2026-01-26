/**
 * Cast Manager Module - Multi-Protocol
 * Orchestrator for Chromecast and DLNA devices.
 * Coordinates discovery and playback across both protocols.
 */
const ChromecastProvider = require('./cast/ChromecastProvider');
const DlnaProvider = require('./cast/DlnaProvider');

// --- State ---
let discoveryCallback = null;
let isDiscovering = false;
let activeDevice = null;
let activeDeviceType = null; // 'chromecast' or 'dlna'
let statusCallback = null;
let statusInterval = null;

// --- Discovery ---

/**
 * Start discovery using both ChromecastProvider and DlnaProvider
 * @param {function} onDeviceFound - Callback for UI
 * @param {string} localIp - Local IP for interface binding
 */
function startDiscovery(onDeviceFound, localIp) {
    if (isDiscovering) return;

    if (!localIp) console.warn('[CastManager] Warning: No Local IP provided via IPC');

    console.log(`[CastManager] Starting Multi-Protocol Discovery on interface: ${localIp || 'DEFAULT'}`);

    isDiscovering = true;
    discoveryCallback = onDeviceFound;

    // --- Chromecast Discovery ---
    ChromecastProvider.startDiscovery(localIp, (device) => {
        let displayName = device.name;

        // Generic Android TV Fix
        if (displayName.startsWith('AI-PONT-SA') || displayName.length > 20 || /^[a-f0-9]{12,}$/i.test(displayName)) {
            const original = device.originalDevice;
            if (original?.txtRecord?.fn) {
                displayName = original.txtRecord.fn;
            } else if (original?.fullname) {
                // Extract brand if present in fullname
                displayName = `Android TV (${original.fullname.split('.')[0] || 'Smart TV'})`;
            } else {
                displayName = 'Android TV';
            }
        }

        if (discoveryCallback) {
            const uniqueId = device.id;
            const uiName = `${displayName} [${uniqueId}]`;

            discoveryCallback({
                name: uiName,
                id: uniqueId,
                host: device.host,
                type: 'chromecast',
                originalDevice: device.originalDevice
            });
        }
    }, (err) => {
        console.error('[CastManager] Chromecast Discovery Error:', err);
    });

    // --- DLNA Discovery ---
    DlnaProvider.startDiscovery((device) => {
        if (discoveryCallback) {
            const uiName = `${device.name} [DLNA]`;

            discoveryCallback({
                name: uiName,
                id: device.id,
                host: device.host,
                type: 'dlna',
                originalDevice: device.originalDevice
            });
        }
    }, (err) => {
        console.error('[CastManager] DLNA Discovery Error:', err);
    });
}

function stopDiscovery() {
    isDiscovering = false;
    discoveryCallback = null;
    ChromecastProvider.stopDiscovery();
    DlnaProvider.stopDiscovery();
    console.log('[CastManager] All discovery stopped');
}

function getDiscoveredDevices() {
    const chromecastDevices = ChromecastProvider.getDevices();
    const dlnaDevices = DlnaProvider.getDevices();
    return [...chromecastDevices, ...dlnaDevices];
}

// --- Playback ---

async function playOnDevice(deviceName, mediaInfo) {
    console.log(`[CastManager] Requesting playback on ${deviceName}`);

    // Try Chromecast first
    let deviceWrapper = ChromecastProvider.getDevice(deviceName);
    let deviceType = 'chromecast';

    // Fallback to DLNA
    if (!deviceWrapper) {
        deviceWrapper = DlnaProvider.getDevice(deviceName);
        deviceType = 'dlna';
    }

    if (!deviceWrapper) throw new Error(`Device not found: ${deviceName}`);

    const device = deviceWrapper.originalDevice;
    activeDevice = device;
    activeDeviceType = deviceType;

    console.log(`[CastManager] Using ${deviceType} provider for playback`);

    // Delegate to appropriate provider
    if (deviceType === 'chromecast') {
        await ChromecastProvider.play(device, mediaInfo);
    } else {
        await DlnaProvider.play(device, mediaInfo);
    }

    startStatusPolling();
    return { device: deviceName, type: deviceType };
}

function pause() {
    if (!activeDevice) return;
    if (activeDeviceType === 'chromecast') {
        ChromecastProvider.pause(activeDevice);
    } else {
        DlnaProvider.pause(activeDevice);
    }
}

function resume() {
    if (!activeDevice) return;
    if (activeDeviceType === 'chromecast') {
        ChromecastProvider.resume(activeDevice);
    } else {
        DlnaProvider.resume(activeDevice);
    }
}

function stopCasting() {
    return new Promise(async (resolve) => {
        stopStatusPolling();

        if (activeDevice) {
            console.log(`[CastManager] Stopping ${activeDeviceType} session...`);
            if (activeDeviceType === 'chromecast') {
                await ChromecastProvider.stop(activeDevice);
            } else {
                await DlnaProvider.stop(activeDevice);
            }
            activeDevice = null;
            activeDeviceType = null;
        }
        resolve();
    });
}

function seek(seconds) {
    if (!activeDevice) return;
    if (activeDeviceType === 'chromecast') {
        ChromecastProvider.seek(activeDevice, seconds);
    } else {
        DlnaProvider.seek(activeDevice, seconds);
    }
}

function setVolume(level) {
    if (!activeDevice) return;
    if (activeDeviceType === 'chromecast') {
        ChromecastProvider.setVolume(activeDevice, level);
    } else {
        DlnaProvider.setVolume(activeDevice, level);
    }
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

        const statusHandler = (status) => {
            if (statusCallback) statusCallback(status);
        };

        if (activeDeviceType === 'chromecast') {
            ChromecastProvider.getStatus(activeDevice, statusHandler);
        } else {
            DlnaProvider.getStatus(activeDevice, statusHandler);
        }
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

    if (activeDeviceType === 'chromecast') {
        const devices = ChromecastProvider.getDevices();
        const match = devices.find(d => d.originalDevice === activeDevice);
        return match ? { name: match.name, type: 'chromecast' } : null;
    } else {
        const devices = DlnaProvider.getDevices();
        const match = devices.find(d => d.originalDevice === activeDevice);
        return match ? { name: match.name, type: 'dlna' } : null;
    }
}

function isCasting() {
    return activeDevice !== null;
}

async function cleanup() {
    console.log('[CastManager] Full cleanup...');
    stopDiscovery();
    await stopCasting();
    ChromecastProvider.cleanup();
    DlnaProvider.cleanup();
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

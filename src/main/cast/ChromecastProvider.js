const chromecasts = require('chromecasts');

const POLLING_INTERVAL_MS = 5000;
const DEVICE_TTL_MS = 60000;

let browser = null;
let initialized = false;
let discoveryCallback = null;
let errorCallback = null;
let isDiscovering = false;
let pollInterval = null;
let devices = new Map();

function init(localIp) {
    if (initialized) return;

    console.log(`[ChromecastProvider] Initializing on interface: ${localIp}`);
    browser = chromecasts({ interface: localIp });
    initialized = true;

    browser.on('update', (device) => {
        try {
            if (!device || !device.name) return;

            const deviceId = device.id || device.name;
            const existing = devices.get(deviceId);
            const isNew = !existing;
            const isIpChange = existing && existing.device.host !== device.host;

            if (isNew) console.log(`[Security] Device authenticated: ID=${deviceId}, Host=${device.host}`);
            else if (isIpChange) console.log(`[Security] Device IP changed: ID=${deviceId}, ${existing.device.host} -> ${device.host}`);

            devices.set(deviceId, { device, lastSeen: Date.now() });

            if (isDiscovering && discoveryCallback) {
                discoveryCallback({
                    name: device.name, host: device.host,
                    type: 'chromecast', id: deviceId, originalDevice: device
                });
            }
        } catch (err) {
            console.warn('[ChromecastProvider] Update handler error:', err.message);
        }
    });

    browser.on('error', (err) => {
        const ignorable = ['ECONNRESET', 'EPERM', 'ENOENT'];
        if (ignorable.some(code => err.code === code || err.message?.includes(code))) return;
        console.error('[ChromecastProvider] Browser error:', err);
        if (errorCallback) errorCallback(err);
    });
}

function startDiscovery(localIp, onDeviceFound, onError) {
    if (isDiscovering) return;

    init(localIp);

    console.log('[ChromecastProvider] Starting discovery...');
    isDiscovering = true;
    discoveryCallback = onDeviceFound;
    errorCallback = onError;

    browser.update();

    pollInterval = setInterval(() => {
        if (!isDiscovering) { clearInterval(pollInterval); pollInterval = null; return; }
        browser.update();
    }, POLLING_INTERVAL_MS);
}

function stopDiscovery() {
    console.log('[ChromecastProvider] Stopping discovery...');
    isDiscovering = false;
    discoveryCallback = null;
    errorCallback = null;

    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }

    if (browser) {
        try { browser.destroy(); } catch (e) { }
        browser = null;
        initialized = false;
        devices.clear();
    }
}

function pruneStaleDevices() {
    const now = Date.now();
    for (const [name, entry] of devices.entries()) {
        if (now - entry.lastSeen > DEVICE_TTL_MS) {
            console.log(`[ChromecastProvider] Device stale, removing: ${name}`);
            devices.delete(name);
        }
    }
}

function getDevices() {
    return Array.from(devices.values()).map(entry => ({
        name: entry.device.name, host: entry.device.host,
        type: 'chromecast', id: entry.device.id || entry.device.name,
        originalDevice: entry.device
    }));
}

function getDevice(identifier) {
    let entry = devices.get(identifier);

    if (!entry) {
        for (const [id, e] of devices) {
            if (e.device.name === identifier) { entry = e; break; }
        }
    }

    if (!entry) return null;
    return {
        name: entry.device.name, host: entry.device.host,
        type: 'chromecast', id: entry.device.id || entry.device.name,
        originalDevice: entry.device
    };
}

function play(device, mediaInfo) {
    return new Promise((resolve, reject) => {
        if (!device) return reject(new Error('No device provided'));

        try { device.removeAllListeners('status'); device.removeAllListeners('error'); } catch (e) { }
        device.on('error', (err) => console.error('[ChromecastProvider] Device error:', err));

        const options = {
            title: mediaInfo.title || 'Glass Cinema',
            type: 'video/mp4',
            images: mediaInfo.coverUrl ? [mediaInfo.coverUrl] : []
        };

        if (mediaInfo.subtitleUrl) {
            options.subtitles = [{
                trackId: 1, type: 'TEXT',
                trackContentId: mediaInfo.subtitleUrl,
                trackContentType: 'text/vtt',
                name: 'Spanish', language: 'es-ES', subtype: 'SUBTITLES'
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

function pause(device) {
    return new Promise(resolve => { if (!device) return resolve(); device.pause(() => resolve()); });
}

function resume(device) {
    return new Promise(resolve => { if (!device) return resolve(); device.resume(() => resolve()); });
}

function stop(device) {
    return new Promise((resolve) => {
        if (!device) return resolve();
        try {
            if (typeof device.stop === 'function') {
                device.stop(() => { try { device.removeAllListeners(); } catch (e) { } resolve(); });
            } else { resolve(); }
        } catch (err) {
            const ignorable = ['ECONNRESET', 'EPERM'];
            if (ignorable.some(code => err.code === code || err.message?.includes(code))) return resolve();
            console.error('[ChromecastProvider] Stop error:', err);
            resolve();
        }
    });
}

function seek(device, seconds) {
    return new Promise(resolve => { if (!device) return resolve(); device.seek(seconds, () => resolve()); });
}

function setVolume(device, level) {
    return new Promise(resolve => { if (!device) return resolve(); device.volume(level, () => resolve()); });
}

function getStatus(device, callback) {
    if (!device || typeof device.status !== 'function') return;
    device.status((err, status) => {
        if (err || !status || !callback) return;
        callback({
            currentTime: status.currentTime || 0,
            duration: status.media?.duration || 0,
            playerState: status.playerState || 'UNKNOWN',
            volume: status.volume?.level || 1,
            muted: status.volume?.muted || false
        });
    });
}

function cleanup() {
    stopDiscovery();
    if (browser) {
        try { browser.destroy(); } catch (e) { }
        browser = null;
        initialized = false;
    }
    devices.clear();
}

module.exports = {
    init, startDiscovery, stopDiscovery, getDevices, getDevice,
    play, pause, resume, stop, seek, setVolume, getStatus, cleanup,
    TYPE: 'chromecast'
};

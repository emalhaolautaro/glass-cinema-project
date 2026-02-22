const dlnacasts = require('dlnacasts');

const POLLING_INTERVAL_MS = 5000;
const DEVICE_TTL_MS = 60000;

let browser = null;
let initialized = false;
let discoveryCallback = null;
let errorCallback = null;
let isDiscovering = false;
let pollInterval = null;
let devices = new Map();

function init() {
    if (initialized) return;

    console.log('[DlnaProvider] Initializing...');

    try { browser = dlnacasts(); } catch (e) {
        console.error('[DlnaProvider] Init failed:', e);
        return;
    }

    initialized = true;

    browser.on('update', (device) => {
        console.log(`[DlnaProvider] update event: name=${device?.name}, host=${device?.host}`);
        if (!device || !device.name) return;
        registerDevice(device);
    });

    browser.on('error', (err) => {
        console.error('[DlnaProvider] Browser error:', err);
        if (errorCallback) errorCallback(err);
    });

    console.log(`[DlnaProvider] Browser ready, players: ${browser.players?.length || 0}`);
}

function registerDevice(device) {
    const deviceId = device.host || device.name;
    const isNew = !devices.has(deviceId);

    if (isNew) console.log(`[DlnaProvider] NEW device: ${device.name} (${device.host})`);

    devices.set(deviceId, { device, lastSeen: Date.now() });

    if (isDiscovering && discoveryCallback) {
        discoveryCallback({
            name: device.name, host: device.host,
            type: 'dlna', id: deviceId, originalDevice: device
        });
    }
}

function startDiscovery(onDeviceFound, onError) {
    if (isDiscovering) return;
    init();
    if (!browser) { console.error('[DlnaProvider] No browser, cannot discover'); return; }

    console.log('[DlnaProvider] Starting discovery...');
    isDiscovering = true;
    discoveryCallback = onDeviceFound;
    errorCallback = onError;

    console.log('[DlnaProvider] Sending M-SEARCH for MediaRenderer:1...');
    browser.update();

    pollInterval = setInterval(() => {
        if (!isDiscovering) { clearInterval(pollInterval); pollInterval = null; return; }
        browser.update();
        pruneStaleDevices();
    }, POLLING_INTERVAL_MS);
}

function stopDiscovery() {
    isDiscovering = false;
    discoveryCallback = null;
    errorCallback = null;

    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }

    if (browser) {
        try { browser.destroy(); } catch (e) { }
        browser = null;
        initialized = false;
    }

    devices.clear();
}

function pruneStaleDevices() {
    const now = Date.now();
    for (const [id, entry] of devices.entries()) {
        if (now - entry.lastSeen > DEVICE_TTL_MS) {
            console.log(`[DlnaProvider] Stale, removing: ${entry.device.name}`);
            devices.delete(id);
        }
    }
}

function getDevices() {
    return Array.from(devices.values()).map(e => ({
        name: e.device.name, host: e.device.host,
        type: 'dlna', id: e.device.host || e.device.name,
        originalDevice: e.device
    }));
}

function getDevice(identifier) {
    let entry = devices.get(identifier);
    if (!entry) {
        for (const [id, e] of devices) { if (e.device.name === identifier) { entry = e; break; } }
    }
    if (!entry) return null;
    return {
        name: entry.device.name, host: entry.device.host,
        type: 'dlna', id: entry.device.host || entry.device.name,
        originalDevice: entry.device
    };
}

function play(device, mediaInfo) {
    return new Promise((resolve, reject) => {
        if (!device) return reject(new Error('No device'));
        const options = { title: mediaInfo.title || 'Glass Cinema', type: 'video/mp4' };
        if (mediaInfo.subtitleUrl) options.subtitles = [mediaInfo.subtitleUrl];
        device.play(mediaInfo.url, options, (err, status) => {
            if (err) return reject(err);
            console.log(`[DlnaProvider] Playing on ${device.name}`);
            resolve({ device, status });
        });
    });
}

function pause(device) { return new Promise(r => { if (!device?.pause) return r(); device.pause(() => r()); }); }
function resume(device) { return new Promise(r => { if (!device?.resume) return r(); device.resume(() => r()); }); }
function seek(device, s) { return new Promise(r => { if (!device?.seek) return r(); device.seek(s, () => r()); }); }
function setVolume(device, l) { return new Promise(r => { if (!device?.volume) return r(); device.volume(l, () => r()); }); }

function stop(device) {
    return new Promise(resolve => {
        if (!device) return resolve();
        try { if (typeof device.stop === 'function') device.stop(() => resolve()); else resolve(); }
        catch (e) { console.error('[DlnaProvider] Stop error:', e); resolve(); }
    });
}

function getStatus(device, callback) {
    if (!device || typeof device.status !== 'function') { if (callback) callback({ playerState: 'UNKNOWN' }); return; }
    device.status((err, status) => {
        if (err || !status) { if (callback) callback({ playerState: 'UNKNOWN' }); return; }
        callback({
            currentTime: status.currentTime || 0, duration: status.duration || 0,
            playerState: status.playerState || 'UNKNOWN', volume: status.volume || 1, muted: false
        });
    });
}

function cleanup() { stopDiscovery(); }

module.exports = {
    init, startDiscovery, stopDiscovery, getDevices, getDevice,
    play, pause, resume, stop, seek, setVolume, getStatus, cleanup,
    TYPE: 'dlna'
};

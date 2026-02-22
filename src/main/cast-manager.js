const ChromecastProvider = require('./cast/ChromecastProvider');
const DlnaProvider = require('./cast/DlnaProvider');

let discoveryCallback = null;
let isDiscovering = false;
let activeDevice = null;
let activeDeviceType = null;
let statusCallback = null;
let statusInterval = null;

function startDiscovery(onDeviceFound, localIp) {
    if (isDiscovering) return;
    if (!localIp) console.warn('[CastManager] No Local IP provided');

    console.log(`[CastManager] Starting discovery on: ${localIp || 'DEFAULT'}`);
    isDiscovering = true;
    discoveryCallback = onDeviceFound;

    ChromecastProvider.startDiscovery(localIp, (device) => {
        let displayName = device.name;

        if (displayName.startsWith('AI-PONT-SA') || displayName.length > 20 || /^[a-f0-9]{12,}$/i.test(displayName)) {
            const original = device.originalDevice;
            if (original?.txtRecord?.fn) displayName = original.txtRecord.fn;
            else if (original?.fullname) displayName = `Android TV (${original.fullname.split('.')[0] || 'Smart TV'})`;
            else displayName = 'Android TV';
        }

        if (discoveryCallback) {
            discoveryCallback({
                name: `${displayName} [${device.id}]`, id: device.id,
                host: device.host, type: 'chromecast', originalDevice: device.originalDevice
            });
        }
    }, (err) => console.error('[CastManager] Chromecast error:', err));

    DlnaProvider.startDiscovery((device) => {
        if (discoveryCallback) {
            discoveryCallback({
                name: `${device.name} [DLNA]`, id: device.id,
                host: device.host, type: 'dlna', originalDevice: device.originalDevice
            });
        }
    }, (err) => console.error('[CastManager] DLNA error:', err));
}

function stopDiscovery() {
    isDiscovering = false;
    discoveryCallback = null;
    ChromecastProvider.stopDiscovery();
    DlnaProvider.stopDiscovery();
}

function getDiscoveredDevices() {
    return [...ChromecastProvider.getDevices(), ...DlnaProvider.getDevices()];
}

function extractDeviceId(uiName) {
    const match = uiName.match(/\[([^\]]+)\]$/);
    if (match) {
        if (match[1] === 'DLNA') return uiName.replace(/\s*\[DLNA\]$/, '');
        return match[1];
    }
    return uiName;
}

async function playOnDevice(deviceName, mediaInfo) {
    console.log(`[CastManager] Play on ${deviceName}`);
    const deviceId = extractDeviceId(deviceName);

    let deviceWrapper = ChromecastProvider.getDevice(deviceId);
    let deviceType = 'chromecast';

    if (!deviceWrapper) {
        deviceWrapper = DlnaProvider.getDevice(deviceId);
        deviceType = 'dlna';
    }

    if (!deviceWrapper) throw new Error(`Device not found: ${deviceName} (ID: ${deviceId})`);

    activeDevice = deviceWrapper.originalDevice;
    activeDeviceType = deviceType;

    if (deviceType === 'chromecast') await ChromecastProvider.play(activeDevice, mediaInfo);
    else await DlnaProvider.play(activeDevice, mediaInfo);

    startStatusPolling();
    return { device: deviceName, type: deviceType };
}

function dispatchToProvider(method, ...args) {
    if (!activeDevice) return;
    const provider = activeDeviceType === 'chromecast' ? ChromecastProvider : DlnaProvider;
    provider[method](activeDevice, ...args);
}

function pause() { dispatchToProvider('pause'); }
function resume() { dispatchToProvider('resume'); }
function seek(seconds) { dispatchToProvider('seek', seconds); }
function setVolume(level) { dispatchToProvider('setVolume', level); }

async function stopCasting() {
    stopStatusPolling();
    if (activeDevice) {
        console.log(`[CastManager] Stopping ${activeDeviceType} session`);
        const provider = activeDeviceType === 'chromecast' ? ChromecastProvider : DlnaProvider;
        await provider.stop(activeDevice);
        activeDevice = null;
        activeDeviceType = null;
    }
}

function startStatusPolling() {
    stopStatusPolling();
    if (!activeDevice) return;
    statusInterval = setInterval(() => {
        if (!activeDevice) { stopStatusPolling(); return; }
        const provider = activeDeviceType === 'chromecast' ? ChromecastProvider : DlnaProvider;
        provider.getStatus(activeDevice, (status) => { if (statusCallback) statusCallback(status); });
    }, 1000);
}

function stopStatusPolling() {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
}

function onStatusUpdate(callback) { statusCallback = callback; }

function getActiveDevice() {
    if (!activeDevice) return null;
    const provider = activeDeviceType === 'chromecast' ? ChromecastProvider : DlnaProvider;
    const match = provider.getDevices().find(d => d.originalDevice === activeDevice);
    return match ? { name: match.name, type: activeDeviceType } : null;
}

function isCasting() { return activeDevice !== null; }

async function cleanup() {
    stopDiscovery();
    await stopCasting();
    ChromecastProvider.cleanup();
    DlnaProvider.cleanup();
}

module.exports = {
    startDiscovery, stopDiscovery, getDiscoveredDevices, playOnDevice,
    pause, resume, stopCasting, seek, setVolume, getActiveDevice,
    isCasting, cleanup, onStatusUpdate
};

const { ipcMain } = require('electron');
const streaming = require('../streaming');
const castManager = require('../cast-manager');
const subtitles = require('../subtitles');
const networkUtils = require('../network-utils');

function register() {
    ipcMain.on('request-cast-discovery', (event) => {
        const localIp = networkUtils.getLocalIP();
        try {
            castManager.startDiscovery((device) => {
                event.reply('cast-device-found', {
                    name: device.name, host: device.host,
                    type: device.type, id: device.id
                });
            }, localIp);
        } catch (err) {
            console.error('[IPC:Cast] Discovery error:', err);
        }
    });

    ipcMain.on('stop-cast-discovery', () => {
        if (castManager && typeof castManager.stopDiscovery === 'function') castManager.stopDiscovery();
    });

    ipcMain.handle('get-cast-devices', () => castManager.getDiscoveredDevices());

    ipcMain.on('cast-device-selected', async (event, { deviceName, movieInfo }) => {
        console.log(`[IPC:Cast] Cast flow start -> ${deviceName}`);
        try {
            event.reply('cast-mute-local');
            await new Promise(res => setTimeout(res, 100));

            streaming.setCastMode(true);

            const localIp = networkUtils.getLocalIP();
            const streamUrl = await streaming.rebindServerForCast(localIp);

            if (!streamUrl) throw new Error('No hay stream activo. Iniciá la reproducción antes de transmitir.');
            if (streamUrl.includes('127.0.0.1')) throw new Error('Error de red: El servidor sigue en localhost.');

            let subtitleUrl = null;
            subtitles.stopSubtitleServer();
            if (movieInfo?.subtitleDownloadUrl) {
                try { subtitleUrl = await subtitles.prepareSubtitlesForCast(movieInfo.subtitleDownloadUrl); }
                catch (subErr) { console.error('[IPC:Cast] Subtitle error:', subErr); }
            }

            castManager.onStatusUpdate((status) => { try { event.reply('cast-status', status); } catch (e) { } });

            await castManager.playOnDevice(deviceName, {
                url: streamUrl,
                title: movieInfo?.title || 'Glass Cinema',
                coverUrl: movieInfo?.coverUrl || null,
                subtitleUrl
            });

            event.reply('cast-connected', deviceName);
            console.log('[IPC:Cast] Cast success');
        } catch (error) {
            console.error('[IPC:Cast] Cast failed:', error.message);
            event.reply('cast-error', error.message);
            streaming.setCastMode(false);
            castManager.onStatusUpdate(null);
            subtitles.stopSubtitleServer();
        }
    });

    ipcMain.on('stop-casting', async (event) => {
        try {
            await castManager.stopCasting();
            await streaming.fullCleanup();
            event.reply('cast-stopped');
        } catch (error) {
            try { await streaming.fullCleanup(); } catch (e) { }
            event.reply('cast-stopped');
        }
    });

    ipcMain.on('cast-pause', () => castManager.pause());
    ipcMain.on('cast-resume', () => castManager.resume());
    ipcMain.on('cast-seek', (event, seconds) => castManager.seek(seconds));
    ipcMain.on('cast-volume', (event, level) => castManager.setVolume(level));
    ipcMain.handle('is-casting', () => castManager.isCasting());
    ipcMain.handle('get-active-cast-device', () => castManager.getActiveDevice());
}

module.exports = { register };

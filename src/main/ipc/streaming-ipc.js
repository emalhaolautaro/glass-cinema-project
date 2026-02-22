const { ipcMain } = require('electron');
const streaming = require('../streaming');

function register() {
    ipcMain.on('start-stream', (event, magnet) => {
        streaming.startStream(
            magnet,
            (url, subtitleUrl) => {
                event.reply('stream-ready', url);
                if (subtitleUrl) event.reply('load-local-subtitle', subtitleUrl);
            },
            (stats) => event.reply('download-progress', stats)
        );
    });

    ipcMain.handle('play-local', (event, infoHash) => {
        return new Promise((resolve) => {
            streaming.serveLocalFolder(infoHash, (videoUrl, subtitleUrl) => {
                resolve({ videoUrl, subtitleUrl });
            });
        });
    });

    ipcMain.on('stop-stream', () => {
        console.log('[IPC:Stream] Stopping stream');
        streaming.fullCleanup().catch(err => console.error('[IPC:Stream] Stop error:', err));
    });
}

module.exports = { register };

const { ipcMain } = require('electron');
const streaming = require('../streaming');
const storeManager = require('../store-manager');

function register(getMainWindow) {
    ipcMain.on('start-download', (event, { movie, subtitleUrl }) => {
        streaming.startDownload(
            movie, subtitleUrl,
            (infoHash, percentage, stats) => {
                const w = getMainWindow();
                if (w && !w.isDestroyed()) w.webContents.send('download-progress', { infoHash, percentage, stats });
            },
            (localPath) => {
                const w = getMainWindow();
                if (w && !w.isDestroyed()) w.webContents.send('download-complete', { infoHash: movie.infoHash, localPath });
            }
        ).catch(err => console.error('[IPC:Download] Error:', err));
    });

    ipcMain.handle('get-downloads', () => storeManager.getAllDownloads());

    ipcMain.handle('remove-download', (event, infoHash) => {
        storeManager.removeDownload(infoHash);
        streaming.removeDownloadFile(infoHash);
        return true;
    });

    ipcMain.handle('cancel-download', (event, infoHash) => streaming.cancelDownload(infoHash));

    ipcMain.handle('check-download-status', (event, infoHash) => {
        const active = streaming.getActiveDownloads()[infoHash];
        const stored = storeManager.getAllDownloads().find(d => d.infoHash === infoHash);
        return {
            isDownloading: !!active,
            progress: active ? Math.round(active.progress * 100) : 0,
            isDownloaded: !!stored
        };
    });
}

module.exports = { register };

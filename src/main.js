const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

const streaming = require('./main/streaming');
const subtitles = require('./main/subtitles');
const castManager = require('./main/cast-manager');
const storeManager = require('./main/store-manager');
const networkUtils = require('./main/network-utils');
const { DATA_ROOT } = require('./main/paths');

const streamingIPC = require('./main/ipc/streaming-ipc');
const castIPC = require('./main/ipc/cast-ipc');
const downloadIPC = require('./main/ipc/download-ipc');
const storeIPC = require('./main/ipc/store-ipc');

let mainWindow = null;

function createWindow() {
    const isDev = process.env.NODE_ENV === 'development';

    const win = new BrowserWindow({
        width: 1000, height: 700, frame: false, transparent: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: true
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    if (isDev) {
        win.webContents.openDevTools({ mode: 'detach' });
        console.log('[Main] Development mode');
    }

    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') win.webContents.toggleDevTools();
    });

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const localIp = networkUtils.getLocalIP();
        const streamPort = process.env.STREAM_PORT || 62182;
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    `default-src 'self'; ` +
                    `script-src 'self'; ` +
                    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
                    `img-src 'self' static: data: blob: https:; ` +
                    `font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; ` +
                    `media-src 'self' blob: http://localhost:* http://127.0.0.1:* http://localhost:${streamPort} http://${localIp}:*; ` +
                    `connect-src 'self' ${process.env.MOVIE_API_URL || ''} https://yts.mx https://yts.bz ${process.env.SUBTITLES_API_URL || 'https://yifysubtitles.ch'} https://api.themoviedb.org http://localhost:* http://127.0.0.1:* http://${localIp}:* ws://localhost:* ws://127.0.0.1:*`
                ]
            }
        });
    });

    ipcMain.on('app-close', async () => {
        win.hide();
        try { await streaming.fullCleanup(); await castManager.cleanup(); subtitles.clearSubtitles(); } catch (e) { }
        setTimeout(() => app.exit(0), 1000);
    });
    ipcMain.on('app-minimize', () => win.minimize());
    ipcMain.on('app-maximize', () => { win.isMaximized() ? win.unmaximize() : win.maximize(); });

    return win;
}

app.whenReady().then(() => {
    console.log('[Main] Data root:', DATA_ROOT);
    storeManager.init();
    mainWindow = createWindow();

    streamingIPC.register();
    castIPC.register();
    downloadIPC.register(() => mainWindow);
    storeIPC.register();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let isQuitting = false;
app.on('before-quit', async (e) => {
    if (isQuitting) return;
    e.preventDefault();
    isQuitting = true;
    try { await streaming.fullCleanup(); await castManager.cleanup(); subtitles.clearSubtitles(); } catch (err) { }
    app.exit(0);
});

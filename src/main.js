const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
// FIX: Correct path to .env (one directory up from src/)
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// --- Global Error Handling ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION] at:', promise);
    console.error('[UNHANDLED REJECTION] reason:', reason);
    if (reason?.stack) {
        console.error('[UNHANDLED REJECTION] stack:', reason.stack);
    }
});

process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    if (error?.stack) {
        console.error('[UNCAUGHT EXCEPTION] stack:', error.stack);
    }
});

// Import modules
const streaming = require('./main/streaming');
const subtitles = require('./main/subtitles');
const castManager = require('./main/cast-manager');

const storeManager = require('./main/store-manager');
const networkUtils = require('./main/network-utils');
const { DATA_ROOT } = require('./main/paths');

// --- Window Creation ---
function createWindow() {
    const isDev = process.env.NODE_ENV === 'development';

    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false,
        transparent: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    // Open DevTools logic based on NODE_ENV
    if (isDev) {
        win.webContents.openDevTools({ mode: 'detach' });
        console.log('[Main] Running in DEVELOPMENT mode - DevTools enabled');
    } else {
        console.log('[Main] Running in PRODUCTION mode');
    }

    // F12 to toggle DevTools
    win.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
            win.webContents.toggleDevTools();
        }
    });

    // Secure CSP with localhost support for WebTorrent server
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const localIp = networkUtils.getLocalIP();
        const networkTarget = `http://${localIp}:*`;
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
                    // NOTE: networkTarget added for Cast visibility
                    `media-src 'self' blob: http://localhost:* http://127.0.0.1:* http://localhost:${streamPort} ${networkTarget}; ` +
                    `connect-src 'self' ${process.env.MOVIE_API_URL || ''} https://yts.mx https://yts.bz ${process.env.SUBTITLES_API_URL || 'https://yifysubtitles.ch'} https://api.themoviedb.org http://localhost:* http://127.0.0.1:* ${networkTarget} ws://localhost:* ws://127.0.0.1:*`
                ]
            }
        });
    });

    // Window Controls
    ipcMain.on('app-close', async () => {
        // UX: Instantly hide window so user feels it closed
        win.hide();

        try {
            await streaming.fullCleanup();
            await castManager.cleanup();
            subtitles.clearSubtitles();
        } catch (e) {
            console.error('[Main] Close cleanup error:', e);
        }

        // Safety Drain: Wait 1s for pending sockets/GC before killing process
        setTimeout(() => {
            app.exit(0);
        }, 1000);
    });
    ipcMain.on('app-minimize', () => win.minimize());
    ipcMain.on('app-maximize', () => {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    });

    return win;
}

// --- App Lifecycle ---
let mainWindow = null;

app.whenReady().then(() => {
    console.log('[Higiene] Sistema de AppData eliminado. Ahora operando en modo portátil en: ' + DATA_ROOT);

    // Initialize Store
    storeManager.init();

    mainWindow = createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let isQuitting = false;
app.on('before-quit', async (e) => {
    if (isQuitting) return;

    e.preventDefault();
    isQuitting = true;

    console.log('[App] Quitting - running cleanup...');

    // Run cleanup
    try {
        await streaming.fullCleanup();
        await castManager.cleanup();
        subtitles.clearSubtitles();
    } catch (err) {
        console.error('[App] Cleanup error:', err);
    }

    console.log('[App] Cleanup finished. Exiting.');
    app.exit(0);
});

// --- IPC Handlers ---
ipcMain.handle('get-env', (event, key) => {
    return process.env[key];
});

ipcMain.handle('get-local-ip', () => {
    return networkUtils.getLocalIP();
});

ipcMain.on('start-stream', (event, magnet) => {
    streaming.startStream(
        magnet,
        (url, subtitleUrl) => {
            event.reply('stream-ready', url);
            if (subtitleUrl) {
                console.log('[Main] Found local subtitle:', subtitleUrl);
                event.reply('load-local-subtitle', subtitleUrl);
            }
        },
        (stats) => event.reply('download-progress', stats)
    );
});

ipcMain.on('stop-stream', () => {
    console.log('[Main] Stopping stream requested by renderer');
    streaming.fullCleanup().catch(err => console.error('[Main] Stop stream error:', err));
});

// Subtitle Handlers
ipcMain.handle('fetch-movie-subs', async (event, imdbId) => {
    return await subtitles.getAvailableSubtitles(imdbId);
});

ipcMain.handle('load-selected-sub', async (event, pageUrl) => {
    return await subtitles.downloadSubtitle(pageUrl);
});

ipcMain.on('clear-subtitles', () => {
    subtitles.clearSubtitles();
});

// --- Metadata Cache IPC ---
ipcMain.handle('get-metadata', (event, imdbId) => {
    return storeManager.getMetadata(imdbId);
});

ipcMain.on('save-metadata', (event, { imdbId, data }) => {
    storeManager.saveMetadata(imdbId, data);
});

// --- Chromecast IPC Handlers ---

// Start device discovery
ipcMain.on('request-cast-discovery', (event) => {
    const localIp = networkUtils.getLocalIP();
    console.log(`[Main] Discovery requested on interface: ${localIp}`);

    try {
        castManager.startDiscovery((device) => {
            const safeDevice = {
                name: device.name,
                host: device.host,
                type: device.type,
                id: device.id // Included for UI unique ID display
            };
            event.reply('cast-device-found', safeDevice);
        }, localIp);
    } catch (err) {
        console.error('[Main] Error en descubrimiento:', err);
    }
});

// Stop device discovery
ipcMain.on('stop-cast-discovery', () => {
    console.log('[Main] Stopping cast discovery');
    if (castManager && typeof castManager.stopDiscovery === 'function') {
        castManager.stopDiscovery();
    } else {
        console.error('[Main] ERROR: castManager.stopDiscovery is not a function!', castManager);
    }
});

// Get all discovered devices
ipcMain.handle('get-cast-devices', () => {
    return castManager.getDiscoveredDevices();
});

// Cast to selected device
ipcMain.on('cast-device-selected', async (event, { deviceName, movieInfo }) => {
    console.log(`[Main] ====== CAST FLOW START ======`);
    console.log(`[Main] Target device: ${deviceName}`);

    try {
        // STEP 1: Signal renderer to mute
        console.log('[Main] Step 1: Signaling renderer to mute local video...');
        event.reply('cast-mute-local');
        await new Promise(res => setTimeout(res, 100));

        // STEP 2: Enable cast mode
        console.log('[Main] Step 2: Enabling cast mode...');
        streaming.setCastMode(true);

        // STEP 3: Rebind server to 0.0.0.0
        const localIp = networkUtils.getLocalIP();
        console.log(`[Main] Forzando bindeo de servidor a: ${localIp}`);

        const streamUrl = await streaming.rebindServerForCast(localIp);

        if (streamUrl && streamUrl.includes('127.0.0.1')) {
            throw new Error('Error de red: El servidor sigue en localhost. La TV no podrá verlo.');
        }

        // STEP 4: Prepare subtitles
        let subtitleUrl = null;
        if (movieInfo?.subtitleDownloadUrl) {
            console.log('[Main] Step 4: Preparing subtitles for cast...');
            try {
                subtitleUrl = await subtitles.prepareSubtitlesForCast(movieInfo.subtitleDownloadUrl);
                if (subtitleUrl) {
                    console.log(`[Main] Subtitle server URL ready: ${subtitleUrl}`);
                }
            } catch (subErr) {
                console.error('[Main] Subtitle preparation failed:', subErr);
            }
        } else {
            console.log('[Main] Step 4: No subtitles selected for cast');
        }

        // STEP 5: Register status callback
        console.log('[Main] Step 5: Registering status callback...');
        castManager.onStatusUpdate((status) => {
            try {
                event.reply('cast-status', status);
            } catch (e) { }
        });

        // STEP 6: Play on Chromecast
        console.log('[Main] Step 6: Sending to Chromecast...');
        await castManager.playOnDevice(deviceName, {
            url: streamUrl,
            title: movieInfo?.title || 'Glass Cinema',
            coverUrl: movieInfo?.coverUrl || null,
            subtitleUrl: subtitleUrl
        });

        event.reply('cast-connected', deviceName);
        console.log(`[Main] ====== CAST SUCCESS: ${deviceName} ======`);

    } catch (error) {
        console.error('[Main] ====== CAST FAILED ======');
        console.error('[Main] Error:', error.message);
        event.reply('cast-error', error.message);
        streaming.setCastMode(false);
        castManager.onStatusUpdate(null);
        subtitles.stopSubtitleServer();
    }
});

// Stop casting
ipcMain.on('stop-casting', async (event) => {
    console.log('[Main] Stopping cast session with full cleanup');

    try {
        await castManager.stopCasting();
        await streaming.fullCleanup();
        event.reply('cast-stopped');
        console.log('[Main] Cast stopped and cleaned up');
    } catch (error) {
        console.error('[Main] Stop cast error:', error);
        try { await streaming.fullCleanup(); } catch (e) { }
        event.reply('cast-stopped');
    }
});

// Cast controls
ipcMain.on('cast-pause', () => castManager.pause());
ipcMain.on('cast-resume', () => castManager.resume());
ipcMain.on('cast-seek', (event, seconds) => castManager.seek(seconds));
ipcMain.on('cast-volume', (event, level) => castManager.setVolume(level));

ipcMain.handle('is-casting', () => castManager.isCasting());
ipcMain.handle('get-active-cast-device', () => castManager.getActiveDevice());

// --- Store Handlers ---
ipcMain.handle('store-toggle-favorite', (event, movie) => storeManager.toggleFavorite(movie));
ipcMain.handle('store-toggle-watchlist', (event, movie) => storeManager.toggleWatchlist(movie));
ipcMain.handle('store-get-library', async () => storeManager.getLibrary());
ipcMain.handle('store-check-status', (event, movie) => storeManager.checkStatus(movie));

// --- Download Handlers ---
ipcMain.on('start-download', (event, { movie, subtitleUrl }) => {
    console.log('[Main] Start download requested:', movie.title);
    streaming.startDownload(
        movie,
        subtitleUrl,
        (infoHash, percentage, stats) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-progress', { infoHash, percentage, stats });
            }
        },
        (localPath) => {
            console.log('[Main] Download finished:', localPath);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-complete', { infoHash: movie.infoHash, localPath });
            }
        }
    ).catch(err => {
        console.error('[Main] Start download error:', err);
    });
});

ipcMain.handle('get-downloads', () => storeManager.getAllDownloads());

ipcMain.handle('remove-download', (event, infoHash) => {
    storeManager.removeDownload(infoHash);
    streaming.removeDownloadFile(infoHash);
    return true;
});

ipcMain.handle('cancel-download', (event, infoHash) => {
    return streaming.cancelDownload(infoHash);
});

ipcMain.handle('check-download-status', (event, infoHash) => {
    const active = streaming.getActiveDownloads()[infoHash];
    const stored = storeManager.getAllDownloads().find(d => d.infoHash === infoHash);

    return {
        isDownloading: !!active,
        progress: active ? Math.round(active.progress * 100) : 0,
        isDownloaded: !!stored
    };
});

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { CACHE_DIR } = require('../paths');

const torrentManager = require('./TorrentManager');
const mediaServer = require('./MediaServer');
const castServer = require('./CastServer');
const localFolder = require('./LocalFolder');
const downloadManager = require('./DownloadManager');

let isClean = true;
let isShuttingDown = false;
let cleanupPromise = null;
let progressInterval = null;

function registerExitHandlers() {
    const cleanup = () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        torrentManager.destroySync();
        mediaServer.destroySync();
    };
    process.on('exit', cleanup);
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    app.on('before-quit', cleanup);
    app.on('will-quit', cleanup);
}
registerExitHandlers();

async function startStream(magnet, onReady, onProgress) {
    console.log('[Streaming] Starting stream...');
    isShuttingDown = false;

    if (mediaServer.hasActiveServer() || torrentManager.getClient()) {
        console.log('[Streaming] Cleaning up previous session...');
        await forceCleanup();
    }

    isClean = false;

    try {
        const result = await torrentManager.addTorrent(magnet);

        if (result.isLocal) {
            mediaServer.serveLocalFile(result.localFilePath, (url, subtitleUrl) => {
                if (onReady) onReady(url, subtitleUrl);
            });
            return;
        }

        const { torrent, fileIndex, fileName } = result;

        mediaServer.serveTorrent(torrent, fileIndex, fileName, {
            onReady: (url) => { if (onReady) onReady(url); }
        });

        if (onProgress) {
            if (progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(() => {
                const stats = torrentManager.getProgress();
                if (!stats) { clearInterval(progressInterval); progressInterval = null; return; }
                onProgress(stats);
            }, 1000);
        }
    } catch (err) {
        console.error('[Streaming] Error starting stream:', err);
        isClean = true;
    }
}

function rebindServerForCast(localIp) {
    return castServer.rebindForCast(localIp, torrentManager);
}

function serveLocalFolder(infoHash, onReady) {
    isClean = false;
    return localFolder.serveLocalFolder(infoHash, onReady, mediaServer.isCastModeEnabled());
}

async function forceCleanup() {
    console.log('[Streaming] FORCE CLEANUP starting...');
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

    await Promise.race([
        Promise.all([mediaServer.destroy(), torrentManager.destroy()]),
        new Promise(res => setTimeout(res, 5000))
    ]);

    torrentManager.resetState();
    mediaServer.resetState();
    isClean = true;
    cleanupPromise = null;
    console.log('[Streaming] FORCE CLEANUP complete');
}

async function fullCleanup() {
    if (isClean) { console.log('[Streaming] Already clean'); return; }
    if (cleanupPromise) { console.log('[Streaming] Cleanup in progress, joining...'); return cleanupPromise; }

    cleanupPromise = (async () => {
        await forceCleanup();
        await new Promise(res => setTimeout(res, 500));
        cleanCache();
        console.log('[Streaming] Full cleanup done');
    })();
    return cleanupPromise;
}

function cleanCache() {
    if (fs.existsSync(CACHE_DIR)) {
        try { fs.rmSync(CACHE_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); console.log('[Streaming] Cache deleted'); }
        catch (e) { console.warn('[Streaming] Cache delete failed:', e.message); }
    }
    const userData = app.getPath('userData');
    ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache', 'Service Worker', 'VideoDecodeStats']
        .forEach(folder => {
            const p = path.join(userData, folder);
            if (fs.existsSync(p)) {
                try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
            }
        });
}

function setCastMode(enabled) { return mediaServer.setCastMode(enabled); }
function isCastModeEnabled() { return mediaServer.isCastModeEnabled(); }
function getStreamUrl() { return mediaServer.getStreamUrl(torrentManager.getActiveFileIndex(), torrentManager.getActiveFileName()); }

const { startDownload, cancelDownload, removeDownloadFile, getActiveDownloads } = downloadManager;

module.exports = {
    startStream, startDownload, getActiveDownloads, cancelDownload,
    removeDownloadFile, forceCleanup, fullCleanup, cleanCache,
    setCastMode, isCastModeEnabled, getStreamUrl, rebindServerForCast,
    CACHE_DIR, serveLocalFolder
};

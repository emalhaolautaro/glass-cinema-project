const WebTorrent = require('webtorrent');
const path = require('path');
const fs = require('fs');
const https = require('https');
const subtitles = require('../subtitles');
const storeManager = require('../store-manager');
const { DOWNLOADS_DIR } = require('../paths');

let downloadClient = null;
let activeDownloads = new Map();

async function startDownload(movie, subtitleUrl, onProgress, onComplete) {
    const infoHash = movie.infoHash;
    console.log(`[Downloads] Starting: ${movie.title} (${infoHash})`);

    if (!downloadClient) { downloadClient = new WebTorrent(); }
    if (activeDownloads.has(infoHash)) { console.log('[Downloads] Already downloading'); return; }

    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });

    if (movie.coverUrl) {
        const file = fs.createWriteStream(path.join(downloadPath, 'poster.jpg'));
        https.get(movie.coverUrl, (res) => res.pipe(file)).on('error', (e) => console.error('[Downloads] Poster error:', e));
    }

    if (subtitleUrl) {
        try {
            const srtContent = await subtitles.downloadSubtitle(subtitleUrl);
            fs.writeFileSync(path.join(downloadPath, 'subtitles.srt'), srtContent);
            fs.writeFileSync(path.join(downloadPath, 'subtitles.vtt'), subtitles.srtToVtt(srtContent));
            console.log('[Downloads] Subtitles saved');
        } catch (err) {
            console.error('[Downloads] Subtitle error:', err);
        }
    }

    try {
        fs.writeFileSync(path.join(downloadPath, 'metadata.json'), JSON.stringify(movie, null, 2));
    } catch (err) {
        console.error('[Downloads] Metadata error:', err);
    }

    const magnet = movie.magnet || `magnet:?xt=urn:btih:${infoHash}`;

    downloadClient.add(magnet, { path: downloadPath }, (torrent) => {
        console.log(`[Downloads] Torrent added: ${torrent.infoHash}`);
        torrent.files.forEach(f => f.select());
        activeDownloads.set(infoHash, { torrent, title: movie.title });

        const interval = setInterval(() => {
            if (torrent.destroyed) { clearInterval(interval); return; }

            const stats = {
                progress: torrent.progress,
                downloadSpeed: torrent.downloadSpeed,
                downloaded: torrent.downloaded,
                total: torrent.length,
                timeRemaining: torrent.timeRemaining
            };

            if (onProgress) onProgress(infoHash, Math.round(torrent.progress * 100), stats);

            if (torrent.progress === 1) {
                console.log(`[Downloads] Complete: ${movie.title}`);
                clearInterval(interval);
                finalizeDownload(torrent, movie, downloadPath, onComplete, infoHash);
            }
        }, 1000);

        torrent.on('error', (err) => {
            console.error('[Downloads] Torrent error:', err);
            activeDownloads.delete(infoHash);
            clearInterval(interval);
        });
    });
}

function finalizeDownload(torrent, movie, downloadPath, onComplete, infoHash) {
    let mainFile = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
    const originalPath = path.join(downloadPath, mainFile.path);
    const finalPath = path.join(downloadPath, 'video.mp4');

    torrent.destroy(() => {
        console.log('[Downloads] Torrent destroyed, releasing locks');
        activeDownloads.delete(infoHash);

        setTimeout(() => {
            try {
                if (fs.existsSync(originalPath)) {
                    if (path.resolve(originalPath) !== path.resolve(finalPath)) {
                        fs.renameSync(originalPath, finalPath);
                        console.log('[Downloads] File renamed to video.mp4');
                    }
                } else if (!fs.existsSync(finalPath)) {
                    console.error('[Downloads] CRITICAL: No video file found');
                    return;
                }
                storeManager.addDownload(movie, finalPath);
                if (onComplete) onComplete(finalPath);
            } catch (err) {
                console.error('[Downloads] Finalize error:', err);
            }
        }, 500);
    });
}

function cancelDownload(infoHash) {
    console.log(`[Downloads] Cancelling: ${infoHash}`);
    const active = activeDownloads.get(infoHash);
    if (active) {
        if (active.torrent) active.torrent.destroy();
        activeDownloads.delete(infoHash);
    }

    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);
    if (fs.existsSync(downloadPath)) {
        setTimeout(() => {
            try { fs.rmSync(downloadPath, { recursive: true, force: true }); }
            catch (e) { setTimeout(() => { try { fs.rmSync(downloadPath, { recursive: true, force: true }); } catch (e2) { } }, 1000); }
        }, 500);
    }
    return true;
}

function removeDownloadFile(infoHash) {
    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);
    if (fs.existsSync(downloadPath)) {
        try { fs.rmSync(downloadPath, { recursive: true, force: true }); return true; }
        catch (e) { console.error('[Downloads] Remove error:', e); return false; }
    }
    return true;
}

function getActiveDownloads() {
    const result = {};
    activeDownloads.forEach((value, key) => { result[key] = { progress: value.torrent.progress }; });
    return result;
}

module.exports = { startDownload, cancelDownload, removeDownloadFile, getActiveDownloads };

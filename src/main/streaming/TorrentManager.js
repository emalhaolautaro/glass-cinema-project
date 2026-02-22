const WebTorrent = require('webtorrent');
const path = require('path');
const fs = require('fs');
const { CACHE_DIR, DOWNLOADS_DIR } = require('../paths');

let client = null;
let activeTorrent = null;
let activeFileIndex = null;
let activeFileName = null;

function addTorrent(magnet) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CACHE_DIR)) {
            try { fs.mkdirSync(CACHE_DIR, { recursive: true }); }
            catch (e) { console.error('[TorrentManager] Cache dir error:', e); }
        }

        const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
        const detectedHash = match ? match[1].toLowerCase() : null;

        if (detectedHash) {
            const localPath = path.join(DOWNLOADS_DIR, detectedHash, 'video.mp4');
            if (fs.existsSync(localPath)) {
                console.log('[TorrentManager] Local file found, playing offline');
                return resolve({ isLocal: true, localFilePath: localPath, infoHash: detectedHash });
            }
        }

        client = new WebTorrent({
            maxWebConns: 4,
            tracker: {
                announce: ['wss://tracker.openwebtorrent.com', 'udp://tracker.opentrackr.org:1337/announce']
            }
        });

        client.on('error', (err) => console.error('[TorrentManager] Client error:', err.message));

        client.add(magnet, { path: CACHE_DIR }, (torrent) => {
            console.log('[TorrentManager] Torrent added:', torrent.name);
            activeTorrent = torrent;

            let file;
            try {
                file = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
            } catch (e) {
                return reject(new Error('No files in torrent'));
            }

            console.log(`[TorrentManager] Main file: ${file.name} (${Math.round(file.length / 1024 / 1024)} MB)`);
            file.select();

            activeFileIndex = torrent.files.indexOf(file);
            activeFileName = file.name;

            torrent.on('error', (err) => console.error('[TorrentManager] Torrent error:', err.message));

            resolve({ isLocal: false, torrent, file, fileIndex: activeFileIndex, fileName: activeFileName });
        });
    });
}

function getProgress() {
    if (!activeTorrent || activeTorrent.destroyed) return null;
    return {
        downloadSpeed: client ? client.downloadSpeed : 0,
        progress: activeTorrent.progress,
        downloaded: activeTorrent.downloaded,
        total: activeTorrent.length
    };
}

function destroy() {
    return new Promise(res => {
        if (!client) { activeTorrent = null; return res(); }
        const c = client;
        client = null;
        activeTorrent = null;
        try {
            c.removeAllListeners();
            c.torrents.forEach(t => { try { t.pause(); t.removeAllListeners(); } catch (e) { } });
            c.destroy((err) => {
                if (err) console.warn('[TorrentManager] Destroy warning:', err.message);
                else console.log('[TorrentManager] Client destroyed');
                res();
            });
            setTimeout(res, 3000);
        } catch (e) { res(); }
    });
}

function destroySync() {
    if (client) {
        try { client.torrents.forEach(t => { try { t.destroy(); } catch (e) { } }); client.destroy(); } catch (e) { }
        client = null;
    }
    activeTorrent = null;
}

function getClient() { return client; }
function getActiveTorrent() { return activeTorrent; }
function hasActiveTorrent() { return activeTorrent !== null && !activeTorrent.destroyed; }
function getActiveFileIndex() { return activeFileIndex; }
function getActiveFileName() { return activeFileName; }

function resetState() {
    activeFileIndex = null;
    activeFileName = null;
}

module.exports = {
    addTorrent, getProgress, destroy, destroySync,
    getClient, getActiveTorrent, hasActiveTorrent,
    getActiveFileIndex, getActiveFileName, resetState
};

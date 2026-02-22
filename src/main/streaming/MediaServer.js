const networkUtils = require('../network-utils');

let activeServer = null;
let activePort = null;
let isCastMode = false;
let activeLocalFilePath = null;

function serveTorrent(torrent, fileIndex, fileName, opts = {}) {
    const { onReady, onProgress, retryPort = 0 } = opts;
    closeServer();

    const server = torrent.createServer();
    activeServer = server;
    activeLocalFilePath = null;

    const host = isCastMode ? '0.0.0.0' : '127.0.0.1';
    console.log(`[MediaServer] Binding torrent server to ${host} (Cast: ${isCastMode})`);

    if (isCastMode) addSecurityMiddleware(server);

    const PREFERRED_PORT = parseInt(process.env.STREAM_PORT) || 62182;
    const portToTry = PREFERRED_PORT + retryPort;

    server.on('error', (err) => {
        console.error('[MediaServer] Server error:', err.code, err.message);
        if (err.code === 'EADDRINUSE' && retryPort < 5) {
            activeServer = null;
            setTimeout(() => serveTorrent(torrent, fileIndex, fileName, { onReady, onProgress, retryPort: retryPort + 1 }), 100);
        } else if (retryPort >= 5) {
            server.listen(0, host, () => finalizeStart(server, host, fileIndex, fileName, onReady, onProgress, torrent));
        }
    });

    server.listen(portToTry, host, () => finalizeStart(server, host, fileIndex, fileName, onReady, onProgress, torrent));
}

function finalizeStart(server, host, fileIndex, fileName, onReady, onProgress, torrent) {
    const port = server.address().port;
    activePort = port;
    const urlHost = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
    const url = `http://${urlHost}:${port}/${fileIndex}/${encodeURIComponent(fileName)}`;
    console.log(`[MediaServer] Server ready at ${url} (${host}:${port})`);
    if (onReady) onReady(url);
}

function serveLocalFile(filePath, onReady) {
    const fs = require('fs');
    const http = require('http');
    const path = require('path');
    closeServer();

    const fileDir = path.dirname(filePath);
    const subtitlesPath = path.join(fileDir, 'subtitles.vtt');
    const hasSubtitles = fs.existsSync(subtitlesPath);

    const server = http.createServer((req, res) => {
        if (req.url === '/subtitles.vtt' && hasSubtitles) {
            res.writeHead(200, { 'Content-Type': 'text/vtt', 'Access-Control-Allow-Origin': '*' });
            fs.createReadStream(subtitlesPath).pipe(res);
            return;
        }
        serveVideoFile(filePath, req, res);
    });

    const host = isCastMode ? '0.0.0.0' : '127.0.0.1';
    server.listen(0, host, () => {
        const port = server.address().port;
        activeServer = server;
        activePort = port;
        activeLocalFilePath = filePath;
        const urlHost = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
        const url = `http://${urlHost}:${port}/video.mp4`;
        const subtitleUrl = hasSubtitles ? `http://${urlHost}:${port}/subtitles.vtt` : null;
        console.log(`[MediaServer] Serving local file at ${url}`);
        if (onReady) onReady(url, subtitleUrl);
    });
}

function serveVideoFile(filePath, req, res) {
    const fs = require('fs');
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (e) {
        console.error('[MediaServer] File serve error:', e);
        res.writeHead(500);
        res.end('Internal error');
    }
}

function addSecurityMiddleware(server) {
    const originalHandler = server.listeners('request')[0];
    if (!originalHandler) return;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
        if (!networkUtils.validateLocalIP(req.socket.remoteAddress)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        originalHandler(req, res);
    });
}

function closeServer() {
    if (activeServer) {
        try { activeServer.removeAllListeners(); activeServer.close(); } catch (e) { }
        activeServer = null;
    }
}

function destroy() {
    return new Promise(res => {
        if (!activeServer) return res();
        const s = activeServer;
        activeServer = null;
        try {
            s.removeAllListeners();
            s.close(() => { console.log('[MediaServer] Server closed'); res(); });
            setTimeout(res, 2000);
        } catch (e) { res(); }
    });
}

function destroySync() {
    if (activeServer) { try { activeServer.close(); } catch (e) { } activeServer = null; }
    activePort = null;
    activeLocalFilePath = null;
}

function setCastMode(enabled) {
    const changed = isCastMode !== enabled;
    isCastMode = enabled;
    console.log(`[MediaServer] Cast mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return changed;
}

function getStreamUrl(fileIndex, fileName) {
    if (!activeServer) return null;
    const addr = activeServer.address();
    if (!addr || !addr.port) return null;
    const host = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
    if (activeLocalFilePath) return `http://${host}:${addr.port}/video.mp4`;
    return `http://${host}:${addr.port}/${fileIndex}/${encodeURIComponent(fileName)}`;
}

function resetState() { activePort = null; activeLocalFilePath = null; isCastMode = false; }
function isCastModeEnabled() { return isCastMode; }
function hasActiveServer() { return activeServer !== null; }
function getActiveServer() { return activeServer; }
function getActivePort() { return activePort; }
function getActiveLocalFilePath() { return activeLocalFilePath; }

module.exports = {
    serveTorrent, serveLocalFile, serveVideoFile, addSecurityMiddleware,
    closeServer, destroy, destroySync, setCastMode, isCastModeEnabled,
    getStreamUrl, resetState, hasActiveServer, getActiveServer,
    getActivePort, getActiveLocalFilePath
};

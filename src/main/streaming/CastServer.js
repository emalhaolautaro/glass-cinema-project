const networkUtils = require('../network-utils');
const mediaServer = require('./MediaServer');

const CAST_PORT = 8888;

async function rebindForCast(localIp, torrentManager) {
    const hasTorrent = torrentManager && torrentManager.hasActiveTorrent();
    const hasLocalFile = mediaServer.getActiveLocalFilePath() !== null;

    if (!hasTorrent && !hasLocalFile) {
        console.warn('[CastServer] No active torrent or local file to rebind');
        return null;
    }

    console.log(`[CastServer] Rebinding for cast with IP: ${localIp} (torrent: ${hasTorrent}, local: ${hasLocalFile})`);

    return new Promise((resolve) => {
        const server = mediaServer.getActiveServer();
        if (server) {
            try { server.removeAllListeners(); } catch (e) { }

            // CRITICAL FIX: Forcefully drop all active sockets (e.g. paused local video) 
            // otherwise server.close() hangs forever waiting for keep-alives to drain
            if (typeof server.closeAllConnections === 'function') {
                try { server.closeAllConnections(); } catch (e) { }
            }

            try { server.close(); } catch (e) { }
            mediaServer.closeServer();
        }

        // Proceed without waiting for close callback since sockets are cleared
        setTimeout(() => createCastServer(localIp, hasTorrent, torrentManager, resolve), 100);
    });
}

function createCastServer(localIp, hasTorrent, torrentManager, resolveCallback) {
    if (hasTorrent) {
        createTorrentCastServer(localIp, torrentManager, resolveCallback);
    } else {
        createLocalCastServer(localIp, resolveCallback);
    }
}

function createTorrentCastServer(localIp, torrentManager, resolveCallback) {
    const torrent = torrentManager.getActiveTorrent();
    if (!torrent) return resolveCallback(null);

    const server = torrent.createServer();
    mediaServer.addSecurityMiddleware(server);

    const fileIndex = torrentManager.getActiveFileIndex();
    const fileName = torrentManager.getActiveFileName();

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            server.listen(0, '0.0.0.0', () => {
                const port = server.address().port;
                const url = `http://${localIp}:${port}/${fileIndex}/${encodeURIComponent(fileName)}`;
                console.log(`[CastServer] Cast URL (random port): ${url}`);
                resolveCallback(url);
            });
        } else {
            resolveCallback(null);
        }
    });

    server.listen(CAST_PORT, '0.0.0.0', () => {
        const port = server.address().port;
        const url = `http://${localIp}:${port}/${fileIndex}/${encodeURIComponent(fileName)}`;
        console.log(`[CastServer] Torrent cast ready: ${url}`);
        resolveCallback(url);
    });
}

function createLocalCastServer(localIp, resolveCallback) {
    const fs = require('fs');
    const http = require('http');
    const path = require('path');

    const filePath = mediaServer.getActiveLocalFilePath();
    if (!filePath) return resolveCallback(null);

    console.log(`[CastServer] Rebinding local file for cast: ${filePath}`);

    const fileDir = path.dirname(filePath);
    const subtitlesPath = path.join(fileDir, 'subtitles.vtt');
    const hasSubtitles = fs.existsSync(subtitlesPath);

    const server = http.createServer((req, res) => {
        if (!networkUtils.validateLocalIP(req.socket.remoteAddress)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        if (req.url === '/subtitles.vtt' && hasSubtitles) {
            res.writeHead(200, { 'Content-Type': 'text/vtt', 'Access-Control-Allow-Origin': '*' });
            fs.createReadStream(subtitlesPath).pipe(res);
            return;
        }
        mediaServer.serveVideoFile(filePath, req, res);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            server.listen(0, '0.0.0.0', () => {
                const url = `http://${localIp}:${server.address().port}/video.mp4`;
                console.log(`[CastServer] Local cast URL (random): ${url}`);
                resolveCallback(url);
            });
        } else {
            resolveCallback(null);
        }
    });

    server.listen(CAST_PORT, '0.0.0.0', () => {
        const url = `http://${localIp}:${server.address().port}/video.mp4`;
        console.log(`[CastServer] Local cast ready: ${url}`);
        resolveCallback(url);
    });
}

module.exports = { rebindForCast };

const http = require('http');
const fs = require('fs');
const path = require('path');
const networkUtils = require('../network-utils');
const { DOWNLOADS_DIR } = require('../paths');

let isCastMode = false;

function setCastModeRef(getter) { isCastMode = getter; }

function serveLocalFolder(infoHash, onReady, castMode) {
    const folderPath = path.join(DOWNLOADS_DIR, infoHash);
    if (!fs.existsSync(folderPath)) {
        console.error('[LocalFolder] Folder not found:', folderPath);
        if (onReady) onReady(null);
        return null;
    }

    const CORS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range'
    };

    const server = http.createServer((req, res) => {
        if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

        let filePath, contentType;

        if (req.url === '/video.mp4' || req.url === '/') {
            filePath = path.join(folderPath, 'video.mp4');
            contentType = 'video/mp4';
        } else if (req.url === '/subtitles.vtt') {
            filePath = path.join(folderPath, 'subtitles.vtt');
            contentType = 'text/vtt';
        } else if (req.url === '/subtitles.srt') {
            filePath = path.join(folderPath, 'subtitles.srt');
            contentType = 'text/plain';
        } else if (req.url === '/poster.jpg') {
            filePath = path.join(folderPath, 'poster.jpg');
            contentType = 'image/jpeg';
        } else {
            res.writeHead(404, CORS);
            res.end('Not found');
            return;
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, CORS);
            res.end('File not found');
            return;
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range && contentType === 'video/mp4') {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            res.writeHead(206, {
                ...CORS,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': contentType
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { ...CORS, 'Content-Length': fileSize, 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    const host = castMode ? '0.0.0.0' : '127.0.0.1';
    server.listen(0, host, () => {
        const port = server.address().port;
        const urlHost = castMode ? networkUtils.getLocalIP() : '127.0.0.1';
        const url = `http://${urlHost}:${port}/video.mp4`;
        const hasSubtitles = fs.existsSync(path.join(folderPath, 'subtitles.vtt'));
        const subtitleUrl = hasSubtitles ? `http://${urlHost}:${port}/subtitles.vtt` : null;
        console.log(`[LocalFolder] Serving at ${url}`);
        if (onReady) onReady(url, subtitleUrl);
    });

    return server;
}

module.exports = { serveLocalFolder };

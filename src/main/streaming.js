const WebTorrent = require('webtorrent');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');
const networkUtils = require('./network-utils');
const { CACHE_DIR, DOWNLOADS_DIR } = require('./paths');
const subtitles = require('./subtitles');
const storeManager = require('./store-manager');
const https = require('https'); // For poster download
const http = require('http'); // For local file server

// --- State ---
let client = null;
let downloadClient = null; // Separate client for background downloads
let activeServer = null;
let activeTorrent = null;
let activeDownloads = new Map(); // infoHash -> { torrent, progress, speed }
let progressInterval = null;
let cleanupPromise = null; // Lock for race conditions
let isClean = true; // Optimization: avoid redundant cleanups
let isCastMode = false; // Cast mode: bind to 0.0.0.0 instead of localhost
let activeFileIndex = null; // Track file index for URL generation
let activeFileName = null; // Track file name for URL generation
let activePort = null; // Track current port
let onReadyCallback = null; // Store callback for rebind
let onProgressCallback = null; // Store callback for rebind

// Use centralized CACHE_DIR
console.log(`[Streaming] Storage Path: ${CACHE_DIR}`);

// --- Process Exit Handlers for Zombie Prevention ---
let isShuttingDown = false;

function registerExitHandlers() {
    // Before quit - async cleanup
    app.on('before-quit', async (event) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log('[Streaming] App before-quit - running cleanup...');

        // Don't block quit, but start cleanup
        forceCleanup().catch(e => console.error('[Streaming] Cleanup error:', e));
    });

    // Window all closed
    app.on('window-all-closed', () => {
        console.log('[Streaming] All windows closed - cleanup');
        forceCleanup().catch(e => { });
    });

    // Process exit (synchronous, last resort)
    process.on('exit', () => {
        console.log('[Streaming] Process exit - force cleanup');
        forceCleanupSync();
    });

    // SIGINT/SIGTERM
    process.on('SIGINT', () => {
        console.log('[Streaming] SIGINT received');
        forceCleanup().finally(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
        console.log('[Streaming] SIGTERM received');
        forceCleanup().finally(() => process.exit(0));
    });
}

// Register immediately
registerExitHandlers();

/**
 * Force cleanup (synchronous version for process.exit)
 */
function forceCleanupSync() {
    try {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        if (activeServer) {
            try { activeServer.close(); } catch (e) { }
            activeServer = null;
        }
        if (client) {
            try {
                client.torrents.forEach(t => { try { t.destroy(); } catch (e) { } });
                client.destroy();
            } catch (e) { }
            client = null;
        }
        if (downloadClient) {
            try {
                downloadClient.originalDestroy();
            } catch (e) { }
            downloadClient = null;
        }
        activeTorrent = null;
    } catch (e) {
        console.error('[Streaming] forceCleanupSync error:', e);
    }
}

/**
 * Start streaming a torrent
 * @param {string} magnet - Magnet URI
 * @param {function} onReady - Callback with stream URL
 * @param {function} onProgress - Callback with download stats
 */
async function startStream(magnet, onReady, onProgress) {
    console.log('[Streaming] Starting stream...');
    isClean = false; // System is now dirty
    isShuttingDown = false; // Reset shutdown flag

    // Store callbacks for potential rebind
    onReadyCallback = onReady;
    onProgressCallback = onProgress;

    // Cleanup previous session first
    if (activeServer || client) {
        console.log('[Streaming] Cleaning up previous session...');
        await forceCleanup();
    }

    // Initialize new client
    client = new WebTorrent({
        // Optimize for streaming
        maxWebConns: 4,
        tracker: {
            announce: ['wss://tracker.openwebtorrent.com', 'udp://tracker.opentrackr.org:1337/announce']
        }
    });

    client.on('error', (err) => {
        console.error('[Streaming] Client error:', err.message);
    });

    // Ensure cache directory exists
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
            console.log('[Streaming] Created cache directory:', CACHE_DIR);
        }
    } catch (e) {
        console.error('[Streaming] Error creating cache dir:', e);
    }

    // Add torrent to temp directory
    // Check for offline file first
    const infoHash = networkUtils.extractInfoHash(magnet);

    // Quick extract infohash from magnet if possible
    const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
    const detectedHash = match ? match[1].toLowerCase() : null;

    if (detectedHash) {
        const localPath = path.join(DOWNLOADS_DIR, detectedHash, 'video.mp4');
        if (fs.existsSync(localPath)) {
            console.log('[Streaming] Local file found! Playing offline.');
            serveLocalFile(localPath, detectedHash, onReady);
            return;
        }
    }

    client.add(magnet, { path: CACHE_DIR }, (torrent) => {
        console.log('[Streaming] Torrent added:', torrent.name);
        activeTorrent = torrent;

        // Find largest file (main video)
        let file;
        try {
            file = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
        } catch (e) {
            console.error('[Streaming] No files in torrent');
            return;
        }

        console.log('[Streaming] Main file:', file.name, '(' + Math.round(file.length / 1024 / 1024) + ' MB)');

        // Stream priority: sequential download
        file.select();

        // Store file info for URL generation
        activeFileIndex = torrent.files.indexOf(file);
        activeFileName = file.name;

        // Create and bind server
        createAndBindServer(torrent, file, onReady, onProgress);

        torrent.on('error', (err) => {
            console.error('[Streaming] Torrent error:', err.message);
        });
    });
}

/**
 * Create HTTP server and bind to appropriate host with port retry
 */
function createAndBindServer(torrent, file, onReady, onProgress, retryPort = 0) {
    // Force close existing server
    if (activeServer) {
        try {
            activeServer.removeAllListeners();
            activeServer.close();
        } catch (e) { }
        activeServer = null;
    }

    // Create local HTTP server
    const server = torrent.createServer();
    activeServer = server;

    // Determine host based on cast mode
    const host = isCastMode ? '0.0.0.0' : '127.0.0.1';
    console.log(`[Streaming] Binding server to ${host} (Cast Mode: ${isCastMode})`);

    // Add security middleware when in cast mode
    if (isCastMode) {
        const originalHandler = server.listeners('request')[0];
        if (originalHandler) {
            server.removeAllListeners('request');
            server.on('request', (req, res) => {
                const clientIP = req.socket.remoteAddress;
                if (!networkUtils.validateLocalIP(clientIP)) {
                    console.warn(`[Streaming] Blocked non-local request from: ${clientIP}`);
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }
                originalHandler(req, res);
            });
        }
    }

    // Fixed Port Logic
    const PREFERRED_PORT = parseInt(process.env.STREAM_PORT) || 62182;
    // If retrying, we might want to increment? Or fail? User asked for persistent port.
    // Let's try preferred, if busy, we try preferred + 1, etc up to 5 times
    const portToTry = PREFERRED_PORT + retryPort;

    // Handle server errors with port retry
    server.on('error', (err) => {
        console.error('[Streaming] Server error:', err.code, err.message);

        if (err.code === 'EADDRINUSE' && retryPort < 5) {
            console.log(`[Streaming] Port ${portToTry} in use, trying next port (attempt ${retryPort + 1})...`);
            activeServer = null;
            setTimeout(() => {
                createAndBindServer(torrent, file, onReady, onProgress, retryPort + 1);
            }, 100);
        } else {
            console.error(`[Streaming] Server failed to start after retries. Last port tried: ${portToTry}`);
            // Could fallback to random port here if critical, but user requested persistence.
            // Failing gracefully might be better, or falling back to random as last resort.
            if (retryPort >= 5) {
                console.log('[Streaming] Persistence failed. Falling back to random port as last resort.');
                // Last ditch effort: random port
                server.listen(0, host, () => {
                    finalizeServerStart(server, host, torrent, file, onReady, onProgress);
                });
            }
        }
    });

    server.listen(portToTry, host, () => {
        finalizeServerStart(server, host, torrent, file, onReady, onProgress);
    });
}

function finalizeServerStart(server, host, torrent, file, onReady, onProgress) {
    const port = server.address().port;
    activePort = port;

    // Use local IP for cast mode, localhost otherwise
    const urlHost = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';

    // Ensure we use the ACTUAL bound port (in case we fell back to random)
    const url = `http://${urlHost}:${port}/${activeFileIndex}/${encodeURIComponent(activeFileName)}`;

    console.log(`[DEBUG] URL generated: ${url}`);
    console.log(`[Streaming] Server ready at ${url} (${host}:${port})`);

    if (onReady) onReady(url);

    // Start progress polling (clear existing first)
    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(() => {
        if (!torrent || torrent.destroyed) {
            if (progressInterval) clearInterval(progressInterval);
            return;
        }

        try {
            if (onProgress) {
                onProgress({
                    downloadSpeed: client ? client.downloadSpeed : 0,
                    progress: torrent.progress,
                    downloaded: torrent.downloaded,
                    total: torrent.length
                });
            }
        } catch (e) { }
    }, 1000);
}

/**
 * Rebind server to 0.0.0.0 for cast mode
 * @param {string} localIp - Local IP address to use in URL
 * @returns {Promise<string>} New stream URL
 */
async function rebindServerForCast(localIp) {
    if (!activeTorrent || activeFileIndex === null) {
        console.warn('[Streaming] No active torrent to rebind');
        return null;
    }

    console.log(`[Streaming] Rebinding server for cast mode with IP: ${localIp}...`);

    const file = activeTorrent.files[activeFileIndex];
    if (!file) {
        console.error('[Streaming] Could not find file for rebind');
        return null;
    }

    return new Promise((resolve) => {
        // Force close old server
        if (activeServer) {
            console.log('[Streaming] Closing old server for rebind...');
            try {
                activeServer.removeAllListeners();
            } catch (e) { }

            activeServer.close(() => {
                console.log('[Streaming] Old server closed');
                activeServer = null;

                // Small delay to ensure port is released
                setTimeout(() => {
                    createNewCastServer(localIp, resolve);
                }, 200);
            });
        } else {
            createNewCastServer(localIp, resolve);
        }
    });
}

/**
 * Create new server bound to 0.0.0.0 for casting
 * @param {string} localIp - Local IP address to use in URL
 */
function createNewCastServer(localIp, resolveCallback, retryCount = 0) {
    if (!activeTorrent) {
        resolveCallback(null);
        return;
    }

    const server = activeTorrent.createServer();
    activeServer = server;

    const host = '0.0.0.0';
    const CAST_PORT = 8888; // Fixed port for Samsung TV compatibility
    console.log(`[Streaming] Creating cast server on ${host}:${CAST_PORT}`);

    // Add security middleware
    const originalHandler = server.listeners('request')[0];
    if (originalHandler) {
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            const clientIP = req.socket.remoteAddress;
            if (!networkUtils.validateLocalIP(clientIP)) {
                console.warn(`[Streaming] Blocked non-local request from: ${clientIP}`);
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            originalHandler(req, res);
        });
    }

    server.on('error', (err) => {
        console.error('[Streaming] Cast server error:', err.code);

        if (err.code === 'EADDRINUSE' && retryCount < 5) {
            console.log('[Streaming] Port 8888 busy, falling back to random port...');
            activeServer = null;
            // Fallback to random port
            createNewCastServerWithRandomPort(localIp, resolveCallback);
        } else {
            resolveCallback(null);
        }
    });

    server.listen(CAST_PORT, host, () => {
        const port = server.address().port;
        activePort = port;

        const url = `http://${localIp}:${port}/${activeFileIndex}/${encodeURIComponent(activeFileName)}`;

        console.log(`[DEBUG] Cast URL ready: ${url}`);
        console.log(`[Streaming] Cast server ready at ${host}:${port}`);

        resolveCallback(url);
    });
}

/**
 * Fallback: Create cast server with random port
 */
function createNewCastServerWithRandomPort(localIp, resolveCallback) {
    if (!activeTorrent) {
        resolveCallback(null);
        return;
    }

    const server = activeTorrent.createServer();
    activeServer = server;

    const host = '0.0.0.0';
    console.log(`[Streaming] Creating cast server on ${host} with random port (fallback)`);

    // Add security middleware
    const originalHandler = server.listeners('request')[0];
    if (originalHandler) {
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            const clientIP = req.socket.remoteAddress;
            if (!networkUtils.validateLocalIP(clientIP)) {
                console.warn(`[Streaming] Blocked non-local request from: ${clientIP}`);
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            originalHandler(req, res);
        });
    }

    server.on('error', (err) => {
        console.error('[Streaming] Cast server random port error:', err.code);
        resolveCallback(null);
    });

    server.listen(0, host, () => {
        const port = server.address().port;
        activePort = port;

        const url = `http://${localIp}:${port}/${activeFileIndex}/${encodeURIComponent(activeFileName)}`;

        console.log(`[DEBUG] Cast URL ready (random port): ${url}`);
        console.log(`[Streaming] Cast server ready at ${host}:${port}`);

        resolveCallback(url);
    });
}

/**
 * Start a background download
 * @param {object} movie - Movie object
 * @param {string} subtitleUrl - URL for subtitle ZIP
 * @param {function} onProgress - Callback(stats)
 * @param {function} onComplete - Callback(localPath)
 */
async function startDownload(movie, subtitleUrl, onProgress, onComplete) {
    const infoHash = movie.infoHash;
    console.log(`[Downloads] Starting download for: ${movie.title} (${infoHash})`);

    // Ensure download client exists
    if (!downloadClient) {
        downloadClient = new WebTorrent();
        downloadClient.originalDestroy = downloadClient.destroy;
        // Monkey patch destroy to prevent accidental destruction if we decide to share logic later
        // But for now it's separate.
    }

    // Check if already downloading
    if (activeDownloads.has(infoHash)) {
        console.log('[Downloads] Already downloading this movie.');
        return;
    }

    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);

    // Create directory recursively
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }

    // 1. Download Poster (Async)
    if (movie.coverUrl) {
        const posterPath = path.join(downloadPath, 'poster.jpg');
        const file = fs.createWriteStream(posterPath);
        https.get(movie.coverUrl, function (response) {
            response.pipe(file);
        }).on('error', (err) => console.error('[Downloads] Poster download error:', err));
    }

    // 2. Download and Convert Subtitles (Async)
    if (subtitleUrl) {
        try {
            console.log('[Downloads] Fetching subtitles...');
            const srtContent = await subtitles.downloadSubtitle(subtitleUrl);

            // Save raw SRT
            fs.writeFileSync(path.join(downloadPath, 'subtitles.srt'), srtContent);
            console.log('[Downloads] SRT Subtitles saved.');

            // Convert and save VTT
            const vttContent = subtitles.srtToVtt(srtContent);
            fs.writeFileSync(path.join(downloadPath, 'subtitles.vtt'), vttContent);
            console.log('[Downloads] VTT Subtitles saved.');
        } catch (err) {
            console.error('[Downloads] Subtitle error:', err);
        }
    }

    // 2.5 Save Metadata (JSON)
    try {
        const metadataPath = path.join(downloadPath, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(movie, null, 2));
        console.log('[Downloads] Metadata saved.');
    } catch (err) {
        console.error('[Downloads] Metadata save error:', err);
    }

    // 3. Start Torrent Download
    const magnet = movie.magnet || `magnet:?xt=urn:btih:${infoHash}`;

    downloadClient.add(magnet, { path: downloadPath }, (torrent) => {
        console.log(`[Downloads] Torrent added: ${torrent.infoHash}`);

        // Mark files as high priority
        torrent.files.forEach(f => f.select());

        activeDownloads.set(infoHash, {
            torrent: torrent,
            title: movie.title
        });

        // Progress Loop
        const interval = setInterval(() => {
            if (torrent.destroyed) {
                clearInterval(interval);
                return;
            }

            const stats = {
                progress: torrent.progress,
                downloadSpeed: torrent.downloadSpeed,
                downloaded: torrent.downloaded,
                total: torrent.length,
                timeRemaining: torrent.timeRemaining
            };

            // Calculate percentage for UI (0-100)
            const percentage = Math.round(torrent.progress * 100);

            if (onProgress) onProgress(infoHash, percentage, stats);

            // Check completion
            if (torrent.progress === 1) {
                console.log(`[Downloads] Download complete: ${movie.title}`);
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

/**
 * Finalize download: release lock, rename file, update store
 */
function finalizeDownload(torrent, movie, downloadPath, onComplete, infoHash) {
    // We need to stop the torrent to release the file lock before renaming
    // But we want to keep the files.
    // WebTorrent 'destroy' removes the task but keeps files strictly speaking, 
    // unless we used specific options. standard destroy() is safe for files.

    // Identify main file BEFORE destroying
    let mainFile = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
    const originalPath = path.join(downloadPath, mainFile.path); // path inside download folder
    const finalPath = path.join(downloadPath, 'video.mp4');

    torrent.destroy(() => {
        console.log('[Downloads] Torrent destroyed, releasing locks.');
        activeDownloads.delete(infoHash);

        // Rename logic
        setTimeout(() => {
            try {
                if (fs.existsSync(originalPath)) {
                    // If it's already named video.mp4 (unlikely with magnet but possible), skip
                    if (path.resolve(originalPath) !== path.resolve(finalPath)) {
                        fs.renameSync(originalPath, finalPath);
                        console.log('[Downloads] File renamed to video.mp4');
                    }
                } else {
                    console.warn('[Downloads] Original file not found:', originalPath);
                    // Fallback: maybe it was already video.mp4?
                    if (!fs.existsSync(finalPath)) {
                        console.error('[Downloads] CRITICAL: No video file found after download.');
                        return;
                    }
                }

                // Clean up other files (garbage collection) - Optional
                // Keeping it simple: just save to store

                storeManager.addDownload(movie, finalPath);
                if (onComplete) onComplete(finalPath);

            } catch (err) {
                console.error('[Downloads] Rename/Finalize error:', err);
            }
        }, 500); // Small delay for OS to release handle
    });
}

/**
 * Cancel an active download and remove files
 */
function cancelDownload(infoHash) {
    console.log(`[Downloads] Cancelling download: ${infoHash}`);

    // 1. Stop Torrent
    const active = activeDownloads.get(infoHash);
    if (active) {
        if (active.torrent) {
            console.log('[Downloads] Destroying torrent...');
            active.torrent.destroy();
        }
        activeDownloads.delete(infoHash);
    }

    // 2. Remove Folder recursively
    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);
    if (fs.existsSync(downloadPath)) {
        try {
            // Add a small delay/retry to ensure file locks are released
            setTimeout(() => {
                try {
                    fs.rmSync(downloadPath, { recursive: true, force: true });
                    console.log('[Downloads] Download folder removed:', downloadPath);
                } catch (e) {
                    console.error('[Downloads] Error removing folder (retrying):', e);
                    // Retry once
                    setTimeout(() => {
                        try { fs.rmSync(downloadPath, { recursive: true, force: true }); }
                        catch (err2) { console.error('[Downloads] Failed to remove folder:', err2); }
                    }, 1000);
                }
            }, 500);
        } catch (e) {
            console.error('[Downloads] Error initiating removal:', e);
        }
    }

    return true;
}

/**
 * Remove a completed download (File System only)
 */
function removeDownloadFile(infoHash) {
    const downloadPath = path.join(DOWNLOADS_DIR, infoHash);
    if (fs.existsSync(downloadPath)) {
        try {
            fs.rmSync(downloadPath, { recursive: true, force: true });
            console.log('[Downloads] Completed folder removed:', downloadPath);
            return true;
        } catch (e) {
            console.error('[Downloads] Error removing completed folder:', e);
            return false;
        }
    }
    return true; // Already gone
}

/**
 * Force cleanup - brute force stop everything
 */
async function forceCleanup() {
    console.log('[Streaming] FORCE CLEANUP starting...');

    // Clear interval immediately
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    const tasks = [];

    // Force close server
    if (activeServer) {
        const serverToClose = activeServer;
        activeServer = null;

        tasks.push(new Promise(res => {
            try {
                // Remove all listeners first
                serverToClose.removeAllListeners();

                // Force close
                serverToClose.close((err) => {
                    if (err) console.warn('[Streaming] Server close warning:', err.message);
                    else console.log('[Streaming] Server force closed');
                    res();
                });

                // Timeout fallback
                setTimeout(res, 2000);
            } catch (e) {
                res();
            }
        }));
    }

    // Force destroy client and all torrents
    if (client) {
        const clientToDestroy = client;
        client = null;
        activeTorrent = null;

        tasks.push(new Promise(res => {
            try {
                // Remove all client listeners
                clientToDestroy.removeAllListeners();

                // Pause all torrents first
                clientToDestroy.torrents.forEach(t => {
                    try {
                        t.pause();
                        t.removeAllListeners();
                    } catch (e) { }
                });

                // Destroy client
                clientToDestroy.destroy((err) => {
                    if (err) console.warn('[Streaming] Client destroy warning:', err.message);
                    else console.log('[Streaming] Client force destroyed');
                    res();
                });

                // Timeout fallback
                setTimeout(res, 3000);
            } catch (e) {
                res();
            }
        }));
    }

    // Wait for all with timeout
    await Promise.race([
        Promise.all(tasks),
        new Promise(res => setTimeout(res, 5000))
    ]);

    // Reset all state
    activeFileIndex = null;
    activeFileName = null;
    activePort = null;
    isCastMode = false;
    isClean = true;
    cleanupPromise = null;

    console.log('[Streaming] FORCE CLEANUP complete');
}

/**
 * Full cleanup: stop everything and delete cache
 */
async function fullCleanup() {
    if (isClean) {
        console.log('[Streaming] Already clean. Skipping.');
        return;
    }

    if (cleanupPromise) {
        console.log('[Streaming] Cleanup in progress, joining...');
        return cleanupPromise;
    }

    cleanupPromise = (async () => {
        await forceCleanup();

        // Delay for Windows file handle release
        await new Promise(res => setTimeout(res, 500));

        // Clean cache
        cleanCache();

        console.log('[Streaming] Full cleanup done');
    })();

    return cleanupPromise;
}

/**
 * Delete temp cache folder
 */
function cleanCache() {
    // 1. Clean Media Cache (streaming temp)
    if (fs.existsSync(CACHE_DIR)) {
        try {
            fs.rmSync(CACHE_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            console.log('[Streaming] Media cache deleted');
        } catch (e) {
            console.warn('[Streaming] Could not delete media cache:', e.message);
        }
    }

    // 2. Clean Electron Internal Caches (Roaming)
    const userData = app.getPath('userData');
    const foldersToClean = [
        'Cache',
        'Code Cache',
        'GPUCache',
        'DawnWebGPUCache',
        'DawnGraphiteCache',
        'Service Worker',
        'VideoDecodeStats'
    ];

    foldersToClean.forEach(folder => {
        const folderPath = path.join(userData, folder);
        if (fs.existsSync(folderPath)) {
            try {
                fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 3 });
                console.log(`[Streaming] Cleaned ${folder}`);
            } catch (e) {
                console.warn(`[Streaming] Failed to clean ${folder}:`, e.message);
            }
        }
    });
}

/**
 * Enable or disable Cast Mode
 * @param {boolean} enabled
 * @returns {boolean} Whether mode changed
 */
function setCastMode(enabled) {
    const wasEnabled = isCastMode;
    isCastMode = enabled;
    console.log(`[Streaming] Cast mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return wasEnabled !== enabled;
}

/**
 * Check if cast mode is active
 */
function isCastModeEnabled() {
    return isCastMode;
}

/**
 * Get the current stream URL
 */
function getStreamUrl() {
    if (!activeServer || activeFileIndex === null) {
        return null;
    }

    const addr = activeServer.address();
    if (!addr || !addr.port) return null;

    const host = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
    return `http://${host}:${addr.port}/${activeFileIndex}/${encodeURIComponent(activeFileName)}`;
}

/**
 * Serve a local file using a simple HTTP server
 */
function serveLocalFile(filePath, infoHash, onReady) {
    if (activeServer) {
        try { activeServer.close(); } catch (e) { }
    }

    const fileDir = path.dirname(filePath);
    const subtitlesPath = path.join(fileDir, 'subtitles.vtt');
    const hasSubtitles = fs.existsSync(subtitlesPath);

    const server = http.createServer((req, res) => {
        // Serve Subtitles
        if (req.url === '/subtitles.vtt') {
            if (hasSubtitles) {
                res.writeHead(200, {
                    'Content-Type': 'text/vtt',
                    'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(subtitlesPath).pipe(res);
                return;
            }
        }

        // Serve Video
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const contentType = 'video/mp4';

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    });

    // Use Cast mode for binding - 0.0.0.0 allows external access
    const host = isCastMode ? '0.0.0.0' : '127.0.0.1';

    server.listen(0, host, () => {
        const port = server.address().port;
        activeServer = server;
        activePort = port;
        activeFileIndex = 0; // Dummy
        activeFileName = 'video.mp4';

        // Use LAN IP for Cast mode so TV can access
        const urlHost = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
        const url = `http://${urlHost}:${port}/video.mp4`;
        const subtitleUrl = hasSubtitles ? `http://${urlHost}:${port}/subtitles.vtt` : null;

        console.log(`[Streaming] Serving local file at ${url} (Cast Mode: ${isCastMode})`);
        if (onReady) onReady(url, subtitleUrl);
    });
}

function getActiveDownloads() {
    // Return status list
    const result = {};
    activeDownloads.forEach((value, key) => {
        result[key] = {
            progress: value.torrent.progress
        };
    });
    return result;
}

/**
 * Serve a downloaded folder directly (Bypassing Torrent logic)
 * Serves video.mp4, subtitles.vtt, poster.jpg from DOWNLOADS_DIR/infoHash
 */
function serveLocalFolder(infoHash, onReady) {
    if (activeServer) {
        try { activeServer.close(); } catch (e) { }
        activeServer = null;
    }

    const folderPath = path.join(DOWNLOADS_DIR, infoHash);
    if (!fs.existsSync(folderPath)) {
        console.error('[Streaming] Local folder not found:', folderPath);
        if (onReady) onReady(null);
        return;
    }

    const server = http.createServer((req, res) => {
        // Headers for CORS and Streaming
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Range'
        };

        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
            return;
        }

        let filePath;
        let contentType;

        // Routing
        if (req.url === '/video.mp4' || req.url === '/') {
            filePath = path.join(folderPath, 'video.mp4');
            contentType = 'video/mp4';
        } else if (req.url === '/subtitles.vtt') {
            filePath = path.join(folderPath, 'subtitles.vtt');
            contentType = 'text/vtt';
        } else if (req.url === '/subtitles.srt') {
            filePath = path.join(folderPath, 'subtitles.srt');
            contentType = 'text/plain'; // or application/x-subrip
        } else if (req.url === '/poster.jpg') {
            filePath = path.join(folderPath, 'poster.jpg');
            contentType = 'image/jpeg';
        } else {
            res.writeHead(404, headers);
            res.end('Not found');
            return;
        }

        if (!fs.existsSync(filePath)) {
            // Fallbacks:
            // If vtt requested but only srt exists (rare with our new logic but possible for old)
            if (req.url === '/subtitles.vtt' && fs.existsSync(path.join(folderPath, 'subtitles.srt'))) {
                // We could on-the-fly convert, but for now just 404 implies no subs
                console.warn('[Streaming] Requested VTT missing, but SRT exists. Conversion not implemented in serveLocalFolder yet.');
            }
            res.writeHead(404, headers);
            res.end('File not found');
            return;
        }

        // Serve File
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range && contentType === 'video/mp4') {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                ...headers,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                ...headers,
                'Content-Length': fileSize,
                'Content-Type': contentType,
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    // Bind to 0.0.0.0 only if Cast Mode, else localhost
    const host = isCastMode ? '0.0.0.0' : '127.0.0.1';

    server.listen(0, host, () => {
        const port = server.address().port;
        activeServer = server;
        activePort = port;

        // Dummy values to satisfy other parts of the system if they check
        activeFileIndex = 0;
        activeFileName = 'video.mp4';

        const urlHost = isCastMode ? networkUtils.getLocalIP() : '127.0.0.1';
        const url = `http://${urlHost}:${port}/video.mp4`;

        // Check for subtitles presence for convenience
        const hasSubtitles = fs.existsSync(path.join(folderPath, 'subtitles.vtt'));
        const subtitleUrl = hasSubtitles ? `http://${urlHost}:${port}/subtitles.vtt` : null;

        console.log(`[Streaming] Serving LOCAL FOLDER at ${url} (Cast: ${isCastMode})`);
        if (onReady) onReady(url, subtitleUrl);
    });
}

module.exports = {
    startStream,
    startDownload, // Exported
    getActiveDownloads, // Exported
    cancelDownload,
    removeDownloadFile,
    forceCleanup,
    fullCleanup,
    cleanCache,
    setCastMode,
    isCastModeEnabled,
    getStreamUrl,
    rebindServerForCast,
    CACHE_DIR,
    serveLocalFolder // Exported
};

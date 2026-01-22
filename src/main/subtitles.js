/**
 * Subtitle Manager Module
 * Uses yifysubtitles.ch for subtitle downloads
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');
const os = require('os');
const { app } = require('electron');

const TMP_DIR = path.join(app.getPath('userData'), 'glass-cinema-cache');
const SUBS_DIR = path.join(TMP_DIR, 'subs');
const BASE_URL = process.env.SUBTITLES_API_URL || 'https://yifysubtitles.ch';

/**
 * Fetch content from URL with redirect support
 */
function fetchUrl(url, binary = false) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://yifysubtitles.ch/',
                'Connection': 'keep-alive'
            }
        };

        client.get(url, options, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    const urlObj = new URL(url);
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                return fetchUrl(redirectUrl, binary).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            if (binary) {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            } else {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }
        }).on('error', reject);
    });
}

/**
 * Detect encoding and convert to UTF-8
 */
function decodeSubtitle(buffer) {
    // UTF-8 BOM
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return buffer.slice(3).toString('utf8');
    }

    // UTF-16 LE BOM
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return iconv.decode(buffer.slice(2), 'utf16le');
    }

    // Try UTF-8 first
    const utf8Content = buffer.toString('utf8');

    // Check for replacement characters (indicates wrong encoding)
    if (utf8Content.includes('�')) {
        // Try Latin-1 (ISO-8859-1) - common for Spanish subtitles
        const latin1Content = iconv.decode(buffer, 'iso-8859-1');
        if (!latin1Content.includes('�')) {
            console.log('[Subtitles] Using ISO-8859-1 encoding');
            return latin1Content;
        }

        // Try Windows-1252
        console.log('[Subtitles] Using Windows-1252 encoding');
        return iconv.decode(buffer, 'win1252');
    }

    return utf8Content;
}

/**
 * Get available subtitles from yifysubtitles.ch
 * @param {string} imdbId - IMDB ID (e.g., "tt0816692")
 * @returns {Promise<Array>} List of available subtitles
 */
async function getAvailableSubtitles(imdbId) {
    console.log('[Subtitles] Fetching for IMDB:', imdbId);

    try {
        const url = `${BASE_URL}/movie-imdb/${imdbId}`;
        const html = await fetchUrl(url);

        const subtitles = [];
        const seen = new Set();

        // URLs pattern: /subtitles/movie-2014-spanish-yify-12345
        const urlRegex = /href="(\/subtitles\/[^"]+)"/gi;

        let match;
        while ((match = urlRegex.exec(html)) !== null) {
            const subtitlePath = match[1];

            // Regex to capture: /subtitles/movie-name-year-language-id
            // Try stricter first, then looser
            let langMatch = subtitlePath.match(/\/subtitles\/[^\/]+-(\d{4})-([a-z]+)-yify-(\d+)/i);

            if (!langMatch) {
                // Fallback: Try to capture just language and ID at the end
                // Example: /subtitles/some-movie-spanish-12345
                langMatch = subtitlePath.match(/\/subtitles\/.*-([a-z]+)-(\d+)$/i);
            }

            if (langMatch) {
                // If the first group is year (4 digits), then lang is 2, id is 3
                // If fallback, lang is 1, id is 2.
                let rawLanguage, id;

                if (langMatch.length === 4) {
                    rawLanguage = langMatch[2];
                    id = langMatch[3];
                } else {
                    rawLanguage = langMatch[1];
                    id = langMatch[2];
                }

                const language = rawLanguage
                    .replace(/_/g, ' ')
                    .split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');

                // Create direct download URL (note: /subtitle/ not /subtitles/)
                // Pattern: /subtitle/movie-year-language-yify-id.zip
                // Using the exact path but replacing /subtitles/ with /subtitle/ and adding .zip usually works
                const downloadUrl = subtitlePath.replace('/subtitles/', '/subtitle/') + '.zip';

                // Unique per language+id to avoid exact duplicates
                const key = `${rawLanguage}-${id}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    subtitles.push({
                        language,
                        pageUrl: `${BASE_URL}${subtitlePath}`,
                        downloadUrl: `${BASE_URL}${downloadUrl}`,
                        id
                    });
                }
            }
        }

        console.log('[Subtitles] Found:', subtitles.length, 'subtitles');

        // Sort: Spanish first, then alphabetically
        subtitles.sort((a, b) => {
            const aIsSpanish = a.language.toLowerCase().includes('spanish');
            const bIsSpanish = b.language.toLowerCase().includes('spanish');
            if (aIsSpanish && !bIsSpanish) return -1;
            if (!aIsSpanish && bIsSpanish) return 1;
            return a.language.localeCompare(b.language);
        });

        // Deduplicate by language (keep first of each)
        const uniqueByLang = [];
        const seenLangs = new Set();
        for (const sub of subtitles) {
            const lang = sub.language.toLowerCase();
            if (!seenLangs.has(lang)) {
                seenLangs.add(lang);
                uniqueByLang.push(sub);
            }
        }

        console.log('[Subtitles] Unique languages:', uniqueByLang.length);
        return uniqueByLang;

    } catch (error) {
        console.error('[Subtitles] Error fetching:', error.message);
        return [];
    }
}

/**
 * Download and extract subtitle - uses direct download URL
 * @param {string} downloadUrl - Direct ZIP download URL
 * @returns {Promise<string>} Subtitle content as UTF-8 string
 */
async function downloadSubtitle(downloadUrl) {
    console.log('[Subtitles] Downloading from:', downloadUrl);

    // Ensure subs directory exists
    fs.mkdirSync(SUBS_DIR, { recursive: true });

    try {
        // Download ZIP directly
        const zipBuffer = await fetchUrl(downloadUrl, true);
        console.log('[Subtitles] Downloaded ZIP, size:', zipBuffer.length, 'bytes');

        if (zipBuffer.length < 100) {
            throw new Error('Downloaded file too small, likely an error page');
        }

        // Extract SRT from ZIP
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        const srtEntry = entries.find(e =>
            e.entryName.toLowerCase().endsWith('.srt') &&
            !e.entryName.startsWith('__MACOSX')
        );

        if (!srtEntry) {
            console.log('[Subtitles] ZIP entries:', entries.map(e => e.entryName).join(', '));
            throw new Error('No .srt file found in archive');
        }

        // Read and decode
        const buffer = srtEntry.getData();
        const content = decodeSubtitle(buffer);

        console.log('[Subtitles] Extracted:', srtEntry.entryName, '- Content length:', content.length);

        return content;

    } catch (error) {
        console.error('[Subtitles] Download error:', error.message);
        throw error;
    }
}

/**
 * Clear all subtitle files
 */
function clearSubtitles() {
    // Stop subtitle server if running
    stopSubtitleServer();

    if (fs.existsSync(SUBS_DIR)) {
        try {
            fs.rmSync(SUBS_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            console.log('[Subtitles] Cleared subs folder');
        } catch (e) {
            console.warn('[Subtitles] Error clearing subs:', e.message);
        }
    }

    // Reset state
    currentVttContent = null;
}

// --- Chromecast Subtitle Support ---
const networkUtils = require('./network-utils');

let subtitleServer = null;
let subtitleServerPort = null;
let currentVttContent = null;

/**
 * Convert SRT content to WebVTT format
 * @param {string} srtContent - SRT subtitle content
 * @returns {string} WebVTT content
 */
function srtToVtt(srtContent) {
    // Add WebVTT header
    let vtt = 'WEBVTT\n\n';

    // Normalize line endings
    let content = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into blocks
    const blocks = content.split(/\n\n+/);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        // Find timestamp line (contains -->)
        let timestampIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->')) {
                timestampIndex = i;
                break;
            }
        }

        if (timestampIndex === -1) continue;

        // Convert SRT timestamp format (00:00:00,000) to VTT format (00:00:00.000)
        const timestamp = lines[timestampIndex].replace(/,/g, '.');

        // Get subtitle text (lines after timestamp)
        const text = lines.slice(timestampIndex + 1).join('\n');

        if (text.trim()) {
            vtt += `${timestamp}\n${text}\n\n`;
        }
    }

    return vtt;
}

/**
 * Start HTTP server to serve subtitles for Chromecast
 * @param {string} srtContent - SRT subtitle content to serve
 * @returns {Promise<number>} Server port
 */
function startSubtitleServer(srtContent) {
    return new Promise((resolve, reject) => {
        // Convert to VTT
        currentVttContent = srtToVtt(srtContent);
        console.log('[Subtitles] Converted to VTT, length:', currentVttContent.length);

        // Close existing server
        if (subtitleServer) {
            try {
                subtitleServer.close();
            } catch (e) { }
            subtitleServer = null;
        }

        // Create HTTP server
        subtitleServer = http.createServer((req, res) => {
            console.log(`[Subtitles] Request: ${req.method} ${req.url}`);

            // Handle CORS preflight
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Range',
                    'Access-Control-Max-Age': '86400'
                });
                res.end();
                return;
            }

            // Serve VTT file
            if (req.url === '/subtitles.vtt' || req.url === '/') {
                res.writeHead(200, {
                    'Content-Type': 'text/vtt; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Range',
                    'Cache-Control': 'no-cache'
                });
                res.end(currentVttContent);
                console.log('[Subtitles] Served VTT file');
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        // Handle errors
        subtitleServer.on('error', (err) => {
            console.error('[Subtitles] Server error:', err);
            reject(err);
        });

        // Listen on random port, bind to 0.0.0.0 for LAN access
        subtitleServer.listen(0, '0.0.0.0', () => {
            subtitleServerPort = subtitleServer.address().port;
            console.log(`[Subtitles] Server started on 0.0.0.0:${subtitleServerPort}`);
            resolve(subtitleServerPort);
        });
    });
}

/**
 * Stop subtitle server
 */
function stopSubtitleServer() {
    if (subtitleServer) {
        try {
            subtitleServer.removeAllListeners();
            subtitleServer.close();
            console.log('[Subtitles] Server stopped');
        } catch (e) { }
        subtitleServer = null;
        subtitleServerPort = null;
    }
}

/**
 * Get subtitle URL for Chromecast (uses local IP)
 * @returns {string|null} Subtitle URL or null if no server running
 */
function getSubtitleUrl() {
    if (!subtitleServer || !subtitleServerPort) {
        return null;
    }

    const localIP = networkUtils.getLocalIP();
    const url = `http://${localIP}:${subtitleServerPort}/subtitles.vtt`;
    console.log(`[Subtitles] Cast URL: ${url}`);
    return url;
}

/**
 * Prepare subtitles for cast - downloads, converts, and starts server
 * @param {string} downloadUrl - Direct ZIP download URL
 * @returns {Promise<string|null>} Subtitle URL for cast or null on failure
 */
async function prepareSubtitlesForCast(downloadUrl) {
    try {
        console.log('[Subtitles] Preparing for cast...');

        // Download and extract SRT
        const srtContent = await downloadSubtitle(downloadUrl);

        if (!srtContent || srtContent.length < 10) {
            console.warn('[Subtitles] No valid subtitle content');
            return null;
        }

        // Start server with VTT content
        await startSubtitleServer(srtContent);

        // Return URL
        return getSubtitleUrl();

    } catch (error) {
        console.error('[Subtitles] prepareSubtitlesForCast error:', error);
        return null;
    }
}

module.exports = {
    getAvailableSubtitles,
    downloadSubtitle,
    clearSubtitles,
    srtToVtt,
    startSubtitleServer,
    stopSubtitleServer,
    getSubtitleUrl,
    prepareSubtitlesForCast,
    SUBS_DIR
};


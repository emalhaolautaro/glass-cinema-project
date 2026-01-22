const Store = require('electron-store');
const path = require('path');
const { DATA_ROOT, STORE_FILENAME } = require('./paths');

let store;

function init() {
    if (store) return;

    try {
        console.log('[StoreManager] Initializing store...');
        // Handle both CommonJS and potentially default export
        const StoreConstructor = Store.default || Store;

        const settingsDir = path.join(DATA_ROOT, 'settings');
        const cacheDir = path.join(DATA_ROOT, 'cache'); // New: Define cache directory

        // Ensure directories exist
        const fs = require('fs');
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
        // New: Ensure cache directory exists
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        store = new StoreConstructor({
            cwd: settingsDir, // Store settings in app_data/settings/
            name: 'user-settings',
            defaults: {
                favorites: [],
                watchlist: [],
                downloads: []
            }
        });
        console.log('[StoreManager] Store initialized successfully at:', store.path);

        // Clear metadata cache on startup (session-only cache)
        clearMetadataCache();
    } catch (err) {
        console.error('[StoreManager] Initialization error:', err);
    }
}

/**
 * Clear metadata cache (called on app startup)
 * Makes metadata cache session-only for fresh data each launch
 */
function clearMetadataCache() {
    const fs = require('fs');
    const cachePath = path.join(DATA_ROOT, 'cache', 'metadata.json');
    try {
        if (fs.existsSync(cachePath)) {
            fs.writeFileSync(cachePath, '{}');
            console.log('[StoreManager] Metadata cache cleared for new session');
        }
    } catch (error) {
        console.warn('[StoreManager] Error clearing metadata cache:', error.message);
    }
}

// --- Metadata Cache (OMDb) ---
function getMetadata(imdbId) {
    const fs = require('fs');
    const cachePath = path.join(DATA_ROOT, 'cache', 'metadata.json');
    try {
        if (fs.existsSync(cachePath)) {
            const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            if (cache && cache[imdbId]) {
                // Optional: Check TTL here if we wanted expiration
                return cache[imdbId];
            }
        }
    } catch (error) {
        // Valid to fail silently if cache doesn't exist or is corrupt
        console.warn('[StoreManager] Error reading metadata cache:', error.message);
    }
    return null;
}

function saveMetadata(imdbId, data) {
    const fs = require('fs');
    const cacheDir = path.join(DATA_ROOT, 'cache');
    const cachePath = path.join(cacheDir, 'metadata.json');

    try {
        // Ensure dir exists (should be handled by init, but good to be safe)
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        let cache = {};
        if (fs.existsSync(cachePath)) {
            try {
                cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            } catch (e) {
                console.warn('[StoreManager] Metadata cache file corrupt, resetting:', e.message);
                cache = {}; // Reset if corrupt
            }
        }

        cache[imdbId] = {
            ...data,
            _cachedAt: Date.now()
        };

        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        return true;
    } catch (error) {
        console.error('[StoreManager] Error saving metadata cache:', error);
        return false;
    }
}

function getAllDownloads() {
    if (!store) init();
    return store.get('downloads', []);
}

function addDownload(movie, localPath) {
    if (!store) init();
    const downloads = store.get('downloads', []);

    const existingIndex = downloads.findIndex(d => d.infoHash === movie.infoHash);

    const downloadEntry = {
        title: movie.title,
        year: movie.year,
        infoHash: movie.infoHash,
        posterUrl: movie.coverUrl, // We'll store local path later if needed, store relative path?
        localPath: localPath, // Absolute path or relative to USER_DATA
        addedAt: Date.now(),
        genres: movie.genres || [] // Persist genres
    };

    if (existingIndex !== -1) {
        downloads[existingIndex] = downloadEntry;
    } else {
        downloads.push(downloadEntry);
    }

    store.set('downloads', downloads);
}

function removeDownload(infoHash) {
    if (!store) init();
    const downloads = store.get('downloads', []);
    const newDownloads = downloads.filter(d => d.infoHash !== infoHash);
    store.set('downloads', newDownloads);
}

function toggleMovieInList(listName, movie) {
    if (!store) init(); // Auto-init if not ready, though explicit init is better
    const list = store.get(listName, []);
    // Identify by infoHash if available (torrent), otherwise by title+year or imdb_code
    // Ideally we want a unique ID. Using infoHash for torrents is best.
    const hasHash = !!movie.infoHash;

    const index = list.findIndex(m => {
        if (hasHash && m.infoHash) return m.infoHash === movie.infoHash;
        return m.title === movie.title && m.year === movie.year;
    });

    let added = false;
    if (index === -1) {
        // User requested to store ALL data to avoid missing torrents/props
        const entry = { ...movie };

        // Ensure critical fields exist if they were derived
        if (!entry.infoHash) entry.infoHash = movie.infoHash || (movie.torrents?.[0]?.hash);
        if (!entry.magnet) entry.magnet = movie.magnet || (movie.torrents?.[0]?.hash ? `magnet:?xt=urn:btih:${movie.torrents[0].hash}&dn=${encodeURIComponent(movie.title)}` : null);
        if (!entry.addedAt) entry.addedAt = Date.now();

        list.push(entry);
        added = true;
    } else {
        // Remove
        list.splice(index, 1);
        added = false;
    }

    store.set(listName, list);
    return { success: true, added, list };
}

function toggleFavorite(movie) {
    return toggleMovieInList('favorites', movie);
}

function toggleWatchlist(movie) {
    return toggleMovieInList('watchlist', movie);
}

function getLibrary() {
    if (!store) init();
    return {
        favorites: store.get('favorites') || [],
        watchlist: store.get('watchlist') || []
    };
}

function checkStatus(movie) {
    if (!store) init();
    const favorites = store.get('favorites', []);
    const watchlist = store.get('watchlist', []);

    const findMovie = (list) => {
        return list.some(m => {
            if (movie.infoHash && m.infoHash) return m.infoHash === movie.infoHash;
            // Fallback for check
            if (movie.torrents && movie.torrents[0] && m.infoHash) return m.infoHash === movie.torrents[0].hash;

            return m.title === movie.title && m.year === movie.year;
        });
    }

    return {
        isFavorite: findMovie(favorites),
        inWatchlist: findMovie(watchlist),
        isDownloaded: findMovie(store.get('downloads', []))
    };
}

module.exports = {
    init,
    toggleFavorite,
    toggleWatchlist,
    getLibrary,
    checkStatus,
    addDownload,
    removeDownload,
    getAllDownloads,
    getMetadata,
    saveMetadata
};

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    searchMovies: (query) => ipcRenderer.invoke('search-movies', query),
    closeApp: () => ipcRenderer.send('app-close'),
    minimizeApp: () => ipcRenderer.send('app-minimize'),
    toggleMaximize: () => ipcRenderer.send('app-maximize'),
    getApiUrl: () => ipcRenderer.invoke('get-env', 'MOVIE_API_URL'),
    getTmdbApiKey: () => ipcRenderer.invoke('get-env', 'TMDB_API_KEY'),
    // Player
    startStream: (magnet) => ipcRenderer.send('start-stream', magnet),
    stopStream: () => ipcRenderer.send('stop-stream'),
    onStreamReady: (callback) => ipcRenderer.on('stream-ready', (event, url) => callback(url)),
    onLoadLocalSubtitle: (callback) => ipcRenderer.on('load-local-subtitle', (event, url) => callback(url)),
    playLocal: (infoHash) => ipcRenderer.invoke('play-local', infoHash), // New Offline Playback IPC
    // Offline Downloads
    startDownload: (movie, subtitleUrl) => ipcRenderer.send('start-download', { movie, subtitleUrl }),
    getDownloads: () => ipcRenderer.invoke('get-downloads'),
    removeDownload: (infoHash) => ipcRenderer.invoke('remove-download', infoHash),
    cancelDownload: (infoHash) => ipcRenderer.invoke('cancel-download', infoHash),
    checkDownloadStatus: (infoHash) => ipcRenderer.invoke('check-download-status', infoHash),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)), // data = { infoHash, percentage, stats }
    onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),


    // Subtitles
    fetchMovieSubs: (imdbId) => ipcRenderer.invoke('fetch-movie-subs', imdbId),
    loadSelectedSub: (pageUrl) => ipcRenderer.invoke('load-selected-sub', pageUrl),
    clearSubtitles: () => ipcRenderer.send('clear-subtitles'),

    // Chromecast
    requestCastDiscovery: () => ipcRenderer.send('request-cast-discovery'),
    stopCastDiscovery: () => ipcRenderer.send('stop-cast-discovery'),
    getCastDevices: () => ipcRenderer.invoke('get-cast-devices'),
    selectCastDevice: (deviceName, movieInfo) => ipcRenderer.send('cast-device-selected', { deviceName, movieInfo }),
    stopCasting: () => ipcRenderer.send('stop-casting'),
    isCasting: () => ipcRenderer.invoke('is-casting'),
    getActiveCastDevice: () => ipcRenderer.invoke('get-active-cast-device'),

    // Cast playback controls
    castPause: () => ipcRenderer.send('cast-pause'),
    castResume: () => ipcRenderer.send('cast-resume'),
    castSeek: (seconds) => ipcRenderer.send('cast-seek', seconds),
    castVolume: (level) => ipcRenderer.send('cast-volume', level),

    // Cast event listeners
    onCastDeviceFound: (callback) => ipcRenderer.on('cast-device-found', (event, device) => callback(device)),
    onCastConnected: (callback) => ipcRenderer.on('cast-connected', (event, deviceName) => callback(deviceName)),
    onCastError: (callback) => ipcRenderer.on('cast-error', (event, error) => callback(error)),
    onCastStopped: (callback) => ipcRenderer.on('cast-stopped', () => callback()),
    onCastStatus: (callback) => ipcRenderer.on('cast-status', (event, status) => callback(status)),
    onCastMuteLocal: (callback) => ipcRenderer.on('cast-mute-local', () => callback()),

    // Store / Library
    store: {
        toggleFavorite: (movie) => ipcRenderer.invoke('store-toggle-favorite', movie),
        toggleWatchlist: (movie) => ipcRenderer.invoke('store-toggle-watchlist', movie),
        getLibrary: () => ipcRenderer.invoke('store-get-library'),
        getAllDownloads: () => ipcRenderer.invoke('get-downloads'),
        checkStatus: (movie) => ipcRenderer.invoke('store-check-status', movie),
        // New Metadata Cache
        getMetadata: (imdbId) => ipcRenderer.invoke('get-metadata', imdbId),
        saveMetadata: (imdbId, data) => ipcRenderer.send('save-metadata', { imdbId, data })
    }
});

const { ipcMain } = require('electron');
const storeManager = require('../store-manager');
const subtitles = require('../subtitles');
const networkUtils = require('../network-utils');

function register() {
    ipcMain.handle('get-env', (event, key) => process.env[key]);
    ipcMain.handle('get-local-ip', () => networkUtils.getLocalIP());

    ipcMain.handle('store-toggle-favorite', (event, movie) => storeManager.toggleFavorite(movie));
    ipcMain.handle('store-toggle-watchlist', (event, movie) => storeManager.toggleWatchlist(movie));
    ipcMain.handle('store-get-library', async () => storeManager.getLibrary());
    ipcMain.handle('store-check-status', (event, movie) => storeManager.checkStatus(movie));

    ipcMain.handle('get-metadata', (event, imdbId) => storeManager.getMetadata(imdbId));
    ipcMain.on('save-metadata', (event, { imdbId, data }) => storeManager.saveMetadata(imdbId, data));

    ipcMain.handle('fetch-movie-subs', async (event, imdbId) => subtitles.getAvailableSubtitles(imdbId));
    ipcMain.handle('load-selected-sub', async (event, pageUrl) => subtitles.downloadSubtitle(pageUrl));
    ipcMain.on('clear-subtitles', () => subtitles.clearSubtitles());
}

module.exports = { register };

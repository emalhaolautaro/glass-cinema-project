const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// PORTABLE MODE CONFIGURATION
// We use process.cwd() instead of app.getPath('userData')
// This keeps all data inside the application folder
const DATA_ROOT = path.join(process.cwd(), 'app_data');

// Ensure data root exists immediately
if (!fs.existsSync(DATA_ROOT)) {
    try {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
    } catch (e) {
        console.error('Failed to create portable data root:', e);
    }
}

const CACHE_DIR = path.join(DATA_ROOT, 'cache');
const STORE_FILENAME = 'user-settings'; // electron-store adds .json, we just need name here usually, but keeping consistent

// Update app userData path to ensure internal Electron files also go here (optional but recommended for true portability)
// app.setPath('userData', DATA_ROOT); // Note: Must be called before app 'ready'

module.exports = {
    DATA_ROOT,
    CACHE_DIR,
    DOWNLOADS_DIR: path.join(DATA_ROOT, 'downloads'),
    STORE_FILENAME
};

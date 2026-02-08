/**
 * Global App State and DOM Elements
 */

const App = {
    state: {
        movies: [],
        currentMovie: null,
        availableSubtitles: [],
        currentSubtitleUrl: null,
        downloadProgress: 0,
        apiUrl: null,
        // Pagination for infinite scroll
        currentPage: 1,
        isLoadingMore: false,
        hasMoreMovies: true
    },

    dom: {
        // Main Grid
        grid: document.getElementById('movies-grid'),

        // Modal
        modal: {
            backdrop: document.getElementById('modal-backdrop'),
            close: document.getElementById('modal-close'),
            poster: document.getElementById('m-poster'),
            title: document.getElementById('m-title'),
            year: document.getElementById('m-year'),
            rating: document.getElementById('m-rating'),
            runtime: document.getElementById('m-runtime'),
            synopsis: document.getElementById('m-synopsis'),
            playBtn: document.getElementById('btn-play'),
            castBtn: document.getElementById('btn-cast')
        },

        // Player
        player: {
            view: document.getElementById('player-view'),
            video: document.getElementById('player-video'),
            loader: document.getElementById('player-loader'),
            closeBtn: document.getElementById('player-close'),
            playPauseBtn: document.getElementById('p-play-pause'),
            progressBar: document.getElementById('p-progress-bar'),
            bufferBar: document.getElementById('p-buffer-bar'),
            progressContainer: document.getElementById('p-progress-container'),
            timeDisplay: document.getElementById('p-time'),
            volumeSlider: document.getElementById('p-volume'),
            fullscreenBtn: document.getElementById('p-fullscreen'),
            subtitlesBtn: document.getElementById('p-subtitles'),
            subtitleMenu: document.getElementById('subtitle-menu'),
            subtitleMenuList: document.getElementById('subtitle-menu-list'),
            subtitleMenuClose: document.getElementById('subtitle-menu-close'),
            subtitleOverlay: document.getElementById('subtitle-drop-overlay')
        },

        // Navigation / Search
        search: {
            input: document.querySelector('.search-input'),
            button: document.querySelector('.search-button'),
            genre: document.getElementById('filter-genre'),
            sort: document.getElementById('filter-sort')
        },

        // Window Controls
        window: {
            close: document.getElementById('btn-close'),
            minimize: document.getElementById('btn-minimize'),
            maximize: document.getElementById('btn-maximize')
        }
    }
};

console.log('[Globals] Initialized');

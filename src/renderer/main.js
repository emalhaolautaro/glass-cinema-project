/**
 * Main Application Entry Point
 */

const Main = {
    async init() {
        console.log('[Main] Initializing...');

        // Initialize other modules
        Toast.init();
        CastModal.init();
        DownloadModal.init();
        ConfirmModal.init(); // New Confirm Modal
        UI.init();
        Library.init();
        Player.init();
        Subtitles.init();

        // Setup Window Controls
        this.setupWindowControls();

        // Setup Search
        this.setupSearch();

        // Setup Navigation
        this.setupNavigation();

        // Setup Modal Logic (Override default UI behavior)
        this.setupModalLogic();

        // Get API URL and fetch initial movies
        App.state.apiUrl = await window.api.getApiUrl();
        this.fetchMovies();

        // Setup infinite scroll
        this.setupInfiniteScroll();

        console.log('[Main] Ready');
    },

    setupInfiniteScroll() {
        const sentinel = document.createElement('div');
        sentinel.id = 'scroll-sentinel';
        sentinel.style.height = '1px';
        App.dom.grid.after(sentinel);

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && App.state.hasMoreMovies && !App.state.isLoadingMore) {
                const query = App.dom.search.input.value.trim();
                this.fetchMovies(query, true);
            }
        }, { rootMargin: '300px' });

        observer.observe(sentinel);
    },

    setupWindowControls() {
        const w = App.dom.window;
        w.close?.addEventListener('click', () => window.api.closeApp());
        w.minimize?.addEventListener('click', () => window.api.minimizeApp());
        w.maximize?.addEventListener('click', () => window.api.toggleMaximize());
    },

    setupNavigation() {
        const navHome = document.getElementById('nav-home');
        const navLibrary = document.getElementById('nav-library');
        const navDownloads = document.getElementById('nav-downloads');

        // Views - Reusing library view container for downloads or creating a new one?
        // Let's assume we reuse the library view structure but change the content source
        // effectively making "My Library" have two sub-modes or just swapping content.
        // For simplicity: Reuse view-library container but change what we load into it.
        const viewHome = document.getElementById('view-home');
        const viewLibrary = document.getElementById('view-library');

        const switchView = (mode) => {
            // mode: 'home', 'library', 'downloads'

            navHome.classList.toggle('active', mode === 'home');
            navLibrary.classList.toggle('active', mode === 'library');
            navDownloads.classList.toggle('active', mode === 'downloads');

            if (mode === 'home') {
                viewHome.style.display = 'block';
                viewLibrary.style.display = 'none';
                viewHome.classList.add('active');
            } else {
                viewHome.style.display = 'none';
                viewLibrary.style.display = 'block';

                if (mode === 'library') {
                    Library.load('favorites'); // Load favorites by default for Library
                } else if (mode === 'downloads') {
                    Library.load('downloads'); // New mode for Library.load
                }
            }
        };

        navHome.addEventListener('click', () => switchView('home'));
        navLibrary.addEventListener('click', () => switchView('library'));
        navDownloads.addEventListener('click', () => switchView('downloads'));

        // Ensure correct initial state logic
        if (viewHome.style.display !== 'none') {
            navHome.classList.add('active');
            navLibrary.classList.remove('active');
        }
    },

    setupSearch() {
        const s = App.dom.search;
        s.button.addEventListener('click', () => this.handleSearch());
        s.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        // Filter change handlers
        s.genre.addEventListener('change', () => this.handleSearch());
        s.sort.addEventListener('change', () => this.handleSearch());
    },

    handleSearch() {
        const query = App.dom.search.input.value.trim();
        this.fetchMovies(query);
    },

    async fetchMovies(query = '', append = false) {
        if (!App.state.apiUrl) return;

        // Guard against duplicate loads
        if (append && App.state.isLoadingMore) return;
        if (append && !App.state.hasMoreMovies) return;

        if (append) {
            App.state.isLoadingMore = true;
        } else {
            App.state.currentPage = 1;
            App.state.hasMoreMovies = true;
        }

        if (App.state.fetchController) {
            App.state.fetchController.abort();
        }
        App.state.fetchController = new AbortController();
        const signal = App.state.fetchController.signal;

        try {
            if (!append) {
                App.dom.grid.style.opacity = '0.5';
                App.dom.grid.style.transition = 'opacity 0.3s ease';
                UI.showSkeletons(10);
            }

            const genre = App.dom.search.genre.value;
            const sort = App.dom.search.sort.value;

            const params = new URLSearchParams({
                limit: 20,
                page: App.state.currentPage,
                sort_by: sort,
                ...(query && { query_term: query }),
                ...(genre && { genre: genre })
            });

            const url = `${App.state.apiUrl}?${params.toString()}`;
            if (url.startsWith('https://yts.bz/https://yts.bz')) {
                console.error('[Main] Detected malformed URL:', url);
                App.state.apiUrl = 'https://yts.bz/api/v2/list_movies.json';
                return this.fetchMovies(query);
            }
            console.log('[Main] Fetching:', url);

            const timeoutId = setTimeout(() => {
                if (App.state.fetchController) {
                    App.state.fetchController.abort();
                    Toast.show('La conexión es muy lenta, reintentando...', 'warning');
                }
            }, 8000);

            const res = await fetch(url, { signal });
            clearTimeout(timeoutId);

            const data = await res.json();

            if (data?.data?.movies) {
                const newMovies = data.data.movies;

                if (append) {
                    App.state.movies = [...App.state.movies, ...newMovies];
                    UI.appendToGrid(newMovies);
                } else {
                    App.state.movies = newMovies;
                    UI.renderGrid(newMovies);
                }

                App.state.currentPage++;
                App.state.hasMoreMovies = newMovies.length === 20;

                this.enrichMovies(newMovies);
            } else if (query && !append) {
                UI.showEmptyState(query);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[Main] Fetch aborted');
            } else {
                console.error('[Main] Fetch error:', e);
                if (!append) UI.showError(e.message);
                Toast.show(`Connection Error: ${e.message}`, 'error');
            }
        } finally {
            App.dom.grid.style.opacity = '1';
            App.state.fetchController = null;
            App.state.isLoadingMore = false;
        }
    },

    /**
     * Enrich movies with metadata from TMDb
     * Delegates all complexity to MetadataService
     */
    async enrichMovies(movies) {
        if (!movies || movies.length === 0) return;

        // Delegate to MetadataService with progressive UI updates
        await MetadataService.enrichBatch(
            movies,
            (imdbCode, metadata) => UI.updateCard(imdbCode, metadata),
            5 // Batch size
        );
    },

    setupModalLogic() {
        // Override UI's openModal to attach our play handler
        const originalOpen = UI.openModal;
        UI.openModal = async (movie) => {
            originalOpen.call(UI, movie); // Call original to show UI
            App.state.currentMovie = movie; // Ensure state is set for Modals

            // --- Persistence Logic ---
            const btnLike = document.getElementById('btn-like');
            const btnWatchLater = document.getElementById('btn-watch-later');

            // Update Download Button using helper
            this.updateDownloadButton(movie);

            // Reset buttons state
            btnLike.classList.remove('active');
            btnWatchLater.classList.remove('active');

            // --- Quality Selection Logic ---
            const qualitiesContainer = document.getElementById('m-qualities');
            qualitiesContainer.innerHTML = ''; // Clear previous

            // Prepare list of qualities
            let availableTorrents = [];
            if (movie.torrents && movie.torrents.length > 0) {
                // Sort by quality (4k > 1080p > 720p > 3D) - crude sort
                availableTorrents = [...movie.torrents].sort((a, b) => {
                    const order = { '2160p': 4, '1080p': 3, '720p': 2, '3D': 1 };
                    return (order[b.quality] || 0) - (order[a.quality] || 0);
                });
            } else if (movie.magnet) {
                // Legacy/Library fallback
                availableTorrents = [{ quality: 'Default', hash: movie.infoHash, url: movie.magnet, isDefault: true }];
            }

            // Select default (1080p or first)
            let selectedT = availableTorrents.find(t => t.quality === '1080p') || availableTorrents[0];
            // Store initially selected
            App.state.selectedTorrent = selectedT;

            if (availableTorrents.length > 0) {
                availableTorrents.forEach(t => {
                    const chip = document.createElement('div');
                    chip.className = `quality-chip ${t === selectedT ? 'active' : ''}`;
                    chip.textContent = t.quality || 'Unk';

                    chip.onclick = () => {
                        // UI Update
                        document.querySelectorAll('.quality-chip').forEach(c => c.classList.remove('active'));
                        chip.classList.add('active');

                        // Logic Update
                        App.state.selectedTorrent = t;
                        console.log('[Main] Selected Quality:', t.quality, t.hash);

                        // Update download button state immediately for the new selection
                        this.updateDownloadButton(movie);
                    };
                    qualitiesContainer.appendChild(chip);
                });
            } else {
                qualitiesContainer.innerHTML = '<span style="color:#666; font-size: 0.8rem;">No quality options</span>';
            }

            // Perform status check for Favorites/Watchlist
            try {
                const status = await window.api.store.checkStatus(movie);
                if (status.isFavorite) btnLike.classList.add('active');
                if (status.inWatchlist) btnWatchLater.classList.add('active');
            } catch (e) {
                console.error('Error checking status:', e);
            }

            // Bind handlers
            btnLike.onclick = async () => {
                const res = await window.api.store.toggleFavorite(movie);
                if (res && res.success) {
                    btnLike.classList.toggle('active', res.added);
                    Toast.show(res.added ? 'Añadido a Favoritos' : 'Eliminado de Favoritos');
                    if (!res.added && document.getElementById('view-library').style.display === 'block') {
                        Library.load();
                    }
                }
            };

            btnWatchLater.onclick = async () => {
                const res = await window.api.store.toggleWatchlist(movie);
                if (res && res.success) {
                    btnWatchLater.classList.toggle('active', res.added);
                    Toast.show(res.added ? 'Añadido a Ver más tarde' : 'Eliminado de Ver más tarde');
                    if (!res.added && document.getElementById('view-library').style.display === 'block') {
                        Library.load();
                    }
                }
            };

            // Update Download Button immediately with default selection
            this.updateDownloadButton(movie);

            // Attach Main's play logic
            App.dom.modal.playBtn.onclick = () => this.playMovie(movie);

            // Attach Cast button handler - Cast DIRECTLY without local playback
            App.dom.modal.castBtn.onclick = () => {
                console.log('[Main] Cast button clicked - preparing stream for cast only');

                // Store movie for cast use
                App.state.currentMovie = movie;
                App.state.pendingCastMovie = movie;

                // Show cast modal FIRST while stream prepares in background
                CastModal.show();

                // Prepare stream in background (no UI changes)
                this.prepareStreamForCast(movie);
            };
        };
    },

    async playMovie(movie) {
        console.log(`[Main] Playing: ${movie.title}`);

        UI.closeModal();
        UI.showPlayer();
        UI.showLoader();

        // cleanup
        Player.reset();
        Subtitles.clearTracks();
        window.api.clearSubtitles();

        // Start Stream
        // Start Stream
        // Use user selected torrent/quality if available, otherwise fallback
        let selected = App.state.selectedTorrent;

        console.log(`[Main] Playing Quality: ${selected ? selected.quality : 'Default'}`);

        let magnet = selected ? (selected.url || selected.magnet) : movie.magnet;

        // If selected torrent has hash but no magnet url constructed yet
        if (selected && !magnet && selected.hash) {
            magnet = `magnet:?xt=urn:btih:${selected.hash}&dn=${encodeURIComponent(movie.title)}`;
        }

        // Fallback logic if still no magnet
        if (!magnet && movie.torrents && movie.torrents.length > 0) {
            console.log('[Main] Constructing magnet from torrents list (Fallback)');
            const torrent = movie.torrents.find(t => t.quality === '1080p') || movie.torrents[0];
            if (torrent && torrent.hash) {
                magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;
            }
        }

        // Final Fallback: InfoHash from Movie Object (common in stored downloads)
        if (!magnet && movie.infoHash) {
            console.log('[Main] Constructing magnet from InfoHash (Storage Fallback)');
            magnet = `magnet:?xt=urn:btih:${movie.infoHash}&dn=${encodeURIComponent(movie.title)}`;
        }

        if (!magnet) {
            console.error('[Main] No torrent/magnet found. Movie object:', movie);
            alert("No se encontró un torrent para esta película (Intenta removerla y volverla a agregar a la biblioteca)");
            UI.hidePlayer();
            UI.hideLoader();
            return;
        }

        // Check if downloaded first
        if (movie.infoHash) {
            const status = await window.api.checkDownloadStatus(movie.infoHash);
            if (status.isDownloaded) {
                console.log('[Main] Movie is downloaded. Starting Local Playback...');
                const { videoUrl, subtitleUrl } = await window.api.playLocal(movie.infoHash);

                if (videoUrl) {
                    // Set video source directly
                    const video = document.querySelector('video');
                    video.src = videoUrl;
                    video.play();

                    // Load local subtitle if available
                    if (subtitleUrl) {
                        console.log('[Main] Loading local subtitle:', subtitleUrl);

                        const label = `${movie.subtitleLanguage || 'Subtítulos'} (Descargado)`;
                        Subtitles.setLocalTrack(subtitleUrl, label);

                        // 2. Update Subtitle Menu State
                        App.state.availableSubtitles = [{
                            language: label,
                            downloadUrl: subtitleUrl,
                            isLocal: true,
                            id: 'local-sub'
                        }];
                    } else {
                        App.state.availableSubtitles = [];
                    }

                    UI.hideLoader();
                    return; // EXIT HERE, do not start torrent stream
                }
            }
        }

        window.api.startStream(magnet);

        // Fetch Subtitles (Only if NOT local - or if local didn't have subs, but we assume local has them if downloaded)
        // Actually, if we played local, we returned above. So this only runs for streaming.
        if (movie.imdb_code) {
            console.log(`[Main] Movie has IMDB code: ${movie.imdb_code} - Fetching subtitles...`);
            await Subtitles.fetchForMovie(movie.imdb_code);
        } else {
            console.warn(`[Main] NO IMDB Code found for ${movie.title} - Skipping subtitles.`);
        }
    },

    async updateDownloadButton(movie) {
        const btn = document.getElementById('btn-download');
        if (!btn) return;

        // Clean previous listeners/state
        btn.onclick = null;

        // Get currently selected torrent/quality info
        const selected = App.state.selectedTorrent;
        // Identify by infoHash of the SELECTED quality
        const targetHash = selected ? (selected.hash || selected.infoHash || movie.infoHash) : (movie.infoHash);

        if (!targetHash) {
            console.warn('[Main] No infoHash found for download button update');
            btn.style.display = 'none';
            return;
        }
        btn.style.display = 'flex';

        const status = await window.api.checkDownloadStatus(targetHash);

        // Helper to set SVG progress
        const setProgress = (p) => {
            const radius = 20;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (p / 100) * circumference;
            return `
                <svg class="progress-ring" width="50" height="50">
                   <circle class="progress-ring__circle progress-ring__circle--progress"
                           stroke-width="3"
                           fill="transparent"
                           r="${radius}"
                           cx="25" cy="25"
                           style="stroke-dasharray: ${circumference} ${circumference}; stroke-dashoffset: ${offset};"
                           />
                </svg>
                <div class="download-icon">
                    <span style="font-size: 10px; font-weight: bold;">${p}%</span>
                </div>
            `;
        };

        if (status.isDownloaded) {
            // Delete State
            btn.className = 'delete-btn';
            btn.title = 'Eliminar descarga';
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

            btn.onclick = async (e) => {
                e.stopPropagation();
                ConfirmModal.show(
                    'Eliminar descarga',
                    '¿Estás seguro de que querés eliminar esta película de tu dispositivo?',
                    async () => {
                        await window.api.removeDownload(targetHash);
                        this.updateDownloadButton(movie);
                        Toast.show('Descarga eliminada');
                        // IF in downloads view, refresh
                        if (document.getElementById('lib-section-downloads').style.display === 'block') {
                            Library.load('downloads');
                        }
                    }
                );
            };
        } else if (status.isDownloading) {
            // Progress State
            btn.className = 'download-container'; // Restored class
            btn.title = 'Descargando... (Click para cancelar)';
            btn.innerHTML = setProgress(status.progress);

            btn.onclick = async (e) => {
                e.stopPropagation();
                ConfirmModal.show(
                    'Cancelar descarga',
                    '¿Deseas cancelar la descarga en curso?',
                    async () => {
                        await window.api.cancelDownload(targetHash);
                        this.updateDownloadButton(movie);
                        Toast.show('Descarga cancelada');
                    }
                );
            };

        } else {
            // Download State
            btn.className = 'action-btn'; // Restored class
            btn.title = 'Descargar';
            // Use inline SVG with black stroke to match original icon style (which was black in download.css)
            btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

            btn.onclick = async (e) => {
                e.stopPropagation();

                // Prepare object with SPECIFIC hash/magnet for this quality
                const movieToDownload = { ...movie };

                // Override critical fields with selected quality info
                movieToDownload.infoHash = targetHash;
                movieToDownload.magnet = selected ? (selected.url || `magnet:?xt=urn:btih:${selected.hash}&dn=${encodeURIComponent(movie.title)}`) : movie.magnet;
                // Save quality name for reference if needed
                movieToDownload.quality = selected ? selected.quality : 'Default';

                console.log('[Main] Starting Download:', movieToDownload.title, movieToDownload.quality, targetHash);

                // Open Download Modal instead of immediate download
                if (DownloadModal) {
                    // Update global state just in case (though we did it in openModal)
                    App.state.currentMovie = movieToDownload;
                    DownloadModal.show();
                } else {
                    console.error('DownloadModal not found, falling back');
                    window.api.startDownload(movieToDownload);
                }

                // Update UI immediately to 0%
                btn.className = 'download-container'; // Restored class
                btn.innerHTML = setProgress(0);

                // Re-bind to cancel
                this.updateDownloadButton(movie);
            };
        }
    },

    async prepareStreamForCast(movie) {
        console.log(`[Main] Preparing stream for cast: ${movie.title}`);

        App.state.castPendingMode = true;

        // FULL cleanup to prevent subtitle accumulation
        Subtitles.clearTracks();
        window.api.clearSubtitles();
        App.state.currentSubtitleUrl = null;
        App.state.availableSubtitles = [];
        if (App.state.failedSubtitles) {
            App.state.failedSubtitles.delete(movie.imdb_code);
        }

        // Start Stream
        const torrent = movie.torrents?.find(t => t.quality === '1080p') || movie.torrents?.[0];
        if (!torrent) {
            Toast.show('No hay torrent disponible para esta película', 'error');
            App.state.castPendingMode = false;
            return;
        }

        const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;

        // Start stream in background
        window.api.startStream(magnet);

        // Fetch and WAIT for Subtitles (important for cast)
        if (movie.imdb_code) {
            console.log('[Main] Fetching and waiting for subtitles for cast...');
            try {
                await Subtitles.fetchForMovie(movie.imdb_code);
                console.log('[Main] Subtitles ready for cast, URL:', App.state.currentSubtitleUrl);
            } catch (e) {
                console.warn('[Main] Subtitle fetch error:', e);
            }
        }

        console.log('[Main] Stream and subtitles preparation complete');
    }
};

// --- IPC Listeners ---

// Stream ready handler - SKIPS local playback if cast is pending
window.api.onStreamReady((url) => {
    console.log('[IPC] Stream ready:', url);

    // If we're waiting for cast, DON'T start local playback
    if (App.state.castPendingMode) {
        console.log('[IPC] Cast pending mode - skipping local playback');
        // Just store URL for reference, don't play
        App.state.streamUrl = url;
        return;
    }

    // Normal local playback
    App.dom.player.video.src = url;
    App.dom.player.video.play().catch(e => console.error(e));
    Player.updatePlayIcon(true);
});

window.api.onLoadLocalSubtitle((url) => {
    console.log('[IPC] Loading local subtitle:', url);
    fetch(url)
        .then(res => res.text())
        .then(vtt => {
            Subtitles.injectTrack(vtt, 'Descargado'); // "Descargado" or "Local"
            Toast.show('Subtítulos locales cargados');
        })
        .catch(e => console.error('[Main] Error loading local sub:', e));
});

window.api.onDownloadProgress((data) => {
    // data = { infoHash, percentage, stats }
    App.state.downloadProgress = data.percentage;

    // If current modal is looking at this movie, update button live
    if (App.state.currentMovie && App.state.currentMovie.infoHash === data.infoHash) {
        // Find button and update ring ONLY
        const btn = document.getElementById('btn-download');
        if (btn && btn.classList.contains('download-container')) {
            const circle = btn.querySelector('.progress-ring__circle');
            const text = btn.querySelector('.download-icon span');
            if (circle) {
                const radius = 20;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (data.percentage / 100) * circumference;
                circle.style.strokeDashoffset = offset;
            }
            if (text) text.textContent = `${data.percentage}%`;
        } else {
            // Transition from start state to progress state if needed
            // But Main.updateDownloadButton should have set class
            // Just re-call update to be safe
            Main.updateDownloadButton(App.state.currentMovie);
        }
    }
});

window.api.onDownloadComplete((data) => {
    Toast.show('Descarga completada');
    if (App.state.currentMovie && App.state.currentMovie.infoHash === data.infoHash) {
        Main.updateDownloadButton(App.state.currentMovie);
    }
});

// When cast connects successfully, show player in cast mode
window.api.onCastConnected((deviceName) => {
    console.log('[IPC] Cast connected:', deviceName);

    // Exit cast pending mode
    App.state.castPendingMode = false;

    // NOW show the player (in cast mode, not local playback)
    UI.closeModal();
    UI.showPlayer();
    UI.hideLoader();

    // Player will enter cast mode via its own listener
});

// When cast fails or stops, reset pending mode
window.api.onCastError((error) => {
    console.log('[IPC] Cast error:', error);
    App.state.castPendingMode = false;
});

window.api.onCastStopped(() => {
    console.log('[IPC] Cast stopped');
    App.state.castPendingMode = false;
});

// Start
document.addEventListener('DOMContentLoaded', () => {
    Main.init();
});

// --- Network Resilience ---
window.addEventListener('online', () => {
    Toast.show('Conexión restaurada', 'success');
    // Optional: Retry logic if needed
});

window.addEventListener('offline', () => {
    Toast.show('Sin conexión a internet', 'error');
});

// Audit Toast removed per request


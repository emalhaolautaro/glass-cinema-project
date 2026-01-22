/**
 * Download Modal Component
 * Subtitle selection before download
 */
const DownloadModal = {
    element: null,
    backdropEl: null,
    isOpen: false,

    /**
     * Initialize the Download Modal
     */
    init() {
        // Create modal structure
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'cast-modal-backdrop'; // Reuse cast modal styles for consistency
        this.backdropEl.innerHTML = `
            <div class="cast-modal" style="max-height: 400px; height: auto;">
                <div class="cast-modal-header">
                    <h3 class="cast-modal-title">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Descargar Película
                    </h3>
                    <button class="cast-modal-close">&times;</button>
                </div>
                <div class="cast-modal-body">
                    <p style="color: #ccc; margin-bottom: 20px;">
                        Seleccioná el idioma de los subtítulos para incluir en la descarga.
                        El video se guardará en tu carpeta de descargas.
                    </p>
                    
                    <!-- Subtitle Selector -->
                    <div class="cast-subtitle-section">
                        <label class="cast-subtitle-label">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                                <line x1="6" y1="12" x2="18" y2="12"></line>
                                <line x1="6" y1="16" x2="14" y2="16"></line>
                            </svg>
                            Subtítulos
                        </label>
                        <select class="cast-subtitle-select" id="download-subtitle-select">
                            <option value="">Cargando...</option>
                        </select>
                    </div>
                </div>
                <div class="cast-modal-footer">
                    <button class="cast-btn-cancel">Cancelar</button>
                    <button class="cast-btn-connect" id="btn-confirm-download">Iniciar Descarga</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.backdropEl);

        // Cache elements
        this.subtitleSelect = this.backdropEl.querySelector('#download-subtitle-select');
        this.confirmBtn = this.backdropEl.querySelector('#btn-confirm-download');

        // Register event handlers
        this.backdropEl.querySelector('.cast-modal-close').addEventListener('click', () => this.hide());
        this.backdropEl.querySelector('.cast-btn-cancel').addEventListener('click', () => this.hide());
        this.confirmBtn.addEventListener('click', () => this.startDownload());

        // Close on backdrop click
        this.backdropEl.addEventListener('click', (e) => {
            if (e.target === this.backdropEl) this.hide();
        });

        console.log('[DownloadModal] Initialized');
    },

    show() {
        if (this.isOpen) return;
        this.isOpen = true;

        this.fetchAttempted = false;
        this.populateSubtitles();
        this.backdropEl.classList.add('active');
    },

    hide() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.backdropEl.classList.remove('active');
    },

    populateSubtitles() {
        const select = this.subtitleSelect;
        select.innerHTML = '';

        // Add "No subtitles" option
        const noSubOption = document.createElement('option');
        noSubOption.value = '';
        noSubOption.textContent = 'Sin subtítulos';
        select.appendChild(noSubOption);

        const subs = App.state.availableSubtitles || [];

        if (subs.length === 0) {
            // Need to fetch or they are loading
            // If we are in detail view, subs should be fetched by main.js logic?
            // Actually main.js fetches subs only when play is clicked?
            // No, main.js fetches subs when modal opens? No, line 214 of main.js says "Fetch Subtitles" in playMovie.
            // Line 248 says "Fetch and WAIT... for cast".
            // We need to ensure subs are fetched. UI.openModal triggers fetch?
            // NO. Main.js's OPEN MODAL override handles buttons. It DOES NOT fetch subtitles.
            // We need to fetch subtitles when opening DownloadModal if not available.

            // Check if we need to display loading
            const loadingOption = document.createElement('option');
            loadingOption.value = '';
            loadingOption.textContent = 'Cargando opciones...';
            select.appendChild(loadingOption);

            // Trigger fetch if empty (and we have IMDB)
            // Trigger fetch if empty (and we have IMDB) and haven't failed
            if (App.state.currentMovie?.imdb_code) {
                // If we know it failed, stop.
                if (App.state.failedSubtitles && App.state.failedSubtitles.has(App.state.currentMovie.imdb_code)) {
                    select.innerHTML = '<option value="">Sin subtítulos (No encontrados)</option>';
                    return;
                }

                // If we haven't loaded them yet, try ONCE
                // We use a flag to prevent infinite re-tries within this modal session
                if (!this.fetchAttempted) {
                    this.fetchAttempted = true;
                    // Use the Subtitles module which handles state updates
                    Subtitles.fetchForMovie(App.state.currentMovie.imdb_code).then(() => {
                        // Re-run populate ONLY if successful or finished
                        this.populateSubtitles();
                    });
                } else {
                    // If we already attempted and length is still 0, allow simple "No subtitles" selection
                    // (The loop structure previously would just keep re-calling)
                    // If fetch finished and 0 results -> Subtitles module would set failedSubtitles
                    // If fetch still pending -> we might want to show loading? 
                    // For simplicity, we assume fetchForMovie awaits and finishes.
                }
            }
        } else {
            subs.forEach(sub => {
                const option = document.createElement('option');
                option.value = sub.downloadUrl;
                option.textContent = sub.language;
                select.appendChild(option);
            });

            // Auto-select Spanish
            let spanishSub = subs.find(s =>
                s.language.toLowerCase().includes('latin') ||
                s.language.toLowerCase().includes('latina')
            );
            if (!spanishSub) spanishSub = subs.find(s => s.language.toLowerCase().includes('spanish'));
            if (spanishSub) select.value = spanishSub.downloadUrl;
        }
    },

    async startDownload() {
        const movie = App.state.currentMovie;
        const subtitleUrl = this.subtitleSelect.value;

        console.log('[DownloadModal] Starting download:', movie.title);

        window.api.startDownload(movie, subtitleUrl);
        Toast.show('Descarga iniciada', 'success');
        this.hide();

        // Trigger UI update immediately? 
        // The main.js will listen to events and update buttons.
    }
};

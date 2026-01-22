/**
 * Subtitle Manager Module
 * Handles SRT to VTT conversion, drag/drop, and track injection
 */

export class SubtitleManager {
    constructor(videoElement, dropZone, overlayElement, menuElement, menuListElement) {
        this.video = videoElement;
        this.dropZone = dropZone;
        this.overlay = overlayElement;
        this.menu = menuElement;
        this.menuList = menuListElement;

        this.availableSubtitles = [];
        this.isLoading = false;

        this._setupDragDrop();
    }

    /**
     * Convert SRT format to WebVTT
     */
    srtToWebVTT(srtContent) {
        let vtt = 'WEBVTT\n\n';

        const converted = srtContent
            .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');

        vtt += converted;
        return vtt;
    }

    /**
     * Load subtitles from SRT content
     */
    loadFromContent(srtContent, language = 'Español') {
        const vttContent = this.srtToWebVTT(srtContent);

        const blob = new Blob([vttContent], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);

        this.clearTracks();

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = language;
        track.srclang = language.toLowerCase().includes('spanish') ? 'es' : 'en';
        track.src = url;
        track.default = true;

        this.video.appendChild(track);

        if (this.video.textTracks.length > 0) {
            this.video.textTracks[0].mode = 'showing';
        }

        console.log('[SubtitleManager] Loaded:', language);
    }

    /**
     * Clear all subtitle tracks
     */
    clearTracks() {
        const tracks = this.video.querySelectorAll('track');
        tracks.forEach(t => t.remove());

        // Clear stored URL for cast
        if (typeof App !== 'undefined' && App.state) {
            App.state.currentSubtitleUrl = null;
        }
    }

    /**
     * Fetch available subtitles for a movie
     */
    async fetchSubtitles(imdbId) {
        console.log('[SubtitleManager] Fetching for:', imdbId);
        this.availableSubtitles = [];

        try {
            this.availableSubtitles = await window.api.fetchMovieSubs(imdbId);
            console.log('[SubtitleManager] Found:', this.availableSubtitles.length);
            return this.availableSubtitles;
        } catch (e) {
            console.error('[SubtitleManager] Fetch error:', e);
            return [];
        }
    }

    /**
     * Auto-load best Spanish subtitle
     */
    async autoLoadSpanish() {
        const spanishSubs = this.availableSubtitles
            .filter(s => s.language.toLowerCase().includes('spanish') ||
                s.language.toLowerCase().includes('español'))
            .sort((a, b) => b.rating - a.rating);

        if (spanishSubs.length > 0) {
            console.log('[SubtitleManager] Auto-loading Spanish');
            await this.loadSubtitle(spanishSubs[0]);
            return true;
        }
        return false;
    }

    /**
     * Load a specific subtitle
     */
    async loadSubtitle(sub) {
        this.isLoading = true;
        this._showLoading();

        try {
            // Use downloadUrl for the IPC call (it expects the direct ZIP URL)
            const downloadUrl = sub.downloadUrl || sub.pageUrl;
            console.log('[SubtitleManager] Loading from:', downloadUrl);

            const srtContent = await window.api.loadSelectedSub(downloadUrl);
            this.loadFromContent(srtContent, sub.language);

            // Store download URL for cast (if available globally)
            if (typeof App !== 'undefined' && App.state) {
                App.state.currentSubtitleUrl = downloadUrl;
                console.log('[SubtitleManager] Stored subtitle URL for cast:', downloadUrl);
            }
        } catch (e) {
            console.error('[SubtitleManager] Load error:', e);
        } finally {
            this.isLoading = false;
            this._hideLoading();
        }
    }

    /**
     * Setup drag and drop for SRT files
     */
    _setupDragDrop() {
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.overlay.classList.add('active');
        });

        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.dropZone.contains(e.relatedTarget)) {
                this.overlay.classList.remove('active');
            }
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.overlay.classList.remove('active');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this._handleFileDrop(files[0]);
            }
        });
    }

    /**
     * Handle dropped SRT file
     */
    _handleFileDrop(file) {
        if (!file.name.toLowerCase().endsWith('.srt')) {
            console.warn('[SubtitleManager] Only .srt files supported');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.loadFromContent(e.target.result, file.name.replace('.srt', ''));
        };
        reader.readAsText(file);
    }

    /**
     * Render language menu
     */
    renderMenu(onSelect) {
        this.menuList.innerHTML = '';

        // No subtitles option
        const noSubBtn = document.createElement('button');
        noSubBtn.className = 'subtitle-menu-item';
        noSubBtn.textContent = 'Sin subtítulos';
        noSubBtn.addEventListener('click', () => {
            this.clearTracks();
            onSelect(null);
        });
        this.menuList.appendChild(noSubBtn);

        // Available languages
        this.availableSubtitles.forEach(sub => {
            const btn = document.createElement('button');
            btn.className = 'subtitle-menu-item';
            btn.innerHTML = `
                <span>${sub.language}</span>
                ${sub.rating ? `<span class="subtitle-menu-rating">★ ${sub.rating}</span>` : ''}
            `;
            btn.addEventListener('click', async () => {
                await this.loadSubtitle(sub);
                onSelect(sub);
            });
            this.menuList.appendChild(btn);
        });
    }

    /**
     * Show loading indicator
     */
    _showLoading() {
        // Could add a loading state to menu or overlay
    }

    /**
     * Hide loading indicator
     */
    _hideLoading() {
        // Remove loading state
    }

    /**
     * Open menu
     */
    openMenu() {
        this.menu.classList.add('active');
    }

    /**
     * Close menu
     */
    closeMenu() {
        this.menu.classList.remove('active');
    }

    /**
     * Toggle menu
     */
    toggleMenu() {
        if (this.menu.classList.contains('active')) {
            this.closeMenu();
        } else {
            this.renderMenu(() => this.closeMenu());
            this.openMenu();
        }
    }
}

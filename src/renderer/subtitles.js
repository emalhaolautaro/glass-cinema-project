/**
 * Subtitle Management Module
 */
const Subtitles = {
    init() {
        this.setupMenu();
        this.setupDragDrop();
    },

    // SRT to WebVTT conversion
    srtToWebVTT(srt) {
        return 'WEBVTT\n\n' + srt
            .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
    },

    clearTracks() {
        const v = App.dom.player.video;

        // 1. Remove DOM elements
        const tracks = v.querySelectorAll('track');
        tracks.forEach(t => t.remove());

        // 2. Force disable all internal TextTracks
        // (Removing DOM node doesn't always clear the internal track list immediately)
        if (v.textTracks) {
            for (let i = 0; i < v.textTracks.length; i++) {
                try {
                    v.textTracks[i].mode = 'disabled';
                } catch (e) { }
            }
        }

        // Clear stored URL for cast
        App.state.currentSubtitleUrl = null;

        console.log('[Subtitles] Cleared tracks (DOM & Internal)');
    },

    injectTrack(vttContent, label) {
        const v = App.dom.player.video;

        // Remove old tracks
        this.clearTracks();

        const blob = new Blob([vttContent], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = label;
        track.srclang = label.toLowerCase().includes('spanish') ? 'es' : 'en';
        track.src = url;
        track.default = true;

        v.appendChild(track);

        // Force display
        if (v.textTracks.length > 0) {
            v.textTracks[0].mode = 'showing';
        }
        console.log(`[Subtitles] Injected track: ${label}`);
    },

    setLocalTrack(url, label) {
        const v = App.dom.player.video;
        this.clearTracks(); // Ensure previous tracks are gone

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = label;
        track.srclang = 'es';
        track.src = url;
        track.default = true;

        // Use event listener for robust activation
        track.onload = () => {
            console.log(`[Subtitles] Track loaded successfully: ${label}`);
            track.track.mode = 'showing';
        };

        track.onerror = (e) => {
            console.error('[Subtitles] Track failed to load:', e);
        };

        v.appendChild(track);

        // Fallback: If cached or instant load, event might fire before listener? 
        // No, because we append after adding listeners. 
        // Just in case, force check.
        requestAnimationFrame(() => {
            if (track.readyState === 2) { // LOADED
                track.track.mode = 'showing';
            }
        });

        App.state.currentSubtitleUrl = url;
        console.log(`[Subtitles] Set local track: ${label}`);
    },

    async fetchForMovie(imdbId) {
        // Prevent re-fetching if we already know there are none or we have them
        if (App.state.failedSubtitles && App.state.failedSubtitles.has(imdbId)) {
            console.log(`[Subtitles] Skipping fetch for ${imdbId} (previously failed/empty)`);
            return;
        }

        console.log(`[Subtitles] Fetching for ${imdbId}...`);
        try {
            const subs = await window.api.fetchMovieSubs(imdbId);
            App.state.availableSubtitles = subs;
            console.log(`[Subtitles] Found ${subs.length} subtitles`);

            if (subs.length === 0) {
                if (!App.state.failedSubtitles) App.state.failedSubtitles = new Set();
                App.state.failedSubtitles.add(imdbId);
                console.log('[Subtitles] No subtitles found');
                return;
            }

            // Auto-load Spanish first, then English
            const spanish = subs.find(s => s.language.toLowerCase().includes('spanish') || s.language.toLowerCase().includes('español'));
            const english = subs.find(s => s.language.toLowerCase().includes('english'));

            if (spanish) {
                console.log('[Subtitles] Auto-loading Spanish...');
                await this.load(spanish);
            } else if (english) {
                console.log('[Subtitles] No Spanish found, auto-loading English...');
                await this.load(english);
            } else {
                console.log('[Subtitles] No Spanish/English found, waiting for user selection');
                // Open menu to let user choose
                this.openMenu();
            }
        } catch (e) {
            console.error('[Subtitles] Fetch failed:', e);
            App.state.availableSubtitles = [];
        }
    },

    async load(sub) {
        console.log(`[Subtitles] Loading: ${sub.language} (Local: ${!!sub.isLocal})`);

        try {
            let content;

            if (sub.isLocal) {
                // Fetch directly from local server
                const res = await fetch(sub.downloadUrl);
                if (!res.ok) throw new Error(`Local fetch failed: ${res.status}`);
                content = await res.text();

                // If it's already VTT (served as .vtt), just inject. Else convert.
                // We assume locally served files might be VTT or SRT.
                const isVtt = sub.downloadUrl.endsWith('.vtt') || content.startsWith('WEBVTT');

                if (isVtt) {
                    this.injectTrack(content, sub.language);
                } else {
                    const vtt = this.srtToWebVTT(content);
                    this.injectTrack(vtt, sub.language);
                }

                // Store for cast
                App.state.currentSubtitleUrl = sub.downloadUrl;
                return;
            }

            // Normal Online Flow (ZIP)
            const srt = await window.api.loadSelectedSub(sub.downloadUrl);
            if (!srt) throw new Error("Empty subtitle content");

            const vtt = this.srtToWebVTT(srt);
            this.injectTrack(vtt, sub.language);
            console.log(`[Subtitles] Loaded ${sub.language}`);

            // Store download URL for cast
            App.state.currentSubtitleUrl = sub.downloadUrl;
            console.log(`[Subtitles] Stored URL for cast: ${sub.downloadUrl}`);

        } catch (e) {
            console.error('[Subtitles] Load error:', e);
            Toast.show(`Error loading subtitle: ${e.message}`, 'error');
        }
    },

    // UI: Menu
    renderMenu() {
        const list = App.dom.player.subtitleMenuList;
        list.innerHTML = '';

        // "None" option
        const noneBtn = document.createElement('button');
        noneBtn.className = 'subtitle-menu-item';
        noneBtn.textContent = 'Sin subtítulos';
        noneBtn.onclick = () => {
            this.clearTracks();
            this.closeMenu();
        };
        list.appendChild(noneBtn);

        if (!App.state.availableSubtitles || App.state.availableSubtitles.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'subtitle-empty-state';
            empty.textContent = 'No subtitles found';
            list.appendChild(empty);
            return;
        }

        // Languages
        App.state.availableSubtitles.forEach(sub => {
            const btn = document.createElement('button');
            btn.className = 'subtitle-menu-item';
            btn.textContent = sub.language;
            btn.onclick = async () => {
                await this.load(sub);
                this.closeMenu();
            };
            list.appendChild(btn);
        });
    },

    openMenu() {
        this.renderMenu();
        App.dom.player.subtitleMenu.classList.add('active');
    },

    closeMenu() {
        App.dom.player.subtitleMenu.classList.remove('active');
    },

    toggleMenu() {
        const menu = App.dom.player.subtitleMenu;
        if (menu.classList.contains('active')) this.closeMenu();
        else this.openMenu();
    },

    setupMenu() {
        const p = App.dom.player;
        p.subtitlesBtn.addEventListener('click', () => this.toggleMenu());
        p.subtitleMenuClose.addEventListener('click', () => this.closeMenu());
    },

    // Drag & Drop
    setupDragDrop() {
        const view = App.dom.player.view;
        const overlay = App.dom.player.subtitleOverlay;

        view.addEventListener('dragover', (e) => {
            e.preventDefault();
            overlay.classList.add('active');
        });

        view.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!view.contains(e.relatedTarget)) overlay.classList.remove('active');
        });

        view.addEventListener('drop', (e) => {
            e.preventDefault();
            overlay.classList.remove('active');

            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.srt')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const vtt = this.srtToWebVTT(ev.target.result);
                    this.injectTrack(vtt, 'Local File');
                };
                reader.readAsText(file);
            }
        });
    }
};

console.log('[Subtitles] Module loaded');

/**
 * Video Player Logic
 */
const Player = {
    // Cast mode state
    isCastMode: false,
    castDuration: 0,

    init() {
        this.setupControls();
        this.setupVideoEvents();
        this.setupCastListeners();
    },

    reset() {
        const p = App.dom.player;
        p.progressBar.style.width = '0%';
        p.bufferBar.style.width = '0%';
        p.timeDisplay.textContent = '0:00';
        p.video.src = '';
        App.state.downloadProgress = 0;
        this.updatePlayIcon(false);

        // Reset cast mode
        this.exitCastMode();
    },

    /**
     * Setup cast event listeners for control sync
     */
    setupCastListeners() {
        // EARLY MUTE: When main process signals to mute (before cast connects)
        window.api.onCastMuteLocal(() => {
            console.log('[Player] Early mute signal received - muting local video immediately');
            this.muteLocalVideo();
        });

        // When cast connects, enter full cast mode
        window.api.onCastConnected((deviceName) => {
            console.log(`[Player] Cast connected to ${deviceName}`);
            this.enterCastMode();
        });

        // When cast status updates, sync UI
        window.api.onCastStatus((status) => {
            if (!this.isCastMode) return;

            // Update progress bar with Chromecast position
            if (status.duration > 0) {
                this.castDuration = status.duration;
                const percent = (status.currentTime / status.duration) * 100;
                App.dom.player.progressBar.style.width = `${percent}%`;

                // Update time display
                const min = Math.floor(status.currentTime / 60);
                const sec = Math.floor(status.currentTime % 60);
                App.dom.player.timeDisplay.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
            }

            // Sync play/pause icon with Chromecast state
            const isPlaying = status.playerState === 'PLAYING';
            this.updatePlayIcon(isPlaying);
        });

        // When cast stops, exit cast mode
        window.api.onCastStopped(() => {
            console.log('[Player] Cast stopped');
            this.exitCastMode();
        });
    },

    /**
     * Mute local video immediately (called before cast connects)
     */
    muteLocalVideo() {
        const p = App.dom.player;
        try {
            p.video.pause();
            p.video.muted = true;
            p.video.volume = 0;
            console.log('[Player] Local video muted and paused');
        } catch (e) {
            console.warn('[Player] Could not mute local video:', e);
        }
    },

    /**
     * Enter cast mode - pause and mute local video, show cast UI
     */
    enterCastMode() {
        console.log('[Player] Entering cast mode');
        this.isCastMode = true;

        const p = App.dom.player;

        // CRITICAL: Pause local video to prevent echo
        try {
            p.video.pause();
        } catch (e) { }

        // Mute AND set volume to 0 for extra safety
        p.video.muted = true;
        p.video.volume = 0;

        // Hide local video element but keep player UI visible
        p.video.style.opacity = '0.1';

        // Show player view (for controls)
        UI.showPlayer();
        UI.hideLoader();

        // Add cast indicator class
        p.view.classList.add('cast-mode');

        console.log('[Player] Cast mode active - local video paused and muted');
    },

    /**
     * Exit cast mode - restore local video
     */
    exitCastMode() {
        if (!this.isCastMode) return;

        console.log('[Player] Exiting cast mode');
        this.isCastMode = false;
        this.castDuration = 0;

        const p = App.dom.player;

        // Restore local video
        p.video.muted = false;
        p.video.style.opacity = '1';

        // Remove cast indicator
        p.view.classList.remove('cast-mode');
    },

    togglePlay() {
        if (this.isCastMode) {
            // Send command to Chromecast
            // Check current state and toggle
            const btn = App.dom.player.playPauseBtn;
            const isPaused = btn.innerHTML.includes('polygon'); // Play icon = paused

            if (isPaused) {
                window.api.castResume();
            } else {
                window.api.castPause();
            }
        } else {
            // Local playback
            const v = App.dom.player.video;
            if (v.paused) {
                v.play().catch(e => console.error('[Player] Play error:', e));
            } else {
                v.pause();
            }
        }
    },

    updatePlayIcon(isPlaying) {
        const btn = App.dom.player.playPauseBtn;
        const icon = isPlaying
            ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        btn.innerHTML = icon;
    },

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            App.dom.player.view.requestFullscreen();
        }
    },

    setupControls() {
        const p = App.dom.player;

        p.playPauseBtn.addEventListener('click', () => this.togglePlay());
        p.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

        p.volumeSlider.addEventListener('input', (e) => {
            const level = parseFloat(e.target.value);

            if (this.isCastMode) {
                // Control Chromecast volume
                window.api.castVolume(level);
            } else {
                // Local volume
                p.video.volume = level;
            }
        });

        // Seek
        p.progressContainer.addEventListener('click', (e) => {
            const rect = p.progressContainer.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;

            if (this.isCastMode) {
                // Seek on Chromecast
                if (this.castDuration > 0) {
                    const seekTime = pos * this.castDuration;
                    window.api.castSeek(seekTime);
                }
            } else {
                // Local seek
                if (!p.video.duration) return;
                p.video.currentTime = pos * p.video.duration;
            }
        });

        // Close Button
        p.closeBtn.addEventListener('click', () => this.close());

        // Mouse inactivity logic
        this.setupInactivity();
    },

    setupInactivity() {
        const p = App.dom.player;
        let inactivityTimeout;

        const resetInactivity = () => {
            p.view.classList.remove('user-inactive');
            p.view.style.cursor = 'default';

            clearTimeout(inactivityTimeout);

            // Only hide if video is playing (or casting)
            const isActive = this.isCastMode || !p.video.paused;
            if (isActive) {
                inactivityTimeout = setTimeout(() => {
                    p.view.classList.add('user-inactive');
                    p.view.style.cursor = 'none';
                }, 3000);
            }
        };

        p.view.addEventListener('mousemove', resetInactivity);
        p.view.addEventListener('click', resetInactivity);
        p.view.addEventListener('keypress', resetInactivity);

        // Also reset when pausing
        p.video.addEventListener('pause', () => {
            resetInactivity();
            clearTimeout(inactivityTimeout); // Keep visible while paused
        });

        p.video.addEventListener('play', resetInactivity);
    },

    close() {
        const p = App.dom.player;

        // Stop casting if active
        if (this.isCastMode) {
            window.api.stopCasting();
            this.exitCastMode();
        }

        // Stop video
        p.video.pause();
        p.video.removeAttribute('src'); // Better than src=''
        p.video.load();

        // Hide UI
        UI.hidePlayer();

        // === FULL CLEANUP ===
        // Clear subtitles (both local tracks and main process state)
        if (typeof Subtitles !== 'undefined' && Subtitles.clearTracks) {
            Subtitles.clearTracks();
        }
        if (window.api.clearSubtitles) {
            window.api.clearSubtitles();
        }

        // Reset app state
        App.state.currentSubtitleUrl = null;
        App.state.castPendingMode = false;
        App.state.streamUrl = null;

        // Stop backend stream
        if (window.api.stopStream) {
            window.api.stopStream();
        }

        console.log('[Player] Full cleanup complete');
    },

    setupVideoEvents() {
        const p = App.dom.player;

        p.video.addEventListener('play', () => {
            if (!this.isCastMode) this.updatePlayIcon(true);
        });
        p.video.addEventListener('pause', () => {
            if (!this.isCastMode) this.updatePlayIcon(false);
        });

        // Loader logic
        p.video.addEventListener('waiting', () => {
            if (!this.isCastMode) UI.showLoader();
        });
        p.video.addEventListener('playing', () => UI.hideLoader());
        p.video.addEventListener('canplay', () => UI.hideLoader());

        p.video.addEventListener('timeupdate', () => {
            // Skip if in cast mode (we update from cast status)
            if (this.isCastMode) return;

            if (!p.video.duration) return;

            const duration = p.video.duration;
            const current = p.video.currentTime;

            // Play progress
            const playPercent = (current / duration) * 100;
            p.progressBar.style.width = `${playPercent}%`;

            // Buffer progress
            let bufferEnd = 0;
            if (p.video.buffered.length > 0) {
                // Find buffer range covering current time
                for (let i = 0; i < p.video.buffered.length; i++) {
                    if (p.video.buffered.start(i) <= current && p.video.buffered.end(i) >= current) {
                        bufferEnd = p.video.buffered.end(i);
                        break;
                    }
                }
                // Fallback to last buffer if not covered (rare)
                if (bufferEnd === 0) bufferEnd = p.video.buffered.end(p.video.buffered.length - 1);
            }

            const videoBufferPercent = (bufferEnd / duration) * 100;
            const downloadPercent = App.state.downloadProgress * 100;

            p.bufferBar.style.width = `${Math.max(videoBufferPercent, downloadPercent)}%`;

            // Time Stats
            const min = Math.floor(current / 60);
            const sec = Math.floor(current % 60);
            p.timeDisplay.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
        });
    }
};

console.log('[Player] Module loaded');

/**
 * Player Controls Module
 * Handles play/pause, progress bar, volume, fullscreen, seeking
 */

export class PlayerControls {
    constructor(elements, callbacks = {}) {
        this.video = elements.video;
        this.playPauseBtn = elements.playPauseBtn;
        this.progressBar = elements.progressBar;
        this.bufferBar = elements.bufferBar;
        this.progressContainer = elements.progressContainer;
        this.timeDisplay = elements.timeDisplay;
        this.volumeSlider = elements.volumeSlider;
        this.fullscreenBtn = elements.fullscreenBtn;
        this.playerView = elements.playerView;

        this.callbacks = callbacks;
        this.downloadProgress = 0;

        this._setupEventListeners();
    }

    /**
     * Set download progress from streaming
     */
    setDownloadProgress(progress) {
        this.downloadProgress = progress;
    }

    /**
     * Reset controls state
     */
    reset() {
        this.progressBar.style.width = '0%';
        this.bufferBar.style.width = '0%';
        this.timeDisplay.textContent = '0:00';
        this.downloadProgress = 0;
        this._updatePlayIcon(false);
    }

    /**
     * Setup all event listeners
     */
    _setupEventListeners() {
        // Play/Pause
        this.playPauseBtn.addEventListener('click', () => this._togglePlay());

        // Volume
        this.volumeSlider.addEventListener('input', (e) => {
            if (this.video) {
                this.video.volume = parseFloat(e.target.value);
            }
        });

        // Fullscreen
        this.fullscreenBtn.addEventListener('click', () => this._toggleFullscreen());

        // Progress bar seeking
        this.progressContainer.addEventListener('click', (e) => this._handleSeek(e));

        // Time update
        this.video.addEventListener('timeupdate', () => this._updateProgress());

        // Play state changes
        this.video.addEventListener('play', () => this._updatePlayIcon(true));
        this.video.addEventListener('pause', () => this._updatePlayIcon(false));
    }

    /**
     * Toggle play/pause
     */
    _togglePlay() {
        if (!this.video) return;

        if (this.video.paused) {
            this.video.play().catch(e => console.error('Play error:', e));
        } else {
            this.video.pause();
        }
    }

    /**
     * Update play/pause icon
     */
    _updatePlayIcon(isPlaying) {
        const icon = isPlaying
            ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
            : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        this.playPauseBtn.innerHTML = icon;
    }

    /**
     * Toggle fullscreen
     */
    _toggleFullscreen() {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else {
            if (this.playerView.requestFullscreen) {
                this.playerView.requestFullscreen();
            } else if (this.playerView.webkitRequestFullscreen) {
                this.playerView.webkitRequestFullscreen();
            }
        }
    }

    /**
     * Handle seeking
     */
    _handleSeek(e) {
        const duration = this.video.duration;
        if (!duration || isNaN(duration)) return;

        const rect = this.progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.video.currentTime = pos * duration;
    }

    /**
     * Update progress bar and time display
     */
    _updateProgress() {
        if (!this.video || !this.video.duration || isNaN(this.video.duration)) return;

        const duration = this.video.duration;

        // Playback progress
        const playPercent = (this.video.currentTime / duration) * 100;
        this.progressBar.style.width = `${playPercent}%`;

        // Buffer progress
        let videoBufferEnd = 0;
        try {
            if (this.video.buffered && this.video.buffered.length > 0) {
                const currentTime = this.video.currentTime;
                for (let i = 0; i < this.video.buffered.length; i++) {
                    if (this.video.buffered.start(i) <= currentTime &&
                        this.video.buffered.end(i) >= currentTime) {
                        videoBufferEnd = this.video.buffered.end(i);
                        break;
                    }
                }
                if (videoBufferEnd === 0 && this.video.buffered.length > 0) {
                    videoBufferEnd = this.video.buffered.end(this.video.buffered.length - 1);
                }
            }
        } catch (e) { /* buffered may throw */ }

        const videoBufferPercent = (videoBufferEnd / duration) * 100;
        const downloadBufferPercent = this.downloadProgress * 100;
        const maxBuffer = Math.max(videoBufferPercent, downloadBufferPercent);
        this.bufferBar.style.width = `${maxBuffer}%`;

        // Time display
        const minutes = Math.floor(this.video.currentTime / 60);
        const seconds = Math.floor(this.video.currentTime % 60);
        this.timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Start playback
     */
    play() {
        this.video.play().catch(e => console.error('Play error:', e));
    }

    /**
     * Stop playback and clear source
     */
    stop() {
        this.video.pause();
        this.video.src = '';
        this.reset();
    }
}

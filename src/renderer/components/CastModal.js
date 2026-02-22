/**
 * Cast Modal Component
 * Ultra-Glassmorphism device selector for Chromecast
 */
const CastModal = {
    element: null,
    backdropEl: null,
    deviceListEl: null,
    loaderEl: null,
    selectedDevice: null,
    devices: [],
    isOpen: false,

    /**
     * Initialize the Cast Modal (creates DOM structure)
     */
    init() {
        // Create modal structure
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'cast-modal-backdrop';
        this.backdropEl.innerHTML = `
            <div class="cast-modal">
                <div class="cast-modal-header">
                    <h3 class="cast-modal-title">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path>
                            <line x1="2" y1="20" x2="2.01" y2="20"></line>
                        </svg>
                        Transmitir a dispositivo
                    </h3>
                    <button class="cast-modal-close">&times;</button>
                </div>
                <div class="cast-modal-body">
                    <div class="cast-device-loader">
                        <div class="cast-spinner"></div>
                        <span>Buscando dispositivos...</span>
                    </div>
                    <div class="cast-device-list"></div>
                    <div class="cast-no-devices" style="display: none;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <p>No se encontraron dispositivos</p>
                        <small>Asegurate de que tu Chromecast esté encendido y en la misma red</small>
                    </div>
                    
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
                        <select class="cast-subtitle-select">
                            <option value="">Cargando...</option>
                        </select>
                    </div>
                </div>
                <div class="cast-modal-footer">
                    <button class="cast-btn-cancel">Cancelar</button>
                    <button class="cast-btn-connect" disabled>Conectar</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.backdropEl);

        // Cache elements
        this.element = this.backdropEl.querySelector('.cast-modal');
        this.deviceListEl = this.backdropEl.querySelector('.cast-device-list');
        this.loaderEl = this.backdropEl.querySelector('.cast-device-loader');
        this.noDevicesEl = this.backdropEl.querySelector('.cast-no-devices');
        this.connectBtn = this.backdropEl.querySelector('.cast-btn-connect');
        this.subtitleSelect = this.backdropEl.querySelector('.cast-subtitle-select');
        this.subtitleSection = this.backdropEl.querySelector('.cast-subtitle-section');

        // Register event handlers
        this.backdropEl.querySelector('.cast-modal-close').addEventListener('click', () => this.hide());
        this.backdropEl.querySelector('.cast-btn-cancel').addEventListener('click', () => this.hide());
        this.connectBtn.addEventListener('click', () => this.connect());

        // Close on backdrop click
        this.backdropEl.addEventListener('click', (e) => {
            if (e.target === this.backdropEl) this.hide();
        });

        // Close on Escape key
        this.handleKeydown = this.handleKeydown.bind(this);

        // Listen for new devices from IPC
        window.api.onCastDeviceFound((device) => {
            this.addDevice(device);
        });

        // Listen for connection success
        window.api.onCastConnected((deviceName) => {
            this.hide();
            Toast.show(`Conectado a ${deviceName}`, 'success');
        });

        // Listen for errors
        window.api.onCastError((error) => {
            Toast.show(`Error: ${error}`, 'error');
            this.enableButtons();
        });

        console.log('[CastModal] Initialized');
    },

    /**
     * Show the modal and start device discovery
     */
    show() {
        if (this.isOpen) return;

        this.isOpen = true;
        this.devices = [];
        this.selectedDevice = null;
        this.deviceListEl.innerHTML = '';

        // Reset UI state
        this.loaderEl.style.display = 'flex';
        this.noDevicesEl.style.display = 'none';
        this.connectBtn.disabled = true;

        // Populate subtitles dropdown
        this.populateSubtitles();

        // Show modal with animation
        this.backdropEl.classList.add('active');

        // Add keyboard listener
        document.addEventListener('keydown', this.handleKeydown);

        // Start discovery
        window.api.requestCastDiscovery();

        // Timeout to show "no devices" if none found
        this.discoveryTimeout = setTimeout(() => {
            if (this.devices.length === 0) {
                this.loaderEl.style.display = 'none';
                this.noDevicesEl.style.display = 'flex';
            }
        }, 8000);
    },

    /**
     * Hide the modal and stop discovery
     */
    hide() {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.backdropEl.classList.remove('active');

        document.removeEventListener('keydown', this.handleKeydown);
        clearTimeout(this.discoveryTimeout);

        App.state.castPendingMode = false;

        window.api.stopCastDiscovery();
    },

    /**
     * Handle keydown events
     */
    handleKeydown(e) {
        if (e.key === 'Escape') {
            this.hide();
        }
    },

    /**
     * Add a discovered device to the list
     */
    addDevice(device) {
        if (!this.isOpen) return;
        if (this.devices.find(d => d.name === device.name)) return;

        this.devices.push(device);

        // Hide loader and show list
        this.loaderEl.style.display = 'none';
        this.noDevicesEl.style.display = 'none';

        // Create device button
        const btn = document.createElement('button');
        btn.className = 'cast-device-btn';
        btn.dataset.deviceName = device.name;
        btn.innerHTML = `
            <div class="cast-device-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
                    <polyline points="17 2 12 7 7 2"></polyline>
                </svg>
            </div>
            <div class="cast-device-info">
                <span class="cast-device-name">${this.sanitize(device.name)}</span>
                <span class="cast-device-type">${this.sanitize(device.type || 'Chromecast')}</span>
            </div>
        `;

        btn.addEventListener('click', () => this.handleSelection(device));
        this.deviceListEl.appendChild(btn);
    },

    /**
     * Handle device selection
     */
    handleSelection(device) {
        // Remove selection from all buttons
        this.deviceListEl.querySelectorAll('.cast-device-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        // Add selection to clicked button
        const selectedBtn = this.deviceListEl.querySelector(`[data-device-name="${device.name}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }

        this.selectedDevice = device;
        this.connectBtn.disabled = false;
    },

    /**
     * Connect to the selected device
     */
    connect() {
        if (!this.selectedDevice) return;

        this.disableButtons();

        // Get current movie info
        const movie = App.state.currentMovie;

        // Get selected subtitle from dropdown
        const selectedSubUrl = this.subtitleSelect?.value || null;

        const movieInfo = movie ? {
            title: movie.title,
            coverUrl: movie.large_cover_image || movie.medium_cover_image,
            // Use subtitle selected in dropdown (not App.state)
            subtitleDownloadUrl: selectedSubUrl || null
        } : null;

        console.log('[CastModal] Connecting with info:', {
            title: movieInfo?.title,
            hasSubtitle: !!movieInfo?.subtitleDownloadUrl
        });

        // Send cast request
        window.api.selectCastDevice(this.selectedDevice.name, movieInfo);
    },

    /**
     * Populate subtitles dropdown from available subtitles
     */
    populateSubtitles() {
        const select = this.subtitleSelect;
        if (!select) return;

        // Clear existing options
        select.innerHTML = '';

        // Add "No subtitles" option
        const noSubOption = document.createElement('option');
        noSubOption.value = '';
        noSubOption.textContent = 'Sin subtítulos';
        select.appendChild(noSubOption);

        // Get available subtitles from App.state
        const subs = App.state.availableSubtitles || [];

        if (subs.length === 0) {
            const loadingOption = document.createElement('option');
            loadingOption.value = '';
            loadingOption.textContent = 'Cargando subtítulos...';
            loadingOption.disabled = true;
            select.appendChild(loadingOption);

            // Check again in 2 seconds (subtitles might still be loading)
            setTimeout(() => {
                if (this.isOpen) this.populateSubtitles();
            }, 2000);
            return;
        }

        // Add available subtitles
        subs.forEach(sub => {
            const option = document.createElement('option');
            option.value = sub.downloadUrl;
            option.textContent = sub.language;
            select.appendChild(option);
        });

        // Auto-select Spanish Latin America first (tends to have working URLs)
        // Fall back to any Spanish variant
        let spanishSub = subs.find(s =>
            s.language.toLowerCase().includes('latin') ||
            s.language.toLowerCase().includes('latina')
        );

        if (!spanishSub) {
            spanishSub = subs.find(s =>
                s.language.toLowerCase().includes('spanish') ||
                s.language.toLowerCase().includes('español')
            );
        }

        if (spanishSub) {
            select.value = spanishSub.downloadUrl;
            console.log(`[CastModal] Auto-selected: ${spanishSub.language}`);
        }

        console.log(`[CastModal] Populated ${subs.length} subtitles`);
    },

    /**
     * Disable buttons during connection
     */
    disableButtons() {
        this.connectBtn.disabled = true;
        this.connectBtn.textContent = 'Conectando...';
    },

    /**
     * Re-enable buttons after error
     */
    enableButtons() {
        this.connectBtn.disabled = false;
        this.connectBtn.textContent = 'Conectar';
    },

    /**
     * Sanitize string to prevent XSS
     */
    sanitize(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

console.log('[CastModal] Module loaded');

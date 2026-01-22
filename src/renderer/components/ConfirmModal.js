/**
 * Confirm Modal Component
 * Replaces native confirm() with a glassmorphism UI
 */
const ConfirmModal = {
    element: null,
    backdropEl: null,
    onConfirm: null,
    isOpen: false,

    init() {
        // Create modal structure
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'cast-modal-backdrop'; // Reuse existing backdrop style
        this.backdropEl.style.zIndex = '2000'; // Higher than others
        this.backdropEl.innerHTML = `
            <div class="cast-modal" style="max-width: 400px; height: auto;">
                <div class="cast-modal-header">
                    <h3 class="cast-modal-title" id="confirm-title">Confirmar</h3>
                    <button class="cast-modal-close">&times;</button>
                </div>
                <div class="cast-modal-body">
                    <p id="confirm-message" style="color: #ddd; margin-bottom: 20px; font-size: 0.95rem; line-height: 1.5;"></p>
                </div>
                <div class="cast-modal-footer">
                    <button class="cast-btn-cancel" id="btn-cancel-confirm">Cancelar</button>
                    <button class="cast-btn-connect" id="btn-do-confirm" style="background: rgba(255, 68, 68, 0.2); border: 1px solid rgba(255, 68, 68, 0.4);">
                        Confirmar
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.backdropEl);

        // Cache elements
        this.titleEl = this.backdropEl.querySelector('#confirm-title');
        this.messageEl = this.backdropEl.querySelector('#confirm-message');
        this.confirmBtn = this.backdropEl.querySelector('#btn-do-confirm');
        this.cancelBtn = this.backdropEl.querySelector('#btn-cancel-confirm');
        this.closeBtn = this.backdropEl.querySelector('.cast-modal-close');

        // Handlers
        this.closeBtn.addEventListener('click', () => this.hide());
        this.cancelBtn.addEventListener('click', () => this.hide());

        this.confirmBtn.addEventListener('click', () => {
            if (this.onConfirm) this.onConfirm();
            this.hide();
        });

        // Close on backdrop
        this.backdropEl.addEventListener('click', (e) => {
            if (e.target === this.backdropEl) this.hide();
        });

        console.log('[ConfirmModal] Initialized');
    },

    /**
     * Show confirmation modal
     * @param {string} title - Title of the modal
     * @param {string} message - Message body
     * @param {function} onConfirm - Callback if confirmed
     * @param {string} [confirmText='Confirmar'] - Text for confirm button
     * @param {boolean} [isDestructive=false] - If true, styles button red
     */
    show(title, message, onConfirm, confirmText = 'Confirmar', isDestructive = false) {
        if (!this.backdropEl) this.init();

        this.titleEl.textContent = title;
        this.messageEl.textContent = message;
        this.onConfirm = onConfirm;
        this.confirmBtn.textContent = confirmText;

        // update button style based on destructiveness
        if (isDestructive) {
            this.confirmBtn.style.background = 'rgba(255, 68, 68, 0.2)';
            this.confirmBtn.style.border = '1px solid rgba(255, 68, 68, 0.4)';
        } else {
            // Revert to "primary" style (similar to Cast button)
            this.confirmBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            this.confirmBtn.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        }

        this.isOpen = true;
        this.backdropEl.classList.add('active');
    },

    hide() {
        if (this.isOpen) {
            this.isOpen = false;
            this.backdropEl.classList.remove('active');
            this.onConfirm = null;
        }
    }
};

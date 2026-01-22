/**
 * Toast Notification Component
 * Minimalist notification system for user feedback
 */
const Toast = {
    container: null,
    activeToasts: [],

    /**
     * Initialize the Toast system (creates container)
     */
    init() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);

        console.log('[Toast] Initialized');
    },

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: 'success', 'error', 'info'
     * @param {number} duration - Duration in ms (default: 4000)
     */
    show(message, type = 'success', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Icon based on type
        let icon = '';
        switch (type) {
            case 'success':
                icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>`;
                break;
            case 'error':
                icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>`;
                break;
            case 'info':
            default:
                icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>`;
        }

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-message">${this.sanitize(message)}</div>
            <button class="toast-close">&times;</button>
        `;

        // Close button handler
        toast.querySelector('.toast-close').addEventListener('click', () => {
            this.hide(toast);
        });

        // Add to container
        this.container.appendChild(toast);
        this.activeToasts.push(toast);

        // Trigger enter animation
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Auto-hide after duration
        setTimeout(() => {
            this.hide(toast);
        }, duration);

        return toast;
    },

    /**
     * Hide a specific toast
     * @param {HTMLElement} toast - Toast element to hide
     */
    hide(toast) {
        if (!toast || !toast.classList.contains('visible')) return;

        toast.classList.remove('visible');
        toast.classList.add('hiding');

        // Remove after animation
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.activeToasts = this.activeToasts.filter(t => t !== toast);
        }, 300);
    },

    /**
     * Hide all active toasts
     */
    hideAll() {
        [...this.activeToasts].forEach(toast => this.hide(toast));
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

console.log('[Toast] Module loaded');

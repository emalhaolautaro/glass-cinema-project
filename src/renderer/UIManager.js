/**
 * UI Manager Module
 * Handles view transitions and modal control
 */

export class UIManager {
    constructor(elements) {
        this.grid = elements.grid;
        this.modalBackdrop = elements.modalBackdrop;
        this.playerView = elements.playerView;
        this.modalElements = elements.modal;

        this._setupModalClose();
    }

    /**
     * Show movie grid (main view)
     */
    showGrid() {
        this.playerView.classList.remove('active');
    }

    /**
     * Show player view
     */
    showPlayer() {
        this.playerView.classList.add('active');
    }

    /**
     * Hide player view
     */
    hidePlayer() {
        this.playerView.classList.remove('active');
    }

    /**
     * Open modal with movie data
     */
    openModal(movie) {
        const m = this.modalElements;
        m.poster.src = movie.large_cover_image || movie.medium_cover_image;
        m.title.textContent = movie.title;
        m.year.textContent = movie.year;
        m.rating.textContent = `${movie.rating}/10`;
        m.runtime.textContent = `${movie.runtime} min`;
        m.synopsis.textContent = movie.summary || movie.synopsis || "No synopsis available.";

        this.modalBackdrop.classList.add('active');
    }

    /**
     * Close modal
     */
    closeModal() {
        this.modalBackdrop.classList.remove('active');
    }

    /**
     * Setup modal close handlers
     */
    _setupModalClose() {
        this.modalElements.closeBtn?.addEventListener('click', () => this.closeModal());
        this.modalBackdrop.addEventListener('click', (e) => {
            if (e.target === this.modalBackdrop) this.closeModal();
        });
    }

    /**
     * Render movies grid
     */
    renderGrid(movies, onCardClick) {
        this.grid.innerHTML = '';

        if (!movies || movies.length === 0) {
            this.grid.innerHTML = '<div style="color: white">No movies found</div>';
            return;
        }

        movies.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            card.innerHTML = `
                <img class="movie-poster" src="${movie.medium_cover_image}" alt="${movie.title}" loading="lazy">
                <div class="movie-overlay">
                    <div class="movie-title">${movie.title}</div>
                    <div class="movie-year">${movie.year}</div>
                </div>
            `;
            card.addEventListener('click', () => onCardClick(movie));
            this.grid.appendChild(card);
        });
    }

    /**
     * Show empty state
     */
    showEmptyState(query) {
        this.grid.innerHTML = '';
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <img src="assets/icons/no_results.svg" class="empty-state-icon" alt="No results">
            <h2>No results found</h2>
            <p>We couldn't find any movies matching "${query}". Try different keywords.</p>
        `;
        this.grid.appendChild(emptyState);
    }

    /**
     * Show error state
     */
    showError(message) {
        this.grid.innerHTML = `<div style="color:white; text-align:center; padding: 20px;">Error: ${message}<br>Check Console (Ctrl+Shift+I)</div>`;
    }
}

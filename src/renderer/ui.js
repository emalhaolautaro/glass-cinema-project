/**
 * UI Management Module
 */
window.UI = {
    /**
     * Sanitize string to prevent XSS
     */
    sanitize(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // Show/Hide Modal
    async openModal(movie) {
        App.state.currentMovie = movie;
        const m = App.dom.modal;

        // Image Logic: Hybrid (Local > Remote > Placeholder)
        let primarySrc;
        const remoteSrc = movie.medium_cover_image || movie.large_cover_image || movie.posterUrl || movie.background_image;

        if (movie.infoHash) {
            primarySrc = `../app_data/downloads/${movie.infoHash}/poster.jpg`;
        } else {
            primarySrc = remoteSrc;
        }

        m.poster.src = this.sanitize(primarySrc || '');
        const placeholder = 'assets/placeholder_glass.png';

        m.poster.onerror = () => {
            // Level 1: Try remote (if we started with something else, e.g. local)
            if (remoteSrc && primarySrc !== remoteSrc && !m.poster.src.includes(remoteSrc)) {
                m.poster.src = remoteSrc;
                return;
            }
            // Level 2: Branded Placeholder
            if (!m.poster.src.includes('placeholder_glass.png')) {
                m.poster.src = placeholder;
            }
        };

        m.title.textContent = movie.title;
        m.year.textContent = movie.year || '';

        const rating = movie.rating !== undefined && movie.rating !== null ? movie.rating : '?';
        m.rating.textContent = `${rating}/10`;

        const finalRuntime = movie.runtime || movie.duration;
        const runtimeStr = finalRuntime ? `${finalRuntime} min` : 'N/A';
        m.runtime.textContent = runtimeStr;

        m.synopsis.textContent = movie.description_full || movie.summary || movie.synopsis || "Sin sinopsis disponible.";

        // Populate Genres
        const genresContainer = document.getElementById('m-genres');
        if (genresContainer) {
            genresContainer.innerHTML = '';
            if (movie.genres && movie.genres.length > 0) {
                movie.genres.forEach(genre => {
                    const tag = document.createElement('span');
                    tag.className = 'genre-tag';
                    tag.textContent = genre;
                    genresContainer.appendChild(tag);
                });
            }
        }

        m.backdrop.classList.add('active');

        // Reset buttons
        m.playBtn.onclick = null;
        m.castBtn.onclick = null;
    },

    closeModal() {
        App.dom.modal.backdrop.classList.remove('active');
    },

    // Player View
    showPlayer() {
        App.dom.player.view.classList.add('active');
    },

    hidePlayer() {
        App.dom.player.view.classList.remove('active');
        this.hideLoader();
    },

    // Loader controls
    showLoader() {
        if (App.dom.player.loader) App.dom.player.loader.classList.add('active');
    },

    hideLoader() {
        if (App.dom.player.loader) App.dom.player.loader.classList.remove('active');
    },

    // Grid Rendering
    showSkeletons(count = 10) {
        App.dom.grid.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-card';
            App.dom.grid.appendChild(skeleton);
        }
    },

    /**
     * Update a card with normalized metadata
     * Receives ONLY normalized fields - API agnostic
     * @param {string} imdbCode - IMDB ID for card lookup
     * @param {Object} data - Normalized metadata (medium_cover_image, rating, runtime)
     */
    updateCard(imdbCode, data) {
        const card = document.querySelector(`.movie-card[data-imdb="${imdbCode}"]`);
        if (!card) {
            console.warn(`[UI.updateCard] Card not found for ${imdbCode}`);
            return;
        }

        console.log(`[UI.updateCard] Updating ${imdbCode}:`, data);

        // Update Image (normalized field: medium_cover_image)
        const posterUrl = data.medium_cover_image;
        if (posterUrl) {
            const img = card.querySelector('.movie-poster');
            if (img && img.src !== posterUrl) {
                const previousSrc = img.src;
                const placeholder = 'assets/placeholder_glass.png';

                img.onerror = () => {
                    if (previousSrc && previousSrc !== posterUrl) {
                        img.src = previousSrc;
                    } else {
                        img.src = placeholder;
                    }
                    img.onerror = null;
                };

                img.src = posterUrl;
            }
        }

        // Update Rating (normalized field: rating)
        if (data.rating != null) {
            const ratingSpan = card.querySelector('.movie-rating');
            const ratingText = `★ ${Number(data.rating).toFixed(1)}`;
            if (ratingSpan) {
                ratingSpan.textContent = ratingText;
            } else {
                const header = card.querySelector('.movie-header');
                if (header) {
                    const span = document.createElement('span');
                    span.className = 'movie-rating';
                    span.textContent = ratingText;
                    header.appendChild(span);
                }
            }
        }

        // Update Runtime (normalized field: runtime in minutes)
        if (data.runtime) {
            const runtimeSpan = card.querySelector('.movie-runtime');
            const runtimeText = `• ${data.runtime} min`;
            if (runtimeSpan) {
                runtimeSpan.textContent = runtimeText;
            } else {
                const meta = card.querySelector('.movie-meta');
                if (meta) {
                    const span = document.createElement('span');
                    span.className = 'movie-runtime';
                    span.textContent = runtimeText;
                    meta.appendChild(span);
                }
            }
        }
    },

    createCardElement(movie) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        // Add ID for enrichment updates
        if (movie.imdb_code) {
            card.dataset.imdb = movie.imdb_code;
        }

        // Image Logic: Hybrid (Local > Remote > Branded Placeholder)
        let primarySrc;
        const remoteSrc = movie.medium_cover_image || movie.large_cover_image || movie.posterUrl || movie.background_image;

        if (movie.infoHash) {
            primarySrc = `../app_data/downloads/${movie.infoHash}/poster.jpg`;
        } else {
            primarySrc = remoteSrc;
        }

        // Duration formatting (handle runtime OR duration field)
        let durationStr = '';
        const runTimeVal = movie.runtime || movie.duration;
        if (runTimeVal) {
            const hrs = Math.floor(runTimeVal / 60);
            const mins = runTimeVal % 60;
            durationStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        }

        card.innerHTML = `
            <img class="movie-poster" src="${this.sanitize(primarySrc || '')}" alt="${this.sanitize(movie.title)}" loading="lazy">
            <div class="movie-overlay">
                <div class="movie-header">
                     ${movie.rating ? `<span class="movie-rating">★ ${movie.rating}</span>` : ''}
                </div>
                <div class="movie-content">
                    <div class="movie-title">${this.sanitize(movie.title)}</div>
                    <div class="movie-meta">
                        <span class="movie-year">${this.sanitize(String(movie.year || ''))}</span>
                        ${durationStr ? `<span class="movie-runtime">• ${durationStr}</span>` : ''}
                    </div>
                </div>
            </div>
        `;

        const img = card.querySelector('.movie-poster');
        const placeholder = 'assets/placeholder_glass.png';

        img.onerror = function () {
            // Level 1: Remote
            if (remoteSrc && primarySrc !== remoteSrc && !this.src.includes(remoteSrc)) {
                this.src = remoteSrc;
                return;
            }
            // Level 2: Branded Placeholder
            if (!this.src.includes('placeholder_glass.png')) {
                this.src = placeholder;
            }
        };

        card.addEventListener('click', () => this.openModal(movie));
        return card;
    },

    renderGrid(movies) {
        App.dom.grid.innerHTML = '';

        if (!movies || movies.length === 0) {
            App.dom.grid.innerHTML = '<div style="color: white; text-align: center; margin-top: 50px;">No movies found</div>';
            return;
        }

        movies.forEach(movie => {
            const card = this.createCardElement(movie);
            App.dom.grid.appendChild(card);
        });
    },

    appendToGrid(movies) {
        if (!movies || movies.length === 0) return;
        movies.forEach(movie => {
            const card = this.createCardElement(movie);
            App.dom.grid.appendChild(card);
        });
    },

    showEmptyState(query) {
        App.dom.grid.innerHTML = `
            <div class="empty-state" style="color: white; text-align: center; margin-top: 50px;">
                <h2>No results found</h2>
                <p>We couldn't find any movies matching "${this.sanitize(query)}"</p>
            </div>
        `;
    },

    showError(message) {
        App.dom.grid.innerHTML = `<div style="color: #ff4444; text-align: center; margin-top: 50px;">Error: ${this.sanitize(message)}</div>`;
    },

    // Init Visuals
    init() {
        // Modal close handlers
        App.dom.modal.close.addEventListener('click', () => this.closeModal());
        App.dom.modal.backdrop.addEventListener('click', (e) => {
            if (e.target === App.dom.modal.backdrop) this.closeModal();
        });
    }
};

console.log('[UI] Module loaded');

const Library = {
    init() {
        this.dom = {
            favoritesGrid: document.getElementById('lib-favorites'),
            watchlistGrid: document.getElementById('lib-watchlist'),
            favoritesEmpty: document.getElementById('favorites-empty'),
            watchlistEmpty: document.getElementById('watchlist-empty')
        };
    },

    async load(mode = 'library') {
        try {
            if (mode === 'downloads') {
                // Downloads Mode
                const downloads = await window.api.store.getAllDownloads();
                this.renderGrid(downloads, 'downloads');

                // Hide library sections
                if (this.dom.favoritesGrid) this.dom.favoritesGrid.parentElement.style.display = 'none';
                if (this.dom.watchlistGrid) this.dom.watchlistGrid.parentElement.style.display = 'none';

                // Show downloads section (we need to ensure this container exists or create it)
                let downloadsSection = document.getElementById('lib-section-downloads');
                if (downloadsSection) {
                    downloadsSection.style.display = 'block';
                }

            } else {
                // Library Mode (Favorites + Watchlist)
                const library = await window.api.store.getLibrary();
                this.renderGrid(library.favorites, 'favorites');
                this.renderGrid(library.watchlist, 'watchlist');

                if (this.dom.favoritesGrid) this.dom.favoritesGrid.parentElement.style.display = 'block';
                if (this.dom.watchlistGrid) this.dom.watchlistGrid.parentElement.style.display = 'block';

                const downloadsSection = document.getElementById('lib-section-downloads');
                if (downloadsSection) downloadsSection.style.display = 'none';
            }

        } catch (e) {
            console.error('[Library] Load error:', e);
            Toast.show('Error al cargar la biblioteca', 'error');
        }
    },

    renderGrid(movies, type) {
        // ... (existing logic, just need to ensure 'downloads' type maps to a DOM element)
        let grid, emptyState;

        if (type === 'downloads') {
            grid = document.getElementById('lib-downloads');
            emptyState = document.getElementById('downloads-empty');
        } else {
            grid = this.dom[`${type}Grid`];
            emptyState = this.dom[`${type}Empty`];
        }

        if (!grid || !emptyState) return;

        grid.innerHTML = '';

        if (!movies || movies.length === 0) {
            grid.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }

        grid.classList.add('movies-grid'); // Apply CSS Grid styles
        grid.style.display = 'grid';
        emptyState.style.display = 'none';

        movies.forEach(movie => {
            // Priority: Local Poster for Downloads
            if (type === 'downloads' && movie.infoHash) {
                // Construct relative path to app_data/downloads
                // Assuming index.html is in src/ and app_data is in root
                movie.localPoster = `../app_data/downloads/${movie.infoHash}/poster.jpg`;
            }

            const card = window.UI.createCardElement(movie);
            grid.appendChild(card);
        });
    }
};

/**
 * MetadataService - Encapsulates all metadata enrichment logic
 * 
 * Responsibilities:
 * - Fetching from TMDb API
 * - Caching via window.api.store
 * - Silent error handling (returns original on failure)
 * - API key management
 */

const MetadataService = {
    // Lazy-loaded API key
    _apiKey: null,

    // TMDb API base URL
    API_BASE: 'https://api.themoviedb.org/3',

    // Language for localized content
    LANGUAGE: 'es-AR',

    /**
     * Get API key from environment (lazy load)
     * @returns {Promise<string|null>}
     */
    async _getApiKey() {
        if (!this._apiKey) {
            try {
                this._apiKey = await window.api.getTmdbApiKey();
            } catch (e) {
                console.error('[MetadataService] Failed to get API key:', e);
            }
        }
        return this._apiKey;
    },

    /**
     * Fetch movie data from TMDb by IMDB ID
     * @param {string} imdbCode - IMDB ID (e.g., 'tt0133093')
     * @returns {Promise<Object|null>} Normalized metadata or null
     */
    async fetchFromTMDb(imdbCode) {
        const apiKey = await this._getApiKey();
        if (!apiKey) {
            console.warn('[MetadataService] No API key available');
            return null;
        }

        try {
            // Step 1: Find by IMDB ID
            const findUrl = `${this.API_BASE}/find/${imdbCode}?api_key=${apiKey}&external_source=imdb_id&language=${this.LANGUAGE}`;
            const findRes = await fetch(findUrl);

            if (!findRes.ok) {
                console.warn(`[MetadataService] Find request failed: ${findRes.status}`);
                return null;
            }

            const findData = await findRes.json();
            const movieResult = findData.movie_results?.[0];

            if (!movieResult) {
                console.warn(`[MetadataService] No movie found for IMDB: ${imdbCode}`);
                return null;
            }

            // Step 2: Get full details (includes runtime)
            const detailUrl = `${this.API_BASE}/movie/${movieResult.id}?api_key=${apiKey}&language=${this.LANGUAGE}`;
            const detailRes = await fetch(detailUrl);

            if (!detailRes.ok) {
                // Fallback: use find result without details
                console.warn(`[MetadataService] Detail request failed, using find result`);
                return MovieMapper.normalizeTMDbMovie(movieResult, null);
            }

            const details = await detailRes.json();

            // Step 3: Normalize via MovieMapper
            return MovieMapper.normalizeTMDbMovie(movieResult, details);

        } catch (e) {
            console.error(`[MetadataService] Fetch error for ${imdbCode}:`, e);
            return null;
        }
    },

    /**
     * Enrich a movie with metadata (with caching)
     * SILENT FAILURE: Returns original movie if enrichment fails
     * 
     * @param {Object} movie - Movie object with imdb_code
     * @returns {Promise<Object>} Enriched movie (or original on failure)
     */
    async enrich(movie) {
        if (!movie?.imdb_code) return movie;

        try {
            // 1. Check cache first
            let cached = await window.api.store.getMetadata(movie.imdb_code);

            if (cached) {
                // Apply cached data to movie
                MovieMapper.applyToMovie(movie, cached);
                return { movie, metadata: cached, fromCache: true };
            }

            // 2. Fetch from TMDb
            const metadata = await this.fetchFromTMDb(movie.imdb_code);

            if (metadata) {
                // 3. Save to cache
                window.api.store.saveMetadata(movie.imdb_code, metadata);

                // 4. Apply to movie
                MovieMapper.applyToMovie(movie, metadata);
                return { movie, metadata, fromCache: false };
            }

            // No metadata found - return original movie
            return { movie, metadata: null, fromCache: false };

        } catch (e) {
            console.warn(`[MetadataService] Enrich failed for ${movie.imdb_code}:`, e);
            // SILENT FAILURE: Return original movie
            return { movie, metadata: null, fromCache: false };
        }
    },

    /**
     * Enrich multiple movies in concurrent batches
     * Progressive UI updates as each batch completes
     * 
     * @param {Array} movies - Array of movie objects
     * @param {Function} onUpdate - Callback for each enriched movie (imdbCode, metadata)
     * @param {number} batchSize - Number of concurrent requests (default: 5)
     */
    async enrichBatch(movies, onUpdate, batchSize = 5) {
        if (!movies || movies.length === 0) return;

        // Filter movies that need enrichment
        const toEnrich = movies.filter(m => m.imdb_code);

        for (let i = 0; i < toEnrich.length; i += batchSize) {
            const batch = toEnrich.slice(i, i + batchSize);

            // Process batch concurrently
            const results = await Promise.allSettled(
                batch.map(movie => this.enrich(movie))
            );

            // Process results and trigger UI updates
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value.metadata) {
                    const { movie, metadata } = result.value;
                    if (onUpdate && movie.imdb_code) {
                        onUpdate(movie.imdb_code, metadata);
                    }
                }
            });

            // Small delay between batches to be nice to the event loop
            if (i + batchSize < toEnrich.length) {
                await new Promise(r => setTimeout(r, 50));
            }
        }
    }
};

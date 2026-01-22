/**
 * MovieMapper - Pure normalization functions
 * Transforms TMDb API responses to Glass Cinema standard format
 * 
 * This module has NO side effects and NO network calls.
 * If we switch APIs in the future, only this file needs to change.
 */

const MovieMapper = {
    /**
     * TMDb image base URL
     */
    IMAGE_BASE: 'https://image.tmdb.org/t/p',

    /**
     * Normalizes TMDb response to Glass Cinema standard format
     * @param {Object} findResult - Result from /find endpoint (optional)
     * @param {Object} details - Result from /movie/{id} endpoint
     * @returns {Object} Normalized movie metadata
     */
    normalizeTMDbMovie(findResult, details) {
        // Handle null/undefined inputs gracefully
        if (!details && !findResult) return null;

        const source = details || findResult;
        const posterPath = details?.poster_path || findResult?.poster_path;

        return {
            // Identifiers
            tmdb_id: source.id,

            // Rating (TMDb uses 0-10 scale, same as IMDB)
            rating: details?.vote_average ?? null,

            // Runtime (TMDb returns integer minutes directly)
            runtime: details?.runtime ?? null,

            // Synopsis (prioritize details which may have localized content)
            description_full: details?.overview || findResult?.overview || null,
            summary: details?.overview || findResult?.overview || null,

            // Images (construct full URLs)
            medium_cover_image: posterPath
                ? `${this.IMAGE_BASE}/w500${posterPath}`
                : null,
            large_cover_image: posterPath
                ? `${this.IMAGE_BASE}/w780${posterPath}`
                : null,
            background_image: posterPath
                ? `${this.IMAGE_BASE}/original${posterPath}`
                : null,

            // For UI.updateCard compatibility
            poster_path: posterPath,
            vote_average: details?.vote_average ?? null
        };
    },

    /**
     * Applies normalized metadata to a movie object
     * Only overwrites fields that have valid values
     * @param {Object} movie - Original movie object
     * @param {Object} normalized - Normalized metadata from TMDb
     * @returns {Object} Movie with applied metadata
     */
    applyToMovie(movie, normalized) {
        if (!normalized) return movie;

        // Only apply non-null values
        if (normalized.rating != null) movie.rating = normalized.rating;
        if (normalized.runtime != null) movie.runtime = normalized.runtime;
        if (normalized.description_full) movie.description_full = normalized.description_full;
        if (normalized.summary) movie.summary = normalized.summary;
        if (normalized.medium_cover_image) movie.medium_cover_image = normalized.medium_cover_image;
        if (normalized.large_cover_image) movie.large_cover_image = normalized.large_cover_image;
        if (normalized.background_image) movie.background_image = normalized.background_image;

        return movie;
    }
};

/**
 * Magnet URI Utilities
 */
const MagnetUtils = {
    buildMagnetUri(hash, title) {
        if (!hash) return null;
        return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title || 'Unknown')}`;
    },

    extractInfoHash(magnet) {
        if (!magnet) return null;
        const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    },

    isValidMagnet(magnet) {
        return magnet && magnet.startsWith('magnet:?') && magnet.includes('xt=urn:btih:');
    }
};

console.log('[MagnetUtils] Module loaded');

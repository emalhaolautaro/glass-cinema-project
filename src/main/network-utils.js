/**
 * Network Utilities Module
 * Provides IP detection and security middleware for Cast functionality
 */
const os = require('os');

/**
 * Get the local IPv4 address of this machine
 * Prioritizes private network ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 * Ignores virtual interfaces (WSL, Docker, vEthernet)
 * @returns {string} Local IP address or '127.0.0.1' as fallback
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    let bestCandidate = null;

    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        // Strict filtering of virtual interfaces
        if (lowerName.includes('vethernet') ||
            lowerName.includes('wsl') ||
            lowerName.includes('docker') ||
            lowerName.includes('virtual') ||
            lowerName.includes('pseudo') ||
            lowerName.includes('vmware') ||
            lowerName.includes('tap') ||
            lowerName.includes('tun')) {
            continue;
        }

        for (const iface of interfaces[name]) {
            // Skip internal (loopback) and non-IPv4 addresses
            if (iface.internal || iface.family !== 'IPv4') continue;

            // Strict Priority 1: 192.168.x.x (Home networks - specific request)
            if (iface.address.startsWith('192.168.')) {
                return iface.address;
            }

            // Priority 2: Other Private network ranges
            if (isPrivateIP(iface.address)) {
                if (!bestCandidate) bestCandidate = iface.address;
            }
        }
    }

    return bestCandidate || '127.0.0.1';
}

/**
 * Check if an IP address is in a private range
 * @param {string} ip - IP address to check
 * @returns {boolean} True if private
 */
function isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0 - 10.255.255.255 (Class A)
    if (parts[0] === 10) return true;

    // 172.16.0.0 - 172.31.255.255 (Class B)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0 - 192.168.255.255 (Class C)
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 169.254.0.0 - 169.254.255.255 (Link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;

    return false;
}

/**
 * Get the subnet of an IP (first 3 octets for /24)
 * @param {string} ip - IP address
 * @returns {string} Subnet prefix
 */
function getSubnet(ip) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/**
 * Middleware to validate that a request comes from the local network
 * Used to secure the streaming server when Cast mode is enabled
 * @param {object} req - HTTP request object
 * @param {object} res - HTTP response object
 * @param {function} next - Next middleware function
 * @returns {void}
 */
function isLocalRequest(req, res, next) {
    // Get client IP from request
    let clientIP = req.socket.remoteAddress || req.connection.remoteAddress;

    // Handle IPv6-mapped IPv4 addresses (::ffff:192.168.1.100)
    if (clientIP && clientIP.startsWith('::ffff:')) {
        clientIP = clientIP.substring(7);
    }

    // Always allow localhost
    if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === 'localhost') {
        return next ? next() : true;
    }

    // Check if client is in a private IP range
    if (isPrivateIP(clientIP)) {
        // Additional check: same subnet as server
        const serverIP = getLocalIP();
        const serverSubnet = getSubnet(serverIP);
        const clientSubnet = getSubnet(clientIP);

        if (serverSubnet === clientSubnet) {
            console.log(`[NetworkUtils] Allowed local request from ${clientIP}`);
            return next ? next() : true;
        }
    }

    console.warn(`[NetworkUtils] Blocked request from non-local IP: ${clientIP}`);
    if (res) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Only local network access allowed');
    }
    return false;
}

/**
 * Simple validation function (non-middleware version)
 * @param {string} clientIP - Client IP to validate
 * @returns {boolean} True if request is from local network
 */
function validateLocalIP(clientIP) {
    // Handle IPv6-mapped IPv4
    if (clientIP && clientIP.startsWith('::ffff:')) {
        clientIP = clientIP.substring(7);
    }

    // Always allow localhost
    if (clientIP === '127.0.0.1' || clientIP === '::1') {
        return true;
    }

    // Check if client is in same subnet
    if (isPrivateIP(clientIP)) {
        const serverIP = getLocalIP();
        return getSubnet(serverIP) === getSubnet(clientIP);
    }

    return false;
}

/**
 * Extract InfoHash from a magnet link or return the hash if it's already one
 * @param {string} magnet - Magnet URI or InfoHash
 * @returns {string|null} InfoHash or null
 */
function extractInfoHash(magnet) {
    if (!magnet) return null;

    // Check if it's already a hash (20 bytes hex = 40 chars, or 32 chars for base32)
    const clean = magnet.trim();
    if (/^[a-fA-F0-9]{40}$/.test(clean)) return clean.toLowerCase();

    // Check regex for magnet link
    const match = clean.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
    return match ? match[1].toLowerCase() : null;
}

module.exports = {
    getLocalIP,
    isPrivateIP,
    isLocalRequest,
    validateLocalIP,
    getSubnet,
    extractInfoHash
};

/**
 * OpenContext Native Bindings Loader
 * 
 * Centralized module for loading Rust native bindings.
 * All native-dependent modules should import from here.
 * 
 * Loading order:
 * 1. Try npm package (@aicontextlab/core-native) - for production
 * 2. Try local build (crates/opencontext-node) - for development
 */

const path = require('path');

let native = null;
let nativeError = null;
let npmError = null;
let localError = null;
let initialized = false;
let loadedFrom = null;

/**
 * Load native bindings (lazy, singleton)
 */
function loadNative() {
  if (initialized) return;
  initialized = true;
  
  // Try 1: Load from npm package (production)
  try {
    native = require('@aicontextlab/core-native');
    loadedFrom = 'npm';
    return;
  } catch (e) {
    npmError = e;
    // Not installed via npm, try local
  }
  
  // Try 2: Load from local build (development)
  try {
    const nativePath = path.join(__dirname, '../../crates/opencontext-node');
    native = require(nativePath);
    loadedFrom = 'local';
  } catch (e) {
    localError = e;
    nativeError = e;
  }
}

// Load on first import
loadNative();

/**
 * Check if native bindings are available
 * @returns {boolean}
 */
function isAvailable() {
  return native !== null;
}

/**
 * Get the error if native bindings failed to load
 * @returns {Error|null}
 */
function getError() {
  return nativeError;
}

/**
 * Get native bindings, throws if not available
 * @returns {Object} Native module
 * @throws {Error} If native bindings are not available
 */
function get() {
  if (!native) {
    throw new Error(
      `OpenContext native bindings not available.\n` +
      `  If installed via npm: try reinstalling the package\n` +
      `  If developing locally: cd crates/opencontext-node && npm run build\n` +
      `  If optional deps were skipped: npm install -g @aicontextlab/cli --include=optional\n` +
      `Error (npm): ${npmError?.message || 'unknown'}\n` +
      `Error (local): ${localError?.message || 'unknown'}`
    );
  }
  return native;
}

/**
 * Require native bindings to be available (throws on load failure)
 * Call this at module load time if native is required.
 */
function require_() {
  if (!native) {
    throw new Error(
      `OpenContext native bindings not available.\n` +
      `  If installed via npm: try reinstalling the package\n` +
      `  If developing locally: cd crates/opencontext-node && npm run build\n` +
      `  If optional deps were skipped: npm install -g @aicontextlab/cli --include=optional\n` +
      `Error (npm): ${npmError?.message || 'unknown'}\n` +
      `Error (local): ${localError?.message || 'unknown'}`
    );
  }
}

/**
 * Get info about where native was loaded from
 * @returns {'npm'|'local'|null}
 */
function getLoadedFrom() {
  return loadedFrom;
}

module.exports = {
  isAvailable,
  getError,
  get,
  require: require_,
  getLoadedFrom,
  
  // Direct access (for advanced use)
  get native() { return native; },
};

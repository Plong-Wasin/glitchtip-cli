import pkg from '../../package.json' with { type: 'json' };

// The JSON is inlined by the bundler, so the single-file build needs no package.json at runtime.
export const VERSION: string = pkg.version;
export const PROTOCOL_VERSION = '2025-06-18';

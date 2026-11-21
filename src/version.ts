// The server's name and version, as reported in MCP serverInfo and /health. The release workflow
// stamps the version (scripts/release-version.ts rewrites the line carrying the marker);
// src/version.test.ts fails if it drifts from package.json.
export const SERVER_NAME = 'Capture MCP Server';
export const SERVER_VERSION = '1.0.2'; // x-release-version

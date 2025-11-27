/**
 * API Key Management CLI for Capture MCP Server
 * 
 * Manages API keys stored in S3 for the "Dirt Cheap" serverless deployment method.
 * 
 * Configuration:
 *   The CLI reads config from .capture-mcp.json (created by `npm run sync-config`)
 *   or falls back to environment variables:
 *   - API_KEY_BUCKET: S3 bucket name for API keys
 *   - API_KEY_PREFIX: Object key prefix (default: "api-keys/")
 *   - AWS_REGION: AWS region (default: "us-east-1")
 * 
 * Commands:
 *   create --owner "John Doe" [--expires "2025-12-31"]
 *     Creates a new API key. The key is shown once and cannot be retrieved later.
 * 
 *   list
 *     Lists all API keys with owner, dates, and hash prefixes.
 * 
 *   revoke <api-key-or-hash>
 *     Revokes an API key. Accepts either:
 *     - The actual API key (cap_xxx...) if you have it
 *     - The hash prefix from `list` output (e.g., 47a4477fec8c44f1)
 *     This allows admins to revoke keys without knowing the original key.
 * 
 *   verify <api-key>
 *     Verifies an API key is valid and shows its metadata.
 * 
 * Usage:
 *   npm run manage-keys -- create --owner "John Doe"
 *   npm run manage-keys -- create --owner "Jane Smith" --expires "2025-12-31"
 *   npm run manage-keys -- list
 *   npm run manage-keys -- revoke 47a4477fec8c44f1   # by hash prefix (admin-friendly)
 *   npm run manage-keys -- revoke cap_abc123...      # by actual key
 *   npm run manage-keys -- verify cap_abc123...
 */

import { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand, 
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

interface CaptureConfig {
  apiKeyBucket: string;
  apiKeyPrefix: string;
  region: string;
  stackName?: string;
  mcpEndpoint?: string;
  healthEndpoint?: string;
  lastSynced?: string;
}

/**
 * Load configuration from .capture-mcp.json if it exists
 */
function loadConfig(): CaptureConfig | null {
  const configPath = join(process.cwd(), '.capture-mcp.json');
  
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as CaptureConfig;
    } catch (err) {
      console.warn('Warning: Failed to parse .capture-mcp.json, falling back to env vars');
      return null;
    }
  }
  return null;
}

// Try to load from config file first, then fall back to environment variables
const config = loadConfig();

const BUCKET = config?.apiKeyBucket || process.env.API_KEY_BUCKET;
const PREFIX = config?.apiKeyPrefix || process.env.API_KEY_PREFIX || 'api-keys/';
const REGION = config?.region || process.env.AWS_REGION || 'us-east-1';

// Debug: Show config source
if (config) {
  console.log(`Using config from .capture-mcp.json (synced: ${config.lastSynced || 'unknown'})`);
  console.log('');
}

// API key format: cap_<32 random hex chars> (36 chars total)
const API_KEY_PREFIX = 'cap_';
const API_KEY_BYTES = 16; // 16 bytes = 32 hex chars

const s3Client = new S3Client({ region: REGION });

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Hash an API key for storage lookup (SHA-256)
 * Must match the implementation in src/middleware/s3-api-key.ts
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new random API key
 */
function generateApiKey(): string {
  const randomPart = randomBytes(API_KEY_BYTES).toString('hex');
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): { command: string; positional: string[]; options: Record<string, string> } {
  const command = args[0] || 'help';
  const positional: string[] = [];
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        options[key] = value;
        i++; // Skip the value
      } else {
        options[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

/**
 * Format a date for display
 */
function formatDate(date: Date | undefined): string {
  if (!date) return 'Never';
  return date.toISOString().split('T')[0];
}

/**
 * Check if environment is configured
 */
function checkConfig(): void {
  if (!BUCKET) {
    console.error('Error: API key bucket is not configured.');
    console.error('');
    console.error('Option 1 - Sync from deployed stack (recommended):');
    console.error('  npm run sync-config');
    console.error('');
    console.error('Option 2 - Set environment variable manually:');
    console.error('  export API_KEY_BUCKET=your-bucket-name');
    console.error('');
    console.error('The sync-config command reads the bucket name from your deployed');
    console.error('CloudFormation stack and saves it to .capture-mcp.json');
    process.exit(1);
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Create a new API key
 */
async function createKey(owner: string, expiresStr?: string): Promise<void> {
  checkConfig();

  if (!owner) {
    console.error('Error: --owner is required');
    console.error('Usage: npx ts-node scripts/manage-keys.ts create --owner "John Doe" [--expires "2025-12-31"]');
    process.exit(1);
  }

  // Validate expiration date if provided
  let expires: Date | undefined;
  if (expiresStr) {
    expires = new Date(expiresStr);
    if (isNaN(expires.getTime())) {
      console.error(`Error: Invalid date format: ${expiresStr}`);
      console.error('Use ISO 8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss');
      process.exit(1);
    }
    // Set to end of day if only date provided
    if (!expiresStr.includes('T')) {
      expires.setUTCHours(23, 59, 59, 999);
    }
  }

  // Generate new key
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);
  const objectKey = `${PREFIX}${keyHash}`;
  const created = new Date();

  // Build metadata
  const metadata: Record<string, string> = {
    owner,
    created: created.toISOString(),
  };
  if (expires) {
    metadata.expires = expires.toISOString();
  }

  try {
    console.log(`Creating API key for owner: ${owner}`);
    console.log(`Bucket: ${BUCKET}`);
    console.log(`Object: ${objectKey}`);

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      Body: '',
      ContentLength: 0, // Explicit length silences SDK warning
      Metadata: metadata,
      ContentType: 'application/x-api-key',
    }));

    console.log('');
    console.log('✅ API key created successfully!');
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  IMPORTANT: Save this key now. It cannot be retrieved later!   ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  API Key: ${apiKey}  ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Owner:   ${owner}`);
    console.log(`Created: ${formatDate(created)}`);
    console.log(`Expires: ${formatDate(expires)}`);
    console.log('');
    console.log('Use this key in the X-Api-Key header when calling the MCP server.');

  } catch (error) {
    handleS3Error(error, 'create key');
  }
}

/**
 * List all API keys
 */
async function listKeys(): Promise<void> {
  checkConfig();

  try {
    console.log(`Listing API keys from s3://${BUCKET}/${PREFIX}`);
    console.log('');

    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
    }));

    const objects = response.Contents || [];
    
    if (objects.length === 0) {
      console.log('No API keys found.');
      return;
    }

    console.log(`Found ${objects.length} API key(s):`);
    console.log('');
    console.log('Hash (first 16 chars)     Owner                Created      Expires      Status');
    console.log('─'.repeat(90));

    for (const obj of objects) {
      if (!obj.Key) continue;

      // Get metadata for each key
      try {
        const headResponse = await s3Client.send(new HeadObjectCommand({
          Bucket: BUCKET,
          Key: obj.Key,
        }));

        const metadata = headResponse.Metadata || {};
        const owner = metadata.owner || 'Unknown';
        const created = metadata.created ? new Date(metadata.created) : undefined;
        const expires = metadata.expires ? new Date(metadata.expires) : undefined;
        
        // Check status
        let status = '✅ Active';
        if (expires && expires < new Date()) {
          status = '❌ Expired';
        }

        // Extract hash from key path
        const hash = obj.Key.replace(PREFIX, '').slice(0, 16);

        console.log(
          `${hash.padEnd(24)} ` +
          `${owner.slice(0, 20).padEnd(20)} ` +
          `${formatDate(created).padEnd(12)} ` +
          `${formatDate(expires).padEnd(12)} ` +
          `${status}`
        );
      } catch (err) {
        const hash = obj.Key.replace(PREFIX, '').slice(0, 16);
        console.log(`${hash.padEnd(24)} (error reading metadata)`);
      }
    }

    console.log('');
    console.log('Note: Full key hashes are truncated for readability.');
    console.log('Use "verify <api-key>" to check a specific key.');

  } catch (error) {
    handleS3Error(error, 'list keys');
  }
}

/**
 * Find S3 object key by hash prefix
 * Used when admin only knows the truncated hash from `list` output
 */
async function findKeyByHashPrefix(hashPrefix: string): Promise<string | null> {
  const response = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: PREFIX,
  }));

  const objects = response.Contents || [];
  const matches = objects.filter(obj => {
    if (!obj.Key) return false;
    const hash = obj.Key.replace(PREFIX, '');
    return hash.startsWith(hashPrefix);
  });

  if (matches.length === 0) {
    return null;
  }
  
  if (matches.length > 1) {
    console.error(`Error: Hash prefix "${hashPrefix}" matches ${matches.length} keys.`);
    console.error('Please provide a longer prefix to uniquely identify the key.');
    console.error('');
    console.error('Matching keys:');
    for (const match of matches) {
      const hash = match.Key!.replace(PREFIX, '');
      console.error(`  ${hash.slice(0, 24)}...`);
    }
    process.exit(1);
  }

  return matches[0].Key!;
}

/**
 * Revoke (delete) an API key
 * Accepts either:
 *   - The actual API key (cap_xxx) - will be hashed to find the S3 object
 *   - The hash or hash prefix from `list` output - looked up directly
 */
async function revokeKey(keyOrHash: string): Promise<void> {
  checkConfig();

  if (!keyOrHash) {
    console.error('Error: API key or hash is required');
    console.error('');
    console.error('Usage:');
    console.error('  npm run manage-keys -- revoke <api-key>      # e.g., cap_abc123...');
    console.error('  npm run manage-keys -- revoke <hash-prefix>  # e.g., 47a4477fec8c44f1');
    console.error('');
    console.error('Tip: Use `npm run manage-keys -- list` to see hash prefixes');
    process.exit(1);
  }

  let objectKey: string;

  // Check if input looks like an API key (starts with cap_) or a hash
  if (keyOrHash.startsWith(API_KEY_PREFIX)) {
    // It's an API key - hash it to get the S3 object key
    const keyHash = hashApiKey(keyOrHash);
    objectKey = `${PREFIX}${keyHash}`;
    console.log(`Looking up key by API key hash: ${keyHash.slice(0, 16)}...`);
  } else {
    // It's a hash or hash prefix - look it up directly
    console.log(`Looking up key by hash prefix: ${keyOrHash}...`);
    const found = await findKeyByHashPrefix(keyOrHash);
    if (!found) {
      console.error(`Error: No key found with hash prefix "${keyOrHash}"`);
      console.error('Use `npm run manage-keys -- list` to see available keys.');
      process.exit(1);
    }
    objectKey = found;
  }

  try {
    // Get key metadata before deleting (for confirmation)
    let owner = 'Unknown';
    try {
      const headResponse = await s3Client.send(new HeadObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
      }));
      owner = headResponse.Metadata?.owner || 'Unknown';
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err) {
        const errorName = (err as { name: string }).name;
        if (errorName === 'NotFound' || errorName === 'NoSuchKey') {
          console.error('Error: API key not found. It may have already been revoked.');
          process.exit(1);
        }
      }
      throw err;
    }

    // Delete the key
    const hash = objectKey.replace(PREFIX, '');
    console.log(`Revoking API key for owner: ${owner}`);
    console.log(`Hash: ${hash.slice(0, 16)}...`);
    
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
    }));

    console.log('');
    console.log('✅ API key revoked successfully!');
    console.log('');
    console.log('The key will no longer be accepted for authentication.');

  } catch (error) {
    handleS3Error(error, 'revoke key');
  }
}

/**
 * Verify an API key
 */
async function verifyKey(apiKey: string): Promise<void> {
  checkConfig();

  if (!apiKey) {
    console.error('Error: API key is required');
    console.error('Usage: npx ts-node scripts/manage-keys.ts verify <api-key>');
    process.exit(1);
  }

  const keyHash = hashApiKey(apiKey);
  const objectKey = `${PREFIX}${keyHash}`;

  try {
    console.log(`Verifying API key...`);
    console.log(`Hash: ${keyHash.slice(0, 16)}...`);
    console.log('');

    const response = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
    }));

    const metadata = response.Metadata || {};
    const owner = metadata.owner || 'Unknown';
    const created = metadata.created ? new Date(metadata.created) : undefined;
    const expires = metadata.expires ? new Date(metadata.expires) : undefined;

    // Check if expired
    const isExpired = expires && expires < new Date();

    if (isExpired) {
      console.log('❌ API key is INVALID (expired)');
      console.log('');
      console.log(`Owner:   ${owner}`);
      console.log(`Created: ${formatDate(created)}`);
      console.log(`Expired: ${formatDate(expires)}`);
      process.exit(1);
    }

    console.log('✅ API key is VALID');
    console.log('');
    console.log(`Owner:   ${owner}`);
    console.log(`Created: ${formatDate(created)}`);
    console.log(`Expires: ${formatDate(expires)}`);

  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error) {
      const errorName = (error as { name: string }).name;
      if (errorName === 'NotFound' || errorName === 'NoSuchKey') {
        console.log('❌ API key is INVALID (not found)');
        console.log('');
        console.log('The key does not exist or has been revoked.');
        process.exit(1);
      }
    }
    handleS3Error(error, 'verify key');
  }
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
API Key Management CLI for Capture MCP Server

Usage:
  npm run manage-keys -- <command> [options]

Commands:
  create --owner "Name" [--expires "YYYY-MM-DD"]
    Create a new API key for the specified owner.
    The API key will be displayed once and cannot be retrieved later.

  list
    List all API keys with their owner, creation date, and expiration.

  revoke <api-key-or-hash>
    Revoke an API key. Accepts either:
    - The actual API key (cap_xxx...)
    - The hash prefix from 'list' output (e.g., 47a4477fec8c44f1)

  verify <api-key>
    Check if an API key is valid and show its metadata.

  help
    Show this help message.

Environment Variables:
  API_KEY_BUCKET  (required) S3 bucket name for API keys
  API_KEY_PREFIX  (optional) S3 key prefix (default: "api-keys/")
  AWS_REGION      (optional) AWS region (default: "us-east-1")

Examples:
  # Set up environment
  export API_KEY_BUCKET=my-capture-api-keys

  # Create a key that never expires
  npm run manage-keys -- create --owner "John Doe"

  # Create a key that expires at end of 2025
  npm run manage-keys -- create --owner "Jane Smith" --expires "2025-12-31"

  # List all keys
  npm run manage-keys -- list

  # Verify a key
  npm run manage-keys -- verify cap_abc123def456...

  # Revoke a key (by hash prefix from 'list' output)
  npm run manage-keys -- revoke 47a4477fec8c44f1

  # Revoke a key (by actual API key)
  npm run manage-keys -- revoke cap_abc123def456...
`);
}

/**
 * Handle S3 errors with helpful messages
 */
function handleS3Error(error: unknown, operation: string): never {
  console.error(`Error during ${operation}:`);
  console.error('');

  if (error && typeof error === 'object') {
    const err = error as { name?: string; message?: string; Code?: string };
    
    if (err.name === 'NoSuchBucket' || err.Code === 'NoSuchBucket') {
      console.error(`Bucket "${BUCKET}" does not exist.`);
      console.error('Make sure the bucket exists and API_KEY_BUCKET is set correctly.');
    } else if (err.name === 'AccessDenied' || err.Code === 'AccessDenied') {
      console.error('Access denied. Check your AWS credentials and IAM permissions.');
      console.error('Required permissions: s3:PutObject, s3:GetObject, s3:DeleteObject, s3:ListBucket');
    } else if (err.name === 'CredentialsProviderError' || err.message?.includes('credentials')) {
      console.error('AWS credentials not found or invalid.');
      console.error('');
      console.error('Configure credentials using one of these methods:');
      console.error('  1. AWS CLI: aws configure');
      console.error('  2. Environment variables: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
      console.error('  3. IAM role (if running on AWS)');
    } else {
      console.error(`${err.name || 'Error'}: ${err.message || 'Unknown error'}`);
    }
  } else {
    console.error(String(error));
  }

  process.exit(1);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, positional, options } = parseArgs(args);

  switch (command) {
    case 'create':
      await createKey(options.owner, options.expires);
      break;
    case 'list':
      await listKeys();
      break;
    case 'revoke':
      await revokeKey(positional[0]);
      break;
    case 'verify':
      await verifyKey(positional[0]);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Use "help" to see available commands.');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});


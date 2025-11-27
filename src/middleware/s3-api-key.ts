/**
 * S3-based API Key Validation Middleware
 * 
 * Validates API keys by checking for existence in an S3 bucket.
 * Keys are stored as objects at: s3://{bucket}/api-keys/{api-key-hash}/
 * 
 * Metadata fields:
 * - x-amz-meta-owner: User identifier string (required)
 * - x-amz-meta-expires: ISO 8601 expiration date (optional)
 * - x-amz-meta-created: ISO 8601 creation date
 * 
 * Environment Variables:
 * - API_KEY_BUCKET: S3 bucket name for API keys
 * - API_KEY_PREFIX: Object key prefix (default: "api-keys/")
 */

import { S3Client, HeadObjectCommand, HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

// Initialize S3 client (uses default credential chain - IAM role in Lambda)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  owner?: string;
  expires?: Date;
  created?: Date;
  error?: string;
}

/**
 * Extended Express Request with API key info
 */
export interface AuthenticatedRequest extends Request {
  apiKeyOwner?: string;
  apiKeyExpires?: Date;
}

/**
 * Hash an API key for storage lookup
 * Using SHA-256 so we never store raw keys
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Validate an API key against S3
 * 
 * @param apiKey - The raw API key from the request
 * @returns Validation result with owner info if valid
 */
export async function validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
  const bucket = process.env.API_KEY_BUCKET;
  const prefix = process.env.API_KEY_PREFIX || 'api-keys/';

  if (!bucket) {
    console.error('[S3ApiKeyAuth] API_KEY_BUCKET environment variable not set');
    return { valid: false, error: 'Server misconfiguration: API key bucket not configured' };
  }

  const keyHash = hashApiKey(apiKey);
  const objectKey = `${prefix}${keyHash}`;

  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: objectKey
    });

    const response: HeadObjectCommandOutput = await s3Client.send(command);

    // Extract metadata (S3 lowercases custom metadata keys)
    const owner = response.Metadata?.['owner'];
    const expiresStr = response.Metadata?.['expires'];
    const createdStr = response.Metadata?.['created'];

    // Parse dates
    const expires = expiresStr ? new Date(expiresStr) : undefined;
    const created = createdStr ? new Date(createdStr) : undefined;

    // Check if key has expired
    if (expires && expires < new Date()) {
      console.info(`[S3ApiKeyAuth] API key expired for owner: ${owner}, expired: ${expires.toISOString()}`);
      return { 
        valid: false, 
        owner,
        expires,
        created,
        error: 'API key has expired' 
      };
    }

    console.info(`[S3ApiKeyAuth] Valid API key for owner: ${owner}`);
    return {
      valid: true,
      owner,
      expires,
      created
    };

  } catch (error: unknown) {
    // Handle specific S3 errors
    if (error && typeof error === 'object' && 'name' in error) {
      const errorName = (error as { name: string }).name;
      
      if (errorName === 'NotFound' || errorName === 'NoSuchKey') {
        console.info('[S3ApiKeyAuth] API key not found in S3');
        return { valid: false, error: 'Invalid API key' };
      }
      
      if (errorName === 'AccessDenied') {
        console.error('[S3ApiKeyAuth] Access denied to S3 bucket - check IAM permissions');
        return { valid: false, error: 'Server error: cannot validate API key' };
      }
    }

    // Log unexpected errors
    console.error('[S3ApiKeyAuth] Unexpected error validating API key:', error);
    return { valid: false, error: 'Server error: cannot validate API key' };
  }
}

/**
 * Express middleware factory for S3 API key authentication
 * 
 * Expects the API key in the X-Api-Key header
 * 
 * @param options - Middleware options
 * @returns Express middleware function
 */
export interface S3ApiKeyMiddlewareOptions {
  /** Header name for the API key (default: X-Api-Key) */
  headerName?: string;
  /** Skip authentication for these paths (exact match) */
  skipPaths?: string[];
}

export function s3ApiKeyAuth(options: S3ApiKeyMiddlewareOptions = {}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const headerName = options.headerName || 'X-Api-Key';
  const skipPaths = options.skipPaths || ['/health'];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip authentication for certain paths
    if (skipPaths.includes(req.path)) {
      next();
      return;
    }

    // Extract API key from header (case-insensitive)
    const apiKey = req.get(headerName) || req.get(headerName.toLowerCase());

    if (!apiKey) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Unauthorized: API key required',
          data: { header: headerName }
        },
        id: null
      });
      return;
    }

    // Validate the API key
    const result = await validateApiKey(apiKey);

    if (!result.valid) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: `Unauthorized: ${result.error}`,
        },
        id: null
      });
      return;
    }

    // Attach owner info to request for logging/debugging
    (req as AuthenticatedRequest).apiKeyOwner = result.owner;
    (req as AuthenticatedRequest).apiKeyExpires = result.expires;

    next();
  };
}

/**
 * Create an S3 API key middleware instance with default options
 * for use in the Lambda handler
 */
export function createS3ApiKeyMiddleware(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return s3ApiKeyAuth({
    headerName: 'X-Api-Key',
    skipPaths: ['/health']
  });
}


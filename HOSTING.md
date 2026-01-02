# Hosting Capture MCP Server on AWS

This guide covers deploying the Capture MCP Server as a serverless application on AWS using the "Dirt Cheap" method - a cost-effective approach running on AWS Lambda with API Gateway.

## Architecture Overview

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  MCP Client  │────▶│  API Gateway    │────▶│    Lambda    │
│              │     │  (HTTP API)     │     │ (MCP Handler)│
└──────────────┘     └─────────────────┘     └──────┬───────┘
                                                    │
                     ┌─────────────────┐            │
                     │   S3 Bucket     │◀───────────┘
                     │  (API Keys)     │
                     └─────────────────┘
```

**Request Flow:**
1. Client sends MCP request to API Gateway with `X-Api-Key` header
2. API Gateway routes to Lambda via HTTP integration
3. Lambda validates API key by checking S3 bucket for the key hash
4. Lambda processes MCP request and returns response
5. Structured logs are sent to CloudWatch

## AWS Services Used

| Service | Purpose |
|---------|---------|
| **Lambda** | Serverless compute (Node.js 20.x, 512MB, 30s timeout) |
| **API Gateway HTTP API** | HTTP endpoints (cheaper than REST API) |
| **S3** | API key storage with encryption |
| **CloudWatch Logs** | Log storage (30-day retention) |
| **Route53** | Optional custom domain |
| **ACM** | SSL/TLS certificates for custom domains |

## Prerequisites

### AWS Requirements
- AWS account with permissions for Lambda, API Gateway, S3, CloudFormation, CloudWatch, IAM
- AWS CLI installed and configured (`aws configure`)
- AWS CDK CLI: `npm install -g aws-cdk`

### Local Requirements
- Node.js 20.x or later
- npm

## Deployment Steps

### 1. Configure Environment

Copy the example environment file and configure as needed:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Required
AWS_REGION=us-east-1

# Optional - for Route53 hosted zone lookups
AWS_ACCOUNT=123456789012

# Optional - affects S3 retention policy (dev=auto-delete, prod=retain)
ENVIRONMENT=dev

# Optional - custom domain with automatic SSL
DOMAIN_NAME=mcp.example.com

# Optional - default API keys for the underlying data APIs
SAM_GOV_API_KEY=your-sam-api-key
TANGO_API_KEY=your-tango-api-key
```

### 2. Bootstrap CDK (First Time Only)

Bootstrap the CDK toolkit in your AWS account/region:

```bash
cd infrastructure
npm install
npm run cdk:bootstrap
```

### 3. Build the Lambda Package

Compile TypeScript and create a production-ready Lambda bundle:

```bash
npm run build:lambda
```

This:
- Compiles TypeScript to `dist/`
- Copies package files
- Runs `npm ci --omit=dev` for minimal bundle size

### 4. Deploy the Stack

Deploy with approval prompts:
```bash
npm run cdk:deploy
```

Or deploy without prompts (for CI/CD):
```bash
npm run cdk:deploy:yolo
```

The deployment outputs important values:
- **ApiUrl** - Base URL for the API
- **McpEndpoint** - Full MCP endpoint URL (`/mcp`)
- **HealthEndpoint** - Health check URL (`/health`)
- **ApiKeyBucketName** - S3 bucket for API keys
- **LambdaFunctionName** - Lambda function name

### 5. Sync Configuration

After deployment, sync the CloudFormation outputs to local config:

```bash
npm run sync-config
```

This creates:
- `.capture-mcp.json` - Local configuration for key management
- `manifest-hosted.json` - Manifest for mcp-remote proxy distribution

### 6. Create API Keys

Generate API keys for your users:

```bash
npm run manage-keys -- create --owner "User Name"
```

Optional: Set an expiration date:
```bash
npm run manage-keys -- create --owner "User Name" --expires "2025-12-31"
```

**Important:** The API key is shown only once. Securely share it with the user.

## API Key Management

API keys use the format `cap_` + 32 hex characters (e.g., `cap_abc123def456...`).

Keys are stored as SHA-256 hashes in S3 - the raw key is never stored.

### Available Commands

```bash
# Create a new key
npm run manage-keys -- create --owner "Name" [--expires "YYYY-MM-DD"]

# List all keys (shows hash, owner, dates - not the key itself)
npm run manage-keys -- list

# Revoke a key (accepts full key or just the hash)
npm run manage-keys -- revoke <api-key-or-hash>

# Verify a key is valid
npm run manage-keys -- verify <api-key>

# Show help
npm run manage-keys -- help
```

## Client Configuration

### Using mcp-remote Proxy

The generated `manifest-hosted.json` configures the [mcp-remote](https://github.com/anthropics/mcp-remote) proxy to bridge HTTP to stdio for Claude Desktop.

Example Claude Desktop configuration:

```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.1.31", "https://your-api-url/mcp"],
      "env": {
        "API_KEY": "cap_your-api-key-here",
        "SAM_GOV_API_KEY": "optional-sam-key",
        "TANGO_API_KEY": "optional-tango-key"
      }
    }
  }
}
```

### Direct HTTP Access

For non-MCP clients, call the endpoint directly:

```bash
curl -X POST https://your-api-url/mcp \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: cap_your-api-key" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Endpoints

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | `/health` | No | Health check endpoint |
| POST | `/mcp` | Yes | MCP protocol endpoint |
| ANY | `/{proxy+}` | Yes | Catch-all proxy route |

## Environment Variables (Lambda)

| Variable | Description |
|----------|-------------|
| `POWERTOOLS_SERVICE_NAME` | Service name for logging |
| `POWERTOOLS_LOG_LEVEL` | Log level (INFO, DEBUG, etc.) |
| `POWERTOOLS_METRICS_NAMESPACE` | CloudWatch metrics namespace |
| `API_KEY_BUCKET` | S3 bucket for API key storage |
| `API_KEY_PREFIX` | S3 key prefix (default: `api-keys/`) |
| `SAM_GOV_API_KEY` | Default SAM.gov API key |
| `TANGO_API_KEY` | Default Tango API key |

## Observability

The deployment includes AWS Lambda Powertools for:

- **Structured Logging** - JSON-formatted logs with context
- **Metrics** - Custom CloudWatch metrics:
  - `MCPRequestSuccess` - Successful MCP requests
  - `MCPRequestError` - Failed MCP requests
  - `MCPRequestLatency` - Request duration
  - `ColdStart` - Lambda cold starts
  - `LambdaError` - Lambda errors

View logs in CloudWatch under `/aws/lambda/capture-mcp-server`.

## Cost Estimation

This serverless architecture is designed to be cost-effective:

| Component | Cost |
|-----------|------|
| Lambda | Pay per invocation + execution time |
| API Gateway HTTP API | ~$0.60 per million requests |
| S3 | ~$0.023/GB storage + request costs |
| CloudWatch Logs | ~$0.50/GB ingested |
| Route53 (optional) | $0.50/zone + $0.40/million queries |

**Estimated monthly cost:** $1-11 depending on usage

## Custom Domain (Optional)

To use a custom domain:

1. Ensure you have a Route53 hosted zone for your domain
2. Set `DOMAIN_NAME` in `.env`
3. Set `AWS_ACCOUNT` in `.env` (for hosted zone lookup)
4. Redeploy the stack

The stack will:
- Create an ACM certificate with DNS validation
- Configure API Gateway with the custom domain
- Create Route53 A/AAAA records

## Tearing Down

To remove all AWS resources:

```bash
npm run cdk:destroy
```

**Note:** In production mode (`ENVIRONMENT=prod`), the S3 bucket is retained to prevent accidental data loss. Delete it manually if needed.

## Troubleshooting

### API Key Issues

**"Missing API key"** - Ensure `X-Api-Key` header is set

**"Invalid API key"** - Key doesn't exist in S3 or was revoked

**"API key expired"** - Key has passed its expiration date

### Deployment Issues

**Bootstrap error** - Run `npm run cdk:bootstrap` first

**Permission denied** - Check AWS credentials have required permissions

**Stack already exists** - The stack is already deployed; use `cdk:deploy` to update

### Key Management Issues

**"Could not find API key bucket"** - Run `npm run sync-config` after deployment

**S3 access denied** - Check IAM permissions for S3 operations

## Development vs Production

| Behavior | Development | Production |
|----------|-------------|------------|
| S3 Bucket on Delete | Auto-deleted | Retained |
| Environment Variable | `ENVIRONMENT=dev` | `ENVIRONMENT=prod` |

Set `ENVIRONMENT` in your `.env` file before deployment.

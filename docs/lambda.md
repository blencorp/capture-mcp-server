# Deploy to AWS Lambda

Deploy a shared Capture MCP service on AWS for your organization. You deploy once, then create API keys (`cap_xxx...`) to distribute to your users. The serverless architecture costs ~$1-11/month and scales automatically.

## Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  MCP Client  │────▶│  API Gateway    │────▶│    Lambda    │
│              │     │  (HTTP API)     │     │ (MCP Handler)│
└──────────────┘     └─────────────────┘     └──────┬───────┘
                                                    │
                     ┌─────────────────┐            │
                     │   S3 Bucket     │◀───────────┘
                     │  (API Keys)     │   (HeadObject for auth)
                     └─────────────────┘
```

## Prerequisites

- **AWS Account** with permissions for Lambda, API Gateway, S3, CloudFormation, and IAM
- **AWS CLI** installed and configured ([installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
- **Node.js 20.x** or later
- **AWS CDK CLI**: `npm install -g aws-cdk`

## AWS Credentials Setup

Before deploying, ensure your AWS credentials are configured. The CDK uses the same credential resolution as the AWS CLI.

**Option 1: Default Profile**
```bash
aws configure
# Enter your Access Key ID, Secret Access Key, and default region (e.g., us-east-1)
```

**Option 2: Named Profile**
```bash
aws configure --profile my-profile
export AWS_PROFILE=my-profile
```

**Option 3: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=us-east-1
```

Verify your credentials are working:
```bash
aws sts get-caller-identity
```

### Step 1: Deploy to AWS

```bash
# Install CDK dependencies
cd infrastructure
npm ci
cd ..

# Bootstrap CDK (first time only per account/region)
pnpm cdk:bootstrap

# Build and deploy (requires manual approval for security-sensitive changes)
pnpm cdk:deploy

# Or skip approval prompts entirely (use with caution)
pnpm cdk:deploy:yolo
```

**Deploy Options**:
- `pnpm cdk:deploy` — Prompts for manual approval before creating/updating IAM roles, security groups, or other sensitive resources. Recommended for production.
- `pnpm cdk:deploy:yolo` — Skips all approval prompts (`--require-approval never`). Faster for development/testing, but use with caution in production.

> **What is CDK Bootstrap?** The first time you deploy a CDK app to an AWS account/region, you need to provision initial resources that CDK uses (S3 bucket for assets, IAM roles, etc.). This is a one-time setup. Learn more: [CDK Bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)

```bash
# Verify deployment succeeded - check the health endpoint
curl https://<your-api-url>/health
```

### Step 2: Sync Configuration

After deployment, run `sync-config` to read the CloudFormation stack outputs and save them locally:

```bash
pnpm sync-config
```

This creates `.capture-mcp.json` (gitignored) containing your deployment's bucket name, endpoint URL, and region. **This is required** before you can manage API keys or build the hosted extension package.

### Step 3: Create API Keys for Users

Now create API keys for each user who needs access:

```bash
# Create a key that never expires
pnpm manage-keys create --owner "John Doe"

# Create a key with an expiration date
pnpm manage-keys create --owner "Jane Smith" --expires "2025-12-31"
```

**Important**: Save the generated key immediately! It's displayed only once and cannot be retrieved later. Keys are stored as SHA-256 hashes in S3 for security.

**Key Management Commands**:
```bash
pnpm manage-keys list              # List all keys with owner and status
pnpm manage-keys verify <key>      # Check if a specific key is valid
pnpm manage-keys revoke <key>      # Revoke a key (by key or hash prefix)
```

### Step 4: Build the Hosted Extension Package

Create a `.mcpb` file pre-configured with your endpoint URL that users can install with one click:

```bash
pnpm package:hosted
```

This creates `capture-mcp-server-hosted.mcpb` containing:
- Your MCP endpoint URL (from sync-config)
- Prompts for API keys during installation
- All metadata and branding

### Step 5: Distribute to Users

**Option A: Provide the `.mcpb` File (Recommended)**

Send users the `capture-mcp-server-hosted.mcpb` file along with their API key. They install by:
1. Double-clicking the `.mcpb` file to open in Claude Desktop
2. Entering their API key (`cap_xxx...`) when prompted
3. Optionally entering their own SAM.gov or Tango API keys for additional tools
4. Clicking Install

**Option B: Manual Configuration**

For users who prefer manual setup, provide them:
1. Your MCP endpoint URL (from deployment output)
2. Their personal API key (`cap_xxx...`)

They add this to their Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "capture-hosted": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.1.31",
        "https://YOUR-MCP-ENDPOINT/mcp",
        "--header",
        "X-Api-Key:cap_xxx..."
      ]
    }
  }
}
```

Users can add their own SAM.gov/Tango keys with additional `--header` arguments.

## Cost Estimation

| Usage Level | Requests/Month | Estimated Cost |
|-------------|----------------|----------------|
| Low         | 100k           | ~$1.11/month   |
| Moderate    | 1M             | ~$11/month     |

## Test Your Deployment

```bash
# List available tools via curl
curl -X POST https://<your-mcp-endpoint>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: cap_your_api_key_here" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Custom Domain (Optional)

If your domain is managed as a **Route53 Hosted Zone**, the CDK will automatically:
- Create an ACM certificate
- Validate it via DNS (Route53)
- Create a custom domain in API Gateway
- Create an A record pointing to the API Gateway custom domain

**Setup:**

1. Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   # .env
   AWS_REGION=us-east-1
   AWS_ACCOUNT=123456789012
   DOMAIN_NAME=mcp.example.com
   ```

2. Deploy with the custom domain:
   ```bash
   pnpm cdk:deploy
   ```

> **Requirement**: The domain must exist as a hosted zone in Route53. For `mcp.example.com`, Route53 must have a hosted zone for `mcp.example.com`.

## Updating the Deployment

To update after code changes:

```bash
pnpm cdk:deploy  # Rebuilds and deploys automatically
```

## Testing Infrastructure

The CDK stack includes comprehensive tests to verify resource configuration:

```bash
pnpm cdk:test
```

Tests cover S3 bucket security settings, Lambda configuration, API Gateway routes and CORS, IAM permissions, CloudWatch log retention, stack outputs, and environment-specific behavior (dev vs prod).

## Destroying the Stack

To remove all AWS resources:

```bash
# Prompts for confirmation before destroying
pnpm cdk:destroy

# Or skip confirmation prompt entirely
pnpm cdk:destroy:yolo
```

**Destroy Options**:
- `pnpm cdk:destroy` — Prompts for confirmation before deleting resources. Recommended to prevent accidental deletion.
- `pnpm cdk:destroy:yolo` — Skips confirmation (`--force`). Useful for automated teardown or when you're certain.

> **Note**: The S3 bucket is retained by default to preserve API keys. Delete it manually if needed.

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/capture-mcp-server` (1 month retention)
- **Key Metrics**: `AWS/Lambda/Invocations`, `AWS/Lambda/Duration`, `AWS/Lambda/Errors`
- **Custom Metrics**: `CaptureMCP/MCPRequestLatency`

## Security Notes

- **API Keys**: Stored as SHA-256 hashes—raw keys never persisted
- **S3 Bucket**: All public access blocked, SSL enforced
- **Lambda IAM**: Least privilege (S3 read only)
- **HTTPS Only**: All traffic encrypted via API Gateway

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CDK deploy fails with bootstrap error | Run `pnpm cdk:bootstrap` |
| "API key required" (401) | Include `X-Api-Key` header |
| "Invalid API key" (401) | Verify key with `pnpm manage-keys verify <key>` |
| AWS credential errors | Run `aws sts get-caller-identity` to verify credentials |
| Lambda timeout | Check CloudWatch logs; some external APIs may be slow |


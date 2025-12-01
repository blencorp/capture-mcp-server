/**
 * Sync Config Script for Capture MCP Server
 * 
 * Reads CloudFormation stack outputs and writes them to .capture-mcp.json
 * for use by the manage-keys.ts script.
 * 
 * Usage:
 *   npm run sync-config
 *   npm run sync-config -- --stack-name CustomStackName
 * 
 * Options:
 *   --stack-name  CloudFormation stack name (default: CaptureServerless)
 *   --region      AWS region (default: us-east-1)
 */

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_STACK_NAME = 'CaptureServerless';
const DEFAULT_REGION = 'us-east-1';
const CONFIG_FILE_NAME = '.capture-mcp.json';
const HOSTED_MANIFEST_FILE = 'manifest-hosted.json';

interface CaptureConfig {
  apiKeyBucket: string;
  apiKeyPrefix: string;
  region: string;
  stackName: string;
  mcpEndpoint?: string;
  healthEndpoint?: string;
  lastSynced: string;
}

// ============================================================================
// Hosted Manifest Generation
// ============================================================================

/**
 * Generates manifest-hosted.json for users who want to connect to the hosted MCP server.
 * Uses mcp-remote as a proxy to bridge HTTP MCP servers to stdio-based clients like Claude Desktop.
 */
function generateHostedManifest(mcpEndpoint: string): void {
  const hostedManifest = {
    manifest_version: "0.3",
    name: "capture-mcp-server-hosted",
    display_name: "Capture MCP Server (Hosted)",
    version: "1.0.0",
    description: "Federal procurement and spending data capture - Hosted version",
    long_description: "Capture MCP Server empowers users to capture and query federal entity, opportunity, and spending data through natural language queries. This hosted version connects to a remote server. Works with 4 USASpending.gov tools out-of-the-box. Optional SAM.gov and Tango API keys unlock additional tools.",
    author: {
      name: "Mike Endale from BLEN, Inc.",
      url: "https://www.blencorp.com"
    },
    license: "MIT",
    icon: "icon.png",
    keywords: [
      "federal",
      "procurement",
      "government",
      "sam.gov",
      "usaspending",
      "contracts",
      "spending",
      "data capture",
      "hosted"
    ],
    repository: {
      type: "git",
      url: "https://github.com/blencorp/capture-mcp-server.git"
    },
    homepage: "https://github.com/blencorp/capture-mcp-server",
    documentation: "https://github.com/blencorp/capture-mcp-server#readme",
    support: "https://github.com/blencorp/capture-mcp-server/issues",
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: {
        node: ">=18.0.0"
      }
    },
    tools: [
      { name: "search_sam_entities", description: "Search for federal entities/businesses registered in SAM.gov" },
      { name: "get_sam_opportunities", description: "Fetch federal contract opportunities from SAM.gov" },
      { name: "get_sam_entity_details", description: "Get comprehensive details for a specific entity by UEI" },
      { name: "check_sam_exclusions", description: "Check if an entity is excluded from federal contracting" },
      { name: "get_usaspending_awards", description: "Get federal awards data for a specific agency" },
      { name: "get_usaspending_spending_by_category", description: "Get spending breakdown by award category" },
      { name: "get_usaspending_budgetary_resources", description: "Get budgetary resources and obligations for an agency" },
      { name: "search_usaspending_awards_by_recipient", description: "Search for federal awards by recipient name" },
      { name: "get_entity_and_awards", description: "Combine SAM entity data with USASpending award history" },
      { name: "get_opportunity_spending_context", description: "Link opportunities with historical spending context" },
      { name: "search_tango_contracts", description: "Search federal contracts through Tango's unified API" },
      { name: "search_tango_grants", description: "Search federal grants and financial assistance" },
      { name: "get_tango_vendor_profile", description: "Get comprehensive vendor profiles with history" },
      { name: "search_tango_opportunities", description: "Search federal contract opportunities with forecasts" },
      { name: "get_tango_spending_summary", description: "Get spending summaries and analytics" }
    ],
    server: {
      type: "node",
      entry_point: "mcp-remote",
      mcp_config: {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          mcpEndpoint,
          "--header",
          "X-Api-Key:${API_KEY}",
          "--header",
          "X-Sam-Api-Key:${SAM_GOV_API_KEY}",
          "--header",
          "X-Tango-Api-Key:${TANGO_API_KEY}"
        ],
        env: {
          "API_KEY": "${user_config.API_KEY}",
          "SAM_GOV_API_KEY": "${user_config.SAM_GOV_API_KEY}",
          "TANGO_API_KEY": "${user_config.TANGO_API_KEY}"
        }
      }
    },
    user_config: {
      API_KEY: {
        type: "string",
        title: "Server API Key",
        description: "Your API key for the Capture MCP Server (starts with cap_). Contact the administrator to obtain a key.",
        required: true,
        sensitive: true
      },
      SAM_GOV_API_KEY: {
        type: "string",
        title: "SAM.gov API Key",
        description: "Optional API key from sam.gov/data-services/API. Enables SAM.gov tools (entities, opportunities, details, exclusions) and join tools.",
        required: false,
        sensitive: true,
        default: ""
      },
      TANGO_API_KEY: {
        type: "string",
        title: "Tango API Key",
        description: "Optional API key from tango.makegov.com. Enables Tango tools: contracts, grants, vendor profiles, opportunities, and spending summaries.",
        required: false,
        sensitive: true,
        default: ""
      }
    }
  };

  const manifestPath = join(process.cwd(), HOSTED_MANIFEST_FILE);
  writeFileSync(manifestPath, JSON.stringify(hostedManifest, null, 2) + '\n');
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args: string[]): { stackName: string; region: string } {
  let stackName = DEFAULT_STACK_NAME;
  let region = process.env.AWS_REGION || DEFAULT_REGION;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stack-name' && args[i + 1]) {
      stackName = args[i + 1];
      i++;
    } else if (arg === '--region' && args[i + 1]) {
      region = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return { stackName, region };
}

function showHelp(): void {
  console.log(`
Sync Config - Reads CloudFormation stack outputs and saves to .capture-mcp.json

Usage:
  npm run sync-config
  npm run sync-config -- --stack-name CustomStackName --region us-west-2

Options:
  --stack-name  CloudFormation stack name (default: ${DEFAULT_STACK_NAME})
  --region      AWS region (default: ${DEFAULT_REGION})
  --help, -h    Show this help message

The config file (.capture-mcp.json) will be created in the project root.
This file is gitignored and contains deployment-specific values.

After running this command, you can use manage-keys without setting env vars:
  npm run manage-keys -- create --owner "John Doe"
`);
}

// ============================================================================
// Main Logic
// ============================================================================

async function syncConfig(stackName: string, region: string): Promise<void> {
  console.log(`Syncing config from CloudFormation stack: ${stackName}`);
  console.log(`Region: ${region}`);
  console.log('');

  const cfnClient = new CloudFormationClient({ region });

  try {
    const response = await cfnClient.send(new DescribeStacksCommand({
      StackName: stackName,
    }));

    const stack = response.Stacks?.[0];
    if (!stack) {
      console.error(`❌ Stack "${stackName}" not found.`);
      console.error('');
      console.error('Make sure the stack has been deployed:');
      console.error('  cd infrastructure && npx cdk deploy CaptureServerless');
      process.exit(1);
    }

    // Check stack status
    if (stack.StackStatus?.includes('FAILED') || stack.StackStatus?.includes('ROLLBACK')) {
      console.error(`❌ Stack "${stackName}" is in failed state: ${stack.StackStatus}`);
      process.exit(1);
    }

    // Extract outputs
    const outputs = stack.Outputs || [];
    const outputMap: Record<string, string> = {};
    
    for (const output of outputs) {
      if (output.OutputKey && output.OutputValue) {
        outputMap[output.OutputKey] = output.OutputValue;
      }
    }

    // Get required values
    const apiKeyBucket = outputMap['ApiKeyBucketName'];
    if (!apiKeyBucket) {
      console.error('❌ ApiKeyBucketName output not found in stack outputs.');
      console.error('Available outputs:', Object.keys(outputMap).join(', '));
      process.exit(1);
    }

    // Build config
    const config: CaptureConfig = {
      apiKeyBucket,
      apiKeyPrefix: 'api-keys/', // Hardcoded to match serverless-stack.ts
      region,
      stackName,
      mcpEndpoint: outputMap['McpEndpoint'],
      healthEndpoint: outputMap['HealthEndpoint'],
      lastSynced: new Date().toISOString(),
    };

    // Determine config file path (project root)
    const configPath = join(process.cwd(), CONFIG_FILE_NAME);
    
    // Check if config exists and show diff
    if (existsSync(configPath)) {
      const existingConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      console.log('Existing config found. Updating...');
      console.log(`  Previous bucket: ${existingConfig.apiKeyBucket}`);
      console.log(`  New bucket:      ${config.apiKeyBucket}`);
      console.log('');
    }

    // Write config file
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    console.log('✅ Config synced successfully!');
    console.log('');
    console.log(`Config file: ${configPath}`);
    console.log('');
    console.log('Configuration:');
    console.log(`  API Key Bucket: ${config.apiKeyBucket}`);
    console.log(`  API Key Prefix: ${config.apiKeyPrefix}`);
    console.log(`  Region:         ${config.region}`);
    console.log(`  Stack:          ${config.stackName}`);
    if (config.mcpEndpoint) {
      console.log(`  MCP Endpoint:   ${config.mcpEndpoint}`);
    }
    console.log('');

    // Generate hosted manifest if we have an MCP endpoint
    if (config.mcpEndpoint) {
      generateHostedManifest(config.mcpEndpoint);
      const hostedManifestPath = join(process.cwd(), HOSTED_MANIFEST_FILE);
      console.log('✅ Hosted manifest generated!');
      console.log(`   ${hostedManifestPath}`);
      console.log('');
      console.log('To create the hosted .mcpb bundle:');
      console.log('  npm run package:hosted');
      console.log('');
    }

    console.log('You can now use manage-keys without setting environment variables:');
    console.log('  npm run manage-keys -- create --owner "John Doe"');

  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string };
      
      if (err.name === 'ValidationError' && err.message?.includes('does not exist')) {
        console.error(`❌ Stack "${stackName}" does not exist.`);
        console.error('');
        console.error('Deploy the stack first:');
        console.error('  cd infrastructure && npx cdk deploy CaptureServerless');
        process.exit(1);
      }
      
      if (err.name === 'CredentialsProviderError' || err.message?.includes('credentials')) {
        console.error('❌ AWS credentials not found or invalid.');
        console.error('');
        console.error('Configure credentials using one of these methods:');
        console.error('  1. AWS CLI: aws configure');
        console.error('  2. Environment variables: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
        console.error('  3. IAM role (if running on AWS)');
        process.exit(1);
      }

      if (err.name === 'AccessDeniedException') {
        console.error('❌ Access denied. Check your IAM permissions.');
        console.error('Required permission: cloudformation:DescribeStacks');
        process.exit(1);
      }

      console.error(`❌ Error: ${err.name}: ${err.message}`);
    } else {
      console.error('❌ Unexpected error:', error);
    }
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

const args = process.argv.slice(2);
const { stackName, region } = parseArgs(args);

syncConfig(stackName, region).catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});


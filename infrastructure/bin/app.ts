#!/usr/bin/env node
/**
 * CDK App Entry Point for Capture MCP Server Infrastructure
 * 
 * This app defines the AWS infrastructure stacks for the Capture MCP Server.
 * Currently supports the "Serverless" (dirt cheap) deployment method.
 * 
 * Usage:
 *   cd infrastructure
 *   npm install
 *   npx cdk deploy CaptureServerless
 * 
 * Environment Variables (can be set in .env at project root):
 *   AWS_REGION - Target AWS region (default: us-east-1)
 *   AWS_ACCOUNT - Target AWS account ID (required for hosted zone lookup)
 *   DOMAIN_NAME - Custom domain name (optional, e.g., "mcp.example.com")
 *                 If set, assumes Route53 hosted zone exists for the root domain
 */

import 'source-map-support/register';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env at project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ServerlessStack } from '../lib/serverless-stack';
import { App } from 'aws-cdk-lib';

const app = new App();

// Get configuration from environment
const region = process.env.AWS_REGION || 'us-east-1';
const account = process.env.AWS_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT;
const environment = process.env.ENVIRONMENT || 'dev';

// Custom domain configuration (optional)
const domainName = process.env.DOMAIN_NAME || '';

// Create the serverless stack
new ServerlessStack(app, 'CaptureServerless', {
  env: {
    account,
    region,
  },
  description: 'Capture MCP Server - Serverless deployment (Method 1: Dirt Cheap)',
  domainName,
  environment,
  tags: {
    Project: 'CaptureMCP',
    Environment: 'Production',
    DeploymentMethod: 'Serverless',
  },
});

app.synth();

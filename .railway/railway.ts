import { defineRailway, github, project, service } from 'railway/iac';
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = 'capture-mcp-server';
export default defineRailway(() => {
  const captureMcpServer = service('capture-mcp-server', {
    // The repository is linked, with no branch: deploy-railway.yml deploys with `railway up` after CI.
    source: github('blencorp/capture-mcp-server'),
    // Railway keeps its Railpack default unless the Dockerfile path is set too. The image sets
    // MCP_TRANSPORT=http; the start command matches its CMD.
    build: { buildEnvironment: 'V3', builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    healthcheck: '/health',
    healthcheckTimeout: 30,
    // Restart on failure (Railway's default type, stored as unset), at most 3 times.
    deploy: { startCommand: 'node dist/server.js', restartPolicyMaxRetries: 3 },
    replicas: { 'us-east4-eqdc4a': 1 },
    domains: ['capture.mcp.blencorp.com'],
  });

  return project('capture-map-server', {
    // Secrets stay set in Railway. Without this, IaC would manage every service variable.
    // @ts-expect-error -- the railway 3.17.0 types lack project `variables`; the CLI reads it.
    variables: { managed: false },
    resources: [captureMcpServer],
  });
});

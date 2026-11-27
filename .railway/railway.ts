import { defineRailway, github, project, service } from 'railway/iac';
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = 'capture-mcp-server';
// This file is the only Railway settings file (railway.toml is gone). Auth is not declared here:
// HTTP mode refuses to start without MCP_REQUIRE_OAUTH=true, OAUTH_TOKEN_SECRET and
// MCP_PUBLIC_BASE_URL, which stay set as service variables in Railway.
export default defineRailway(() => {
  const captureMcpServer = service('capture-mcp-server', {
    // Railway builds and deploys main from GitHub, so the release commit (the one the version tag
    // points to) is what runs, and RAILWAY_GIT_COMMIT_SHA, which /health reports, is set.
    source: github('blencorp/capture-mcp-server', { branch: 'main' }),
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
    // @ts-expect-error -- the railway 3.18.0 types lack project `variables`; the CLI reads it.
    variables: { managed: false },
    resources: [captureMcpServer],
  });
});

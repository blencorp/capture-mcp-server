import test from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handler } from './lambda-handler.js';

const context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'capture-mcp-test',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:capture-mcp-test',
  memoryLimitInMB: '512',
  awsRequestId: 'lambda-handler-test',
  logGroupName: '/aws/lambda/capture-mcp-test',
  logStreamName: 'test',
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
} as Context;

function event(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'localhost',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'node-test',
      },
      requestId: 'lambda-handler-test',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '24/Aug/2026:00:00:00 +0000',
      timeEpoch: 1787529600000,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function modern(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id: method,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'lambda-test', version: '1.0.0' },
      },
    },
  };
}

async function invoke(candidate: APIGatewayProxyEventV2) {
  const result = await handler(candidate, context);
  if (typeof result !== 'object' || result === null || !('statusCode' in result)) {
    assert.fail(`expected a structured API Gateway response, got ${JSON.stringify(result)}`);
  }
  return result as { statusCode: number; headers?: Record<string, string>; body: string };
}

test('Lambda adapter serves health and modern stateless tools/list', async () => {
  const health = await invoke(event('GET', '/health'));
  assert.equal(health.statusCode, 200);
  const healthBody = JSON.parse(health.body);
  assert.equal(healthBody.transport, 'lambda');
  assert.equal(healthBody.protocolVersion, '2026-07-28');

  const response = await invoke(event('POST', '/mcp', modern('tools/list'), {
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'tools/list',
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['mcp-session-id'], undefined);
  const payload = JSON.parse(response.body);
  assert.equal(payload.result.resultType, 'complete');
  assert.ok(payload.result.tools.some((tool: any) => tool.name === 'lookup_reference_code'));
});

test('Lambda adapter bounds subscriptions/listen as JSON instead of SSE', async () => {
  const response = await invoke(event('POST', '/mcp', modern('subscriptions/listen', {
    notifications: { toolsListChanged: true },
  }), {
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'subscriptions/listen',
  }));
  assert.equal(response.statusCode, 200);
  const contentType = response.headers?.['content-type'] ?? response.headers?.['Content-Type'];
  assert.match(contentType ?? '', /^application\/json/);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error.code, -32603);
  assert.equal(payload.error.message, 'Subscription limit reached');
});

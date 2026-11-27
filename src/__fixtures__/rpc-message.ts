/**
 * The JSON-RPC message in a response from `/mcp`, whether the server answered with a JSON body or
 * with one SSE `message` event (what the SDK's stateless legacy leg sends).
 */
export async function rpcMessage(res: Response): Promise<any> {
  const body = await res.text();
  const data = res.headers.get('content-type')?.startsWith('text/event-stream') ? /^data: (.*)$/m.exec(body)?.[1] : body;
  return JSON.parse(data ?? '');
}

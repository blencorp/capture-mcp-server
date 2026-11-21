import type { ApiKeyConfig, ProviderKeyOverrides } from '../tools/index.js';
import type { ProviderKeys } from './mcp-oauth.js';

/** Provider keys a caller sent in `X-*-Api-Key` headers. */
export type HeaderKeys = { sam?: string; tango?: string; highergov?: string };

/**
 * Where a request's provider keys may come from.
 *
 * - `caller`: a remote, authenticated caller. Only keys that caller supplied are used — the keys
 *   sealed into their OAuth token, then their own `X-*-Api-Key` headers. The operator's
 *   environment keys are never used: provider API keys are personal, and falling back to them
 *   would let any caller spend the operator's keys.
 * - `operator`: a single-user process (stdio, or HTTP explicitly started without auth on
 *   loopback). The operator's environment keys are the caller's own keys; headers override them.
 */
export type KeySource =
  | { kind: 'caller'; sealed?: ProviderKeys; headers?: HeaderKeys }
  | { kind: 'operator'; headers?: HeaderKeys; env: NodeJS.ProcessEnv };

export type RequestKeys = { config: ApiKeyConfig; keys: ProviderKeyOverrides };

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveRequestKeys(source: KeySource): RequestKeys {
  const pick = (sealed: string | undefined, header: string | undefined, env: string | undefined) =>
    present(sealed) ?? present(header) ?? present(env);

  const sealed = source.kind === 'caller' ? source.sealed : undefined;
  const env = source.kind === 'operator' ? source.env : undefined;
  const sam = pick(sealed?.sam, source.headers?.sam, env?.SAM_GOV_API_KEY);
  const tango = pick(sealed?.tango, source.headers?.tango, env?.TANGO_API_KEY);
  const highergov = pick(sealed?.highergov, source.headers?.highergov, env?.HIGHERGOV_API_KEY);

  return {
    config: {
      hasSamApiKey: sam !== undefined,
      hasTangoApiKey: tango !== undefined,
      hasHigherGovApiKey: highergov !== undefined,
    },
    keys: { samKey: sam, tangoKey: tango, higherGovKey: highergov },
  };
}

/** Reads the `X-*-Api-Key` headers (Express lowercases header names, so one lookup each). */
export function headerKeys(get: (name: string) => string | undefined): HeaderKeys {
  return {
    sam: get('x-sam-api-key'),
    tango: get('x-tango-api-key'),
    highergov: get('x-highergov-api-key'),
  };
}

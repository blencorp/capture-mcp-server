import { SERVER_VERSION } from './version.js';

/** The release and commit this process is serving, as reported by `/health`. */
export interface BuildInfo {
  /** The package version that is running. */
  version: string;
  /** The full git SHA the running build was made from, or `null` when the platform does not say. */
  commit: string | null;
}

/**
 * Railway sets this itself, on GitHub-sourced deployments, to the commit it built: the one source
 * of the commit that cannot disagree with what is running. A deployment that does not come from a
 * Git commit (a local run, `docker run`, `railway up`, the MCPB bundle) has none.
 */
const COMMIT_ENV = 'RAILWAY_GIT_COMMIT_SHA';

/**
 * Read once at startup from the environment `src/server.ts` passes in (nothing else reads it),
 * never from a request. Anything that is not a full SHA-1 (an empty or malformed value) reports
 * `null` rather than a guess.
 */
export function readBuildInfo(env: NodeJS.ProcessEnv): BuildInfo {
  const sha = env[COMMIT_ENV]?.trim().toLowerCase();
  return { version: SERVER_VERSION, commit: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null };
}

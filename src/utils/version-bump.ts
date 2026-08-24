// Semantic version bumping driven by commit messages.
//
// Used by the release workflow (.github/workflows/release.yml) to decide how
// far to bump on each merge to main. Conventional Commit prefixes drive the
// level; anything unrecognized counts as a patch, so a release never silently
// fails to happen just because a commit wasn't formatted.

export type BumpLevel = 'major' | 'minor' | 'patch';

const CONVENTIONAL_HEADER = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s+/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s/m;

// Types that signal a new capability. Everything else — fix, perf, refactor,
// docs, chore, ci, build, test, style, revert — is a patch.
const MINOR_TYPES = new Set(['feat']);

const RANK: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };

/**
 * The bump a single commit message implies, or null when the message says
 * nothing about severity (a non-conventional subject).
 */
export function detectCommitBump(message: string): BumpLevel | null {
  const text = message.trim();
  if (!text) return null;

  // A revert of a breaking change is itself breaking, but plain `revert:` is
  // handled as a patch below; the footer check covers the breaking case.
  if (BREAKING_FOOTER.test(text)) return 'major';

  const header = text.split('\n', 1)[0];
  const match = CONVENTIONAL_HEADER.exec(header);
  if (!match?.groups) return null;

  if (match.groups.breaking) return 'major';
  return MINOR_TYPES.has(match.groups.type.toLowerCase()) ? 'minor' : 'patch';
}

/**
 * The highest bump implied by a set of commits. Defaults to `patch` — a merge
 * to main always produces a release.
 */
export function detectBump(messages: string[]): BumpLevel {
  let level: BumpLevel = 'patch';
  for (const message of messages) {
    const commitLevel = detectCommitBump(message);
    if (commitLevel && RANK[commitLevel] > RANK[level]) level = commitLevel;
  }
  return level;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): ParsedVersion {
  // Tolerate a leading `v` and any prerelease/build suffix.
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    throw new Error(`Unparseable version: "${version}" (expected MAJOR.MINOR.PATCH)`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function applyBump(version: string, level: BumpLevel): string {
  const { major, minor, patch } = parseVersion(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export interface NextVersionResult {
  current: string;
  next: string;
  bump: BumpLevel;
  /** True when the repo has no releases yet and `current` is being claimed as-is. */
  seeded: boolean;
}

/**
 * Decide the next release version.
 *
 * `hasExistingRelease: false` seeds the first release at the current version
 * instead of bumping past it, so a fresh repo tags v1.0.0 rather than v1.0.1.
 */
export function nextVersion(options: {
  current: string;
  messages: string[];
  override?: BumpLevel | 'auto';
  hasExistingRelease: boolean;
}): NextVersionResult {
  const { current, messages, override = 'auto', hasExistingRelease } = options;
  const parsed = parseVersion(current);
  const normalized = `${parsed.major}.${parsed.minor}.${parsed.patch}`;

  if (!hasExistingRelease) {
    return { current: normalized, next: normalized, bump: 'patch', seeded: true };
  }

  const bump = override === 'auto' ? detectBump(messages) : override;
  return { current: normalized, next: applyBump(normalized, bump), bump, seeded: false };
}

#!/usr/bin/env node
// Dependency audit for the scheduled security workflow (.github/workflows/security.yml).
//
//   node scripts/security-audit.mjs [dir ...]     (default: .)
//
// For each pnpm root it
//   1. runs `pnpm audit --json` as CI does (exceptions applied) and reports every advisory at
//      moderate or above, i.e. what `pnpm audit --audit-level moderate` fails on;
//   2. checks that every advisory muted by `auditConfig.ignoreGhsas` still deserves it. The muted
//      list is every GHSA id in the workspace's `auditConfig` block (any YAML style), in
//      package.json's `pnpm.auditConfig`, and in `pnpm config get auditConfig` (see ignoredGhsas). The script copies package.json, pnpm-lock.yaml, .pnpmfile.cjs and
//      .npmrc (when present) into a temporary directory with the workspace file minus
//      `auditConfig`, confirms pnpm sees no exceptions there, and audits again. An exception is
//      stale when its advisory is no longer reported (withdrawn, or the package moved past it)
//      or now has a patched release.
// `pnpm audit` reads only the lockfile: nothing is installed and no package scripts run.
//
// Exit codes: 0 clean; 1 findings, stale exceptions or a broken checkout (missing lockfile, bad
// workspace file: a person has to act); 2 only when the audit service could not be reached
// (registry or network error codes; the workflow retries and opens no issue). Findings in one
// root outrank an outage in another, so they still reach the tracking issue.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FAILING_SEVERITIES = new Set(['moderate', 'high', 'critical']);
const COPIED_FILES = ['package.json', 'pnpm-lock.yaml', '.pnpmfile.cjs', '.npmrc'];

// pnpm error codes (JSON `error.code`, or the `Error: <code>` line pnpm 12 prints on stderr) that
// mean the registry or network failed, not this repository.
const SERVICE_ERROR = /^(ECONN|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR|ERR_PNPM_AUDIT_BAD_RESPONSE|ERR_PNPM_FETCH|ERR_PNPM_META_FETCH)/;

export class AuditUnavailable extends Error {}

/** Whether a `pnpm audit --json` error is the audit service's fault rather than the checkout's. */
export function isServiceError(error) {
  return typeof error?.code === 'string' && SERVICE_ERROR.test(error.code);
}

/** Splits the workspace text into its top-level `auditConfig` block and everything else. */
function splitAuditConfig(yamlText) {
  const block = [];
  const rest = [];
  let inAudit = false;
  for (const line of yamlText.split('\n')) {
    // A top-level key starts a new block; comments and indented or blank lines continue one.
    if (/^[^\s#]/.test(line)) inAudit = /^['"]?auditConfig['"]?\s*:/.test(line);
    (inAudit ? block : rest).push(line);
  }
  return { block, rest: rest.join('\n') };
}

/** The workspace text without the top-level `auditConfig` key, in any YAML style. */
export function stripAuditConfig(yamlText) {
  return splitAuditConfig(yamlText).rest;
}

/**
 * Every GHSA id written in the workspace's `auditConfig` block, outside comments, in any YAML
 * style (block or flow lists, quoted or not). Reading the ids as text needs no YAML parser and
 * cannot miss one that pnpm would apply.
 */
export function ghsasInWorkspace(yamlText) {
  const ids = [];
  for (const line of splitAuditConfig(yamlText).block) {
    ids.push(...(line.replace(/(^|\s)#.*$/, '').match(GHSA_ID) ?? []));
  }
  return ids;
}

const GHSA_ID = /GHSA(?:-[0-9a-z]{4}){3}/gi;

/** Advisories `pnpm audit --audit-level moderate` fails on, from `pnpm audit --json`. */
export function failingAdvisories(audit) {
  return Object.values(audit.advisories ?? {})
    .filter(a => FAILING_SEVERITIES.has(a.severity))
    .map(a => `${a.github_advisory_id ?? a.id} (${a.severity}) in ${a.module_name}: ${a.title}`);
}

/** Problems with the muted advisories, given `pnpm audit --json` output run without them. */
export function staleExceptions(ghsas, audit) {
  const found = new Map();
  for (const a of Object.values(audit.advisories ?? {})) {
    if (a.github_advisory_id) found.set(a.github_advisory_id.toUpperCase(), a);
  }
  const problems = [];
  for (const id of ghsas) {
    const a = found.get(id.toUpperCase());
    if (!a) {
      problems.push(`${id}: no longer reported for this lockfile (withdrawn, or the package moved past it) - remove the exception`);
    } else if (a.patched_versions && a.patched_versions !== '<0.0.0') {
      problems.push(`${id}: ${a.module_name} now has a fix (${a.patched_versions}) - update it and remove the exception`);
    }
  }
  return problems;
}

/**
 * The advisories muted in `dir`: the union of the ids written in pnpm-workspace.yaml's
 * `auditConfig`, in package.json's `pnpm.auditConfig`, and whatever `pnpm config get` reports.
 * pnpm's own answer is not reliable on every machine (it prints `null` on some macOS setups even
 * with exceptions set), so it only ever adds ids; the files are the floor.
 */
export function ignoredGhsas(dir) {
  const ids = [];
  const workspace = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(workspace)) ids.push(...ghsasInWorkspace(readFileSync(workspace, 'utf8')));
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  ids.push(...(pkg.pnpm?.auditConfig?.ignoreGhsas ?? []));
  const r = spawnSync('pnpm', ['config', 'get', 'auditConfig', '--json'], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`pnpm config failed in ${dir}: ${r.stderr.trim().slice(0, 500)}`);
  const text = r.stdout.trim();
  const fromPnpm = text && text !== 'undefined' ? JSON.parse(text)?.ignoreGhsas : undefined;
  if (Array.isArray(fromPnpm)) ids.push(...fromPnpm);
  const unique = new Map(ids.map(id => [String(id).toUpperCase(), String(id)]));
  return [...unique.values()];
}

function audit(dir) {
  const r = spawnSync('pnpm', ['audit', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // pnpm audit exits non-zero when it finds something; only JSON with metadata is a real answer.
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    // pnpm 12 reports a failed audit on stderr as `Error: ERR_PNPM_...` followed by prose, not as
    // a JSON `error` object, so classify it by that code.
    const detail = (r.stderr || r.stdout || '').trim();
    const message = `pnpm audit gave no report in ${dir}: ${detail.slice(0, 500)}`;
    const code = /^Error: (\S+)/m.exec(detail)?.[1];
    throw isServiceError({ code }) ? new AuditUnavailable(message) : new Error(message);
  }
  if (report.error || !report.metadata) {
    const message = `pnpm audit failed in ${dir}: ${JSON.stringify(report.error ?? report).slice(0, 500)}`;
    throw isServiceError(report.error) ? new AuditUnavailable(message) : new Error(message);
  }
  return report;
}

/**
 * Audits one pnpm root. Never throws: whatever was found before a later step failed is still
 * returned in `problems`, next to the `error` that stopped it. `runAudit` is injectable for tests.
 */
export function checkRoot(dir, { runAudit = audit } = {}) {
  const problems = [];
  let ghsas = [];
  try {
    problems.push(...failingAdvisories(runAudit(dir)));
    ghsas = ignoredGhsas(dir);
    if (ghsas.length === 0) return { ghsas, problems };
    const tmp = mkdtempSync(join(tmpdir(), 'security-audit-'));
    try {
      for (const f of COPIED_FILES) {
        if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(tmp, f));
      }
      writeFileSync(join(tmp, 'pnpm-workspace.yaml'), stripAuditConfig(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')));
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.pnpm?.auditConfig) {
        delete pkg.pnpm.auditConfig;
        writeFileSync(join(tmp, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
      }
      const left = ignoredGhsas(tmp);
      if (left.length) throw new Error(`could not remove exceptions for the check (pnpm still mutes ${left.join(', ')})`);
      problems.push(...staleExceptions(ghsas, runAudit(tmp)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return { ghsas, problems };
  } catch (error) {
    return { ghsas, problems, error };
  }
}

if (resolve(process.argv[1] ?? '') === import.meta.filename) {
  const dirs = process.argv.length > 2 ? process.argv.slice(2) : ['.'];
  let actionable = false;
  let unavailable = false;
  for (const d of dirs) {
    const { ghsas, problems, error } = checkRoot(resolve(d));
    for (const p of problems) console.error(`${d}: ${p}`);
    if (problems.length) actionable = true;
    if (error) {
      console.error(`${d}: ${error instanceof Error ? error.message : error}`);
      if (error instanceof AuditUnavailable) unavailable = true;
      else actionable = true;
    } else if (!problems.length) {
      console.log(`${d}: no advisories${ghsas.length ? `; exceptions ${ghsas.join(', ')} still unpatched` : ''}`);
    }
  }
  process.exit(actionable ? 1 : unavailable ? 2 : 0);
}

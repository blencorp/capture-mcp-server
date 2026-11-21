import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditUnavailable, checkRoot, failingAdvisories, ghsasInWorkspace, ignoredGhsas, isServiceError, staleExceptions, stripAuditConfig } from '../scripts/security-audit.mjs';

// `auditConfig.ignoreGhsas` in pnpm-workspace.yaml skips an advisory on every dependency path:
// pnpm cannot limit it to dev tooling. Each root entry needs a row here naming the package it
// covers, and the test holds the condition each entry states ("dev tooling only"). Delete a row
// together with its entry; the scheduled security workflow says when (scripts/security-audit.mjs).
const EXCEPTIONS: Record<string, string> = {
  // 'GHSA-xxxx-xxxx-xxxx': 'package-name',
};

const productionTree = (name: string) => {
  const r = spawnSync('pnpm', ['ls', '--prod', '--depth', 'Infinity', '--json', name], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  return (JSON.parse(r.stdout) as Array<{ dependencies?: Record<string, unknown> }>)[0]?.dependencies;
};

describe('audit exceptions', () => {
  it('every advisory pnpm mutes at the root has a row here', () => {
    assert.deepEqual(ignoredGhsas('.').sort(), Object.keys(EXCEPTIONS).sort());
  });

  // The two halves of the per-row check, on packages whose answer is known.
  it('the production-tree query finds a package that ships', () => {
    assert.notEqual(productionTree('zod'), undefined);
  });
  it('the production-tree query reports a dev-only package as absent', () => {
    assert.equal(productionTree('eslint'), undefined);
  });

  for (const [id, pkg] of Object.entries(EXCEPTIONS)) {
    it(`${id} (${pkg}) is not a production dependency`, () => {
      assert.equal(productionTree(pkg), undefined);
    });
  }
});

describe('security-audit', () => {
  const withWorkspace = (yaml: string, fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-spec-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"name":"x","version":"0.0.0","private":true}\n');
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const block = [
    'allowBuilds:',
    '  esbuild: true',
    '# Advisories with no patched release.',
    'auditConfig:',
    '  ignoreGhsas:',
    '    # why it cannot reach users',
    '    - GHSA-aaaa-bbbb-cccc',
    "    - 'GHSA-dddd-eeee-ffff' # quoted",
    'overrides:',
    "  'a>b': ^1.0.0",
    '',
  ].join('\n');
  const flow = "overrides: {'a>b': ^1.0.0}\nauditConfig: { ignoreGhsas: [GHSA-aaaa-bbbb-cccc, \"GHSA-dddd-eeee-ffff\"] }\n";

  for (const [style, yaml] of [['block', block], ['flow', flow]] as const) it(`reads ${style}-style exceptions from the file`, () => {
    assert.deepEqual(ghsasInWorkspace(yaml), ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff']);
    // ignoredGhsas adds pnpm's own answer, which may be null on some machines, never removes.
    withWorkspace(yaml, dir => {
      assert.deepEqual(ignoredGhsas(dir), ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff']);
    });
  });

  it('ignores GHSA ids in comments and in other keys', () => {
    const yaml = [
      'overrides:',
      "  'a>b': ^1.0.0 # GHSA-1111-2222-3333",
      '# auditConfig: { ignoreGhsas: [GHSA-4444-5555-6666] }',
      'auditConfig:',
      '  ignoreGhsas:',
      '    # - GHSA-7777-8888-9999',
      '    - GHSA-aaaa-bbbb-cccc # GHSA-dddd-eeee-ffff mentioned in a note',
      '',
    ].join('\n');
    assert.deepEqual(ghsasInWorkspace(yaml), ['GHSA-aaaa-bbbb-cccc']);
  });

  it('counts exceptions set in package.json too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-spec-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0', private: true, pnpm: { auditConfig: { ignoreGhsas: ['GHSA-aaaa-bbbb-cccc'] } } }));
      assert.deepEqual(ignoredGhsas(dir), ['GHSA-aaaa-bbbb-cccc']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const [style, yaml] of [['block', block], ['flow', flow]] as const) it(`strips ${style}-style auditConfig so pnpm mutes nothing`, () => {
    const rest = stripAuditConfig(yaml);
    assert.ok(rest.includes("'a>b': ^1.0.0"));
    assert.doesNotMatch(rest, /auditConfig|GHSA-/);
    withWorkspace(rest, dir => assert.deepEqual(ignoredGhsas(dir), []));
  });

  it('finds no exceptions in a workspace without auditConfig', () => {
    withWorkspace("overrides:\n  'a>b': ^1.0.0\n", dir => assert.deepEqual(ignoredGhsas(dir), []));
  });

  it('reports advisories at moderate and above, as the CI gate does', () => {
    const audit = {
      advisories: {
        '1': { github_advisory_id: 'GHSA-1111-1111-1111', severity: 'low', module_name: 'a', title: 'minor' },
        '2': { github_advisory_id: 'GHSA-2222-2222-2222', severity: 'moderate', module_name: 'b', title: 'real' },
      },
    };
    assert.deepEqual(failingAdvisories(audit), ['GHSA-2222-2222-2222 (moderate) in b: real']);
  });

  it('treats only registry and network errors as an outage', () => {
    assert.equal(isServiceError({ code: 'ECONNREFUSED' }), true);
    assert.equal(isServiceError({ code: 'ETIMEDOUT' }), true);
    assert.equal(isServiceError({ code: 'ERR_PNPM_AUDIT_BAD_RESPONSE' }), true);
    assert.equal(isServiceError({ code: 'ERR_PNPM_AUDIT_NO_LOCKFILE' }), false);
    assert.equal(isServiceError(undefined), false);
  });

  it('exits 1 for a broken checkout, and findings outrank an outage elsewhere', () => {
    const script = join(process.cwd(), 'scripts/security-audit.mjs');
    // No lockfile: a person has to act, so 1 (not 2, which would retry and open no issue).
    withWorkspace('overrides: {}\n', dir => {
      // pnpm 11+ reads only pnpm_config_* (npm_config_* is ignored).
      const env = { ...process.env, pnpm_config_registry: 'http://127.0.0.1:9/', pnpm_config_fetch_retries: '0' };
      assert.equal(spawnSync('node', [script, dir], { encoding: 'utf8', env }).status, 1);
      // The repository root against an unreachable registry is an outage on its own (2) ...
      assert.equal(spawnSync('node', [script, '.'], { encoding: 'utf8', env }).status, 2);
      // ... but together with the broken checkout the result stays 1.
      assert.equal(spawnSync('node', [script, '.', dir], { encoding: 'utf8', env }).status, 1);
    });
  });

  it('keeps findings from the first audit when the exception check fails', () => {
    withWorkspace('auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\n', dir => {
      let calls = 0;
      const runAudit = () => {
        calls += 1;
        if (calls === 1) {
          return { advisories: { '1': { github_advisory_id: 'GHSA-2222-2222-2222', severity: 'high', module_name: 'b', title: 'real' } } };
        }
        throw new AuditUnavailable('registry timed out');
      };
      const result = checkRoot(dir, { runAudit });
      assert.equal(calls, 2);
      assert.deepEqual(result.problems, ['GHSA-2222-2222-2222 (high) in b: real']);
      assert.ok(result.error instanceof AuditUnavailable);
    });
  });

  it('keeps an exception whose advisory is still reported without a fix', () => {
    const audit = { advisories: { '1': { github_advisory_id: 'GHSA-aaaa-bbbb-cccc', module_name: 'x', patched_versions: '<0.0.0' } } };
    assert.deepEqual(staleExceptions(['GHSA-aaaa-bbbb-cccc'], audit), []);
  });

  it('flags an exception whose advisory is gone (withdrawn or outgrown)', () => {
    const [problem] = staleExceptions(['GHSA-aaaa-bbbb-cccc'], { advisories: {} });
    assert.match(problem, /^GHSA-aaaa-bbbb-cccc: no longer reported/);
  });

  it('flags an exception whose advisory now has a fix', () => {
    const audit = { advisories: { '1': { github_advisory_id: 'GHSA-aaaa-bbbb-cccc', module_name: 'x', patched_versions: '>=4.0.8' } } };
    const [problem] = staleExceptions(['GHSA-aaaa-bbbb-cccc'], audit);
    assert.match(problem, /x now has a fix \(>=4\.0\.8\)/);
  });
});

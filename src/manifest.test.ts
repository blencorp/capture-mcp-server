import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ToolCatalog } from './tools/index.js';

function readJson(url: URL): any {
  return JSON.parse(readFileSync(url, 'utf8'));
}

test('desktop manifest exposes every provider key and complete tool catalog', async () => {
  const packageJson = readJson(new URL('../package.json', import.meta.url));
  const manifest = readJson(new URL('../manifest.json', import.meta.url));
  const { tools } = await ToolCatalog.create({
    hasSamApiKey: true,
    hasTangoApiKey: true,
    hasHigherGovApiKey: true,
  });

  assert.equal(manifest.version, packageJson.version);

  const expectedProviderKeys = ['SAM_GOV_API_KEY', 'TANGO_API_KEY', 'HIGHERGOV_API_KEY'];
  assert.deepEqual(Object.keys(manifest.server.mcp_config.env).sort(), expectedProviderKeys.sort());
  for (const key of expectedProviderKeys) {
    assert.equal(manifest.server.mcp_config.env[key], `\${user_config.${key}}`);
    assert.equal(manifest.user_config[key].required, false);
    assert.equal(manifest.user_config[key].sensitive, true);
  }

  const runtimeNames = tools.map(tool => tool.name).sort();
  const manifestNames = manifest.tools.map((tool: any) => tool.name).sort();
  assert.equal(new Set(runtimeNames).size, runtimeNames.length, 'runtime tool names must be unique');
  assert.equal(new Set(manifestNames).size, manifestNames.length, 'manifest tool names must be unique');
  assert.equal(runtimeNames.length, 34);
  assert.deepEqual(manifestNames, runtimeNames);
});

test('the published package and the desktop bundle are consistent', () => {
  const packageJson = readJson(new URL('../package.json', import.meta.url));
  const manifest = readJson(new URL('../manifest.json', import.meta.url));

  // The bundle's name is the package's unscoped name; both carry one license and one Node range.
  assert.equal(packageJson.name, `@blen/${manifest.name}`);
  assert.equal(manifest.license, packageJson.license);
  assert.equal(manifest.compatibility.runtimes.node, packageJson.engines.node);

  // The bundle starts the same file the package's bin does.
  assert.equal(manifest.server.entry_point, packageJson.bin[manifest.name]);
  assert.equal(manifest.server.entry_point, packageJson.main);
  assert.deepEqual(manifest.server.mcp_config.args, [`\${__dirname}/${manifest.server.entry_point}`]);

  // Public publication with provenance, and only the files users need (never tests or sources).
  assert.deepEqual(packageJson.publishConfig, { access: 'public', provenance: true });
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'SECURITY.md']);
});

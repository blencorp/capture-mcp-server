// One definition of how a client starts the server. Every button and snippet on the site is
// built from it, and scripts/check-links.mjs decodes the built links against the same values.
import { exampleKeyValues, keyEnv, packageName, productName, repo, serverName } from '../../product.mjs';

export { packageName, productName, repo, serverName };

// The release workflow attaches the Claude Desktop bundle to each GitHub Release under this name.
export const bundleUrl = `${repo}/releases/latest/download/${repo.split('/').pop()}.mcpb`;

const command = 'npx';
const args = ['-y', packageName];

// Deep links carry empty keys: the server treats a blank key as unset and answers with
// instructions, where a made-up value would be sent to USPTO and refused.
const blankKeys = Object.fromEntries(keyEnv.map((name) => [name, '']));
const exampleKeys = exampleKeyValues;

// Cursor reads the server object alone, base64-encoded; the name travels as its own parameter.
export const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${serverName}&config=${encodeURIComponent(
  btoa(JSON.stringify({ command, args, env: blankKeys })),
)}`;

// VS Code reads one URL-encoded JSON object with the name inside it.
export const vscodeLink = `vscode:mcp/install?${encodeURIComponent(
  JSON.stringify({ name: serverName, command, args, env: blankKeys }),
)}`;

export const mcpServersJson = JSON.stringify(
  { mcpServers: { [serverName]: { command, args, env: exampleKeys } } },
  null,
  2,
);

// One option to a line, as Claude Code's documentation writes a long command. On one line, the
// page breaks the command in the middle of a key.
export const claudeCodeCommand = [
  `claude mcp add ${serverName}`,
  ...Object.entries(exampleKeys).map(([name, value]) => `-e ${name}=${value}`),
  `-- ${command} ${args.join(' ')}`,
].join(' \\\n  ');

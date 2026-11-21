#!/usr/bin/env node
// Publishes docs/sdk-reference.md as the site's SDK reference page, so the method list has one
// source: the repository file, which a test keeps in step with the tool catalog (src/server/toolCatalog.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSnippet } from '../src/lib/format.mjs';
import { repo } from '../product.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../docs/sdk-reference.md');
const target = resolve(here, '../src/content/docs/reference/sdk.md');
const repoDocs = `${repo}/blob/main/docs/`;

const text = readFileSync(source, 'utf8');
const title = /^# (.+)\n/.exec(text);
if (!title) throw new Error(`${source} must start with a "# " heading: the site takes its page title from it`);

// In the repository file a method's heading is its whole signature, which makes a long heading
// in code type. On the site the heading is the method's name, and the signature follows it.
let methods = 0;
let body = text
  .slice(title[0].length)
  .replace(/^#### `([^`(]+)(\([^`]*\))`$/gm, (_, name, parameters) => {
    methods += 1;
    return `#### \`${name}\`\n\n\`${name}${parameters}\``;
  })
  // The other documents in docs/ are not on the site: point their links at the repository.
  .replaceAll('](./', `](${repoDocs}`);
if (methods === 0) throw new Error(`${source}: found no "#### \`method(...)\`" headings; the generated format changed`);

// Each example is one long line in the repository file. Lay it out for reading.
const fence = /^```js\n([\s\S]*?)\n```$/gm;
const formatted = await Promise.all([...body.matchAll(fence)].map(([, code]) => formatSnippet(code)));
let next = 0;
body = body.replace(fence, () => `\`\`\`js\n${formatted[next++]}\n\`\`\``);

const frontmatter = [
  '---',
  `title: ${title[1]}`,
  'description: Every tool, its arguments, the result shape, the error codes, and the key status tool.',
  `editUrl: ${repo}/edit/main/docs/sdk-reference.md`,
  '---',
  '',
].join('\n');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, frontmatter + body);

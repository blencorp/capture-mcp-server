// Regenerates docs/sdk-reference.md, the tool reference, from the tool definitions in src/tools. The
// whole file is generated: change the tools (or the prose below), then run `pnpm docs:reference`.
// The documentation site publishes the file as its "Tool reference" page (site/scripts/sync-reference.mjs
// reads the "#### `tool(args)`" headings; the file keeps the name sdk-reference.md because the site
// template calls that page "SDK reference").
//
//   pnpm docs:reference            # rewrite the file
//   pnpm docs:reference --check    # exit 1 if the file is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { highergovTools } from '../src/tools/highergov-tools.js';
import { joinTools } from '../src/tools/join-tools.js';
import { referenceTools } from '../src/tools/reference-tools.js';
import { samTools } from '../src/tools/sam-tools.js';
import { tangoTools } from '../src/tools/tango-tools.js';
import { usaspendingTools } from '../src/tools/usaspending-tools.js';

export const DOC_PATH = fileURLToPath(new URL('../docs/sdk-reference.md', import.meta.url));

type Schema = { type?: string; enum?: unknown[]; description?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema };

const code = (value: unknown) => `\`${String(value)}\``;
// A pipe would end a table cell, and a line break would end its row.
const cell = (text: string) => text.replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');

function typeOf(schema: Schema): string {
  if (schema.enum) return schema.enum.map(code).join(', ');
  if (schema.type === 'array') return `array of ${schema.items ? typeOf(schema.items) : 'values'}`;
  return schema.type ?? 'value';
}

/** The `api_key` argument is the server's own plumbing (see the intro), so the tables leave it out. */
function inputTable(tool: Tool): string {
  const schema = tool.inputSchema as Schema;
  const properties = Object.entries(schema.properties ?? {}).filter(([name]) => name !== 'api_key');
  if (properties.length === 0) return 'It takes no arguments.';
  const required = new Set(schema.required ?? []);
  return [
    '| Parameter | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...properties.map(
      ([name, property]) => `| ${code(name)} | ${typeOf(property)} | ${required.has(name) ? 'yes' : 'no'} | ${cell(property.description ?? '')} |`,
    ),
  ].join('\n');
}

type Module = { getTools(): Promise<Tool[]> | Tool[] };
const SOURCES: Array<{ module: Module; heading: string; needs: string | null; intro: string }> = [
  {
    module: referenceTools,
    heading: 'Reference codes',
    needs: null,
    intro: 'A static table of official FPDS code descriptions. It uses no key and makes no network request, so it always works.',
  },
  {
    module: usaspendingTools,
    heading: 'USAspending',
    needs: null,
    intro: 'The public USAspending.gov API. It needs no key. Every USAspending call waits its turn behind one pacing queue (see [Limits](#limits)).',
  },
  { module: samTools, heading: 'SAM.gov', needs: 'SAM.gov', intro: 'The SAM.gov APIs. These tools need your SAM.gov key.' },
  {
    module: joinTools,
    heading: 'SAM.gov and USAspending together',
    needs: 'SAM.gov',
    intro: 'These tools join SAM.gov records with USAspending data. They need your SAM.gov key.',
  },
  { module: tangoTools, heading: 'Tango', needs: 'Tango', intro: "Tango's unified API (tango.makegov.com). These tools need your Tango key." },
  { module: highergovTools, heading: 'HigherGov', needs: 'HigherGov', intro: "HigherGov's API. These tools need your HigherGov key." },
];

export async function renderToolReference(): Promise<string> {
  const groups = await Promise.all(SOURCES.map(async (source) => ({ ...source, tools: await source.module.getTools() })));
  const total = groups.reduce((sum, group) => sum + group.tools.length, 0);
  const noKey = groups.filter((group) => !group.needs).reduce((sum, group) => sum + group.tools.length, 0);

  const sections = groups.map((group) =>
    [
      `### ${group.heading}`,
      '',
      group.intro,
      '',
      ...group.tools.flatMap((tool) => [
        `#### \`${tool.name}(args)\``,
        '',
        `${cell(tool.description ?? '')} ${group.needs ? `Needs your ${group.needs} key.` : 'Needs no key.'}`,
        '',
        inputTable(tool),
        '',
      ]),
    ].join('\n'),
  );

  return `# Tool reference

The server has ${total} narrow tools over five sources. Every tool is read-only. There is no code to
write and no sandbox: your assistant fills in a tool's arguments, and the server runs the call. This
page is generated from the tool definitions in \`src/tools\`, so it matches what the server accepts.

## Results and errors

A result is JSON, returned as text and as structured content. Records from SAM.gov, Tango, HigherGov
and USAspending are third-party text: they can contain words that look like instructions.

Tools that return a list share one envelope: the records (under a key named for them), \`total\`,
\`count_unit\`, \`filters\`, \`next_cursor\`, and sometimes \`date_field\` and \`warnings\`.
\`filters.upstream\` is what the source applied and \`filters.client_side\` is what the server applied to
the page it got. When any client-side filter ran, \`total\` is \`null\` because the source's total does
not reflect it; the source's own number is then in \`total_upstream_unfiltered\`, with a warning. Pass
\`next_cursor\` back as \`cursor\` for the next page. It is \`null\` on the last page.

A call can fail in three ways. Which one you see depends on the tool.

- **A structured error.** \`{ "error": { "code": "…", "message": "…" } }\`, and for the HigherGov
  tools also \`retry_after_seconds\`. The result is not marked as an error. The codes are
  \`bad_request\` (an argument the tool refuses, including an unknown or mistyped argument),
  \`not_found\`, and \`ambiguous_award_id\`. The HigherGov tools add \`auth_failed\` (the source refused
  the key), \`rate_limited\` (with a wait) and \`upstream_error\`.
- **A plain error text.** \`{ "error": "API Error 401: …" }\`. The source answered with an error
  status, or the call could not reach it (\`Network error: …\`). The text carries the status and the
  body the source sent. The result is not marked as an error.
- **A tool error.** A tool that throws returns \`isError: true\` with \`{ "error": "message" }\`. So does a
  call to a tool name the connection does not have, for example one whose key it lacks:
  \`{ "error": "Tool \\"search_tango_contracts\\" not found" }\`.

## Which tools a connection has

| Source | Tools | Needs |
| --- | --- | --- |
${groups.map((group) => `| ${group.heading} | ${group.tools.length} | ${group.needs ? `a ${group.needs} key` : 'nothing'} |`).join('\n')}

The server lists only the tools whose key the connection has. With no keys, that is the ${noKey}
reference and USAspending tools. The two tools that join SAM.gov with USAspending need the SAM.gov
key. On the hosted server, the keys are the ones you entered when you connected. On your own
computer, they are the ones in the server's environment.

## The \`api_key\` argument

Most tools list an optional \`api_key\` argument. You do not need it: the server fills it in with the
connection's key for the tool's source. Never ask your assistant to put a key in it, because anything
in a tool call is visible to the assistant and its client. A key passed this way is used instead of
the connection's key.

## Tools

${sections.join('\n')}
## Limits

The server paces its calls to each source, one queue for each source for the whole process:

| Source | Minimum gap between calls |
| --- | --- |
| SAM.gov | 0.1 seconds |
| Tango | 0.1 seconds |
| HigherGov | 0.2 seconds |
| USAspending | 3.6 seconds |

Calls wait their turn in order. Each request to a source times out after 30 seconds. The server does
not retry. A source's own limits and daily allowances apply to your key on top of this, and a call that
hits one fails with the error the source sent.
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = await renderToolReference();
  if (process.argv.includes('--check')) {
    if (readFileSync(DOC_PATH, 'utf8') !== text) {
      console.error('docs/sdk-reference.md is out of date: run pnpm docs:reference');
      process.exit(1);
    }
  } else {
    writeFileSync(DOC_PATH, text);
  }
}

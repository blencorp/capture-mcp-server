# Examples

Tool calls for the documentation site's "Example questions" page, one JSON file each:
`{ "tool": "<name>", "arguments": { ... } }`. `src/docs-examples.test.ts` checks every file's
`arguments` with the server's own argument validation (`validateToolArgs`, in `src/tools/index.ts`)
against that tool's input schema, so an example the server would refuse fails the build.

The dates and identifiers are made up and fixed so the examples stay valid. An assistant fills in
values that fit the question.

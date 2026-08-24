# Contributing to Capture MCP Server

First off, thank you for considering contributing to Capture MCP Server! It's people like you that make this MIT-licensed tool better for everyone.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, please include as many details as possible using our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Before creating enhancement suggestions, please check the existing issues. When creating an enhancement suggestion, please use our [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/blencorp/capture-mcp-server.git
   cd capture-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   export SAM_GOV_API_KEY=your-sam-api-key   # Enables SAM.gov + join tools
   export TANGO_API_KEY=your-tango-api-key   # Enables Tango tools
   export HIGHERGOV_API_KEY=your-highergov-api-key # Enables HigherGov tools
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run in development mode:
   ```bash
   npm run dev
   ```

## Development Guidelines

### Code Style

- We use TypeScript for type safety
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

Conventional Commit prefixes are optional but they decide the released version
(see [Releases](#releases)):

| Prefix | Effect on the next release |
| --- | --- |
| `feat:` / `feat(scope):` | minor bump (1.2.3 → 1.3.0) |
| `fix:`, `docs:`, `chore:`, `ci:`, anything else | patch bump (1.2.3 → 1.2.4) |
| any type with `!` (`feat!:`), or a `BREAKING CHANGE:` footer | major bump (1.2.3 → 2.0.0) |
| no prefix at all | patch bump |

### Testing

- Write tests for new functionality
- Ensure all tests pass before submitting PR
- Include both positive and negative test cases
- Test edge cases

### Documentation

- Update README.md if you change functionality
- Update CLAUDE.md if you add new development commands
- Document new tools in the appropriate section
- Include JSDoc comments for public APIs

## Releases

Releases are automatic. Every merge to `main` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. Runs the full test suite — a failing suite blocks the release.
2. Picks the next version from the Conventional Commit prefixes since the last
   tag (see the table above). The first release seeds at `package.json`'s
   current version instead of bumping past it.
3. Writes the version into `package.json`, `package-lock.json`, and
   `manifest.json`, commits it as `chore(release): vX.Y.Z [skip ci]`, and
   pushes it to `main`.
4. Pushes the `vX.Y.Z` tag and publishes a GitHub release whose notes are
   generated from the merged pull requests. Note grouping is configured in
   [`.github/release.yml`](.github/release.yml) — label PRs (`feature`, `bug`,
   `breaking`, `upstream`, `documentation`) to place them in a section.

To force a level, run the **Release** workflow manually from the Actions tab
and choose `patch`, `minor`, or `major`. To land a change on `main` without
releasing, include `[skip release]` in the merge commit message.

Preview what the next release would be without publishing anything:

```bash
npm run release-version              # prints current/next/bump
npm run release-version -- --bump=minor
```

The bump logic lives in `src/utils/version-bump.ts` and is unit tested; the
workflow only supplies git history and file I/O through
`scripts/release-version.ts`.

**Requirements:** the workflow pushes the bump commit to `main` with the
built-in `GITHUB_TOKEN`. If `main` is protected, either allow GitHub Actions to
bypass the restriction or the push step will fail (the tag and release are
created only after that push succeeds).

## Project Structure

```
capture-mcp-server/
├── src/
│   ├── server.ts            # Main MCP server bootstrap
│   ├── tools/               # Tool implementations (SAM, USASpending, Tango, join)
│   │   ├── index.ts         # Tool registry
│   │   ├── sam-tools.ts     # SAM.gov API tools (4)
│   │   ├── usaspending-tools.ts # USASpending API tools (4)
│   │   ├── join-tools.ts    # Cross-API tools (2)
│   │   └── tango-tools.ts   # Tango API tools (5)
│   └── utils/
│       └── api-client.ts    # Shared HTTP client with rate limiting
├── dist/                    # Compiled TypeScript output
├── assets/                  # Extension assets (icons, etc.)
└── README.md, manifest.json # Public documentation and MCP manifest
```

## Adding New Tools

1. Create a new file in `src/tools/` or add to existing tool file
2. Export `getTools()` and `callTool()` functions
3. Register the tool in `src/tools/index.ts`
4. Update documentation
5. Add tests for the new tool

Example tool structure:
```typescript
export function getTools() {
  return [{
    name: "tool-name",
    description: "What this tool does",
    inputSchema: {
      type: "object",
      properties: {
        // Define parameters
      },
      required: ["required-params"]
    }
  }];
}

export async function callTool(name: string, args: any): Promise<any> {
  // Implement tool logic
}
```

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

Thank you for contributing!

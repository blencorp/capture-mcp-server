# Contributing to Capture MCP Server

First off, thank you for considering contributing to Capture MCP Server! It's people like you that make this tool better for everyone.

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
   git clone https://github.com/your-username/capture-mcp-server.git
   cd capture-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   export SAM_GOV_API_KEY=your-api-key
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

## Project Structure

```
capture-mcp-server/
├── src/
│   ├── server.ts           # Main MCP server
│   ├── tools/              # Tool implementations
│   │   ├── sam-tools.ts    # SAM.gov API tools
│   │   ├── usaspending-tools.ts  # USASpending API tools
│   │   └── join-tools.ts   # Cross-API tools
│   └── utils/              # Utility functions
│       └── api-client.ts   # API client with rate limiting
├── dist/                   # Compiled output
└── tests/                  # Test files
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
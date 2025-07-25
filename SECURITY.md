# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within Capture MCP Server, please send an email to security@example.com. All security vulnerabilities will be promptly addressed.

Please do not report security vulnerabilities through public GitHub issues.

### What to include in your report

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

### What to expect

- Within 48 hours, we will acknowledge receipt of your vulnerability report
- Within 7 days, we will send a more detailed response indicating the next steps
- We will keep you informed about the progress towards fixing the vulnerability
- We will notify you when the vulnerability is fixed

## Security Best Practices

When using Capture MCP Server:

1. **API Key Management**
   - Never commit API keys to version control
   - Use environment variables for sensitive configuration
   - Rotate API keys regularly
   - Restrict API key permissions to minimum required

2. **Data Handling**
   - Be aware that procurement data may contain sensitive information
   - Implement proper access controls in your application
   - Log access to sensitive data appropriately
   - Follow data retention policies

3. **Network Security**
   - Use HTTPS for all API communications
   - Implement proper rate limiting
   - Monitor for unusual API usage patterns

4. **Dependencies**
   - Keep all dependencies up to date
   - Regularly audit dependencies for vulnerabilities
   - Use `npm audit` to check for known vulnerabilities

## Disclosure Policy

When we receive a security vulnerability report, we will:

1. Confirm the vulnerability and determine its impact
2. Work on a fix and prepare a security update
3. Release the update and publish a security advisory
4. Credit the reporter (unless they prefer to remain anonymous)

We ask that you:

- Give us reasonable time to fix the issue before public disclosure
- Make a good faith effort to avoid privacy violations and data destruction
- Not access or modify data without explicit permission

Thank you for helping keep Capture MCP Server and its users safe!
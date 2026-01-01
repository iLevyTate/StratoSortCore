# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Design Principles

StratoSort is designed with security and privacy as core principles:

- **Local-First Processing**: All AI analysis happens locally using Ollama. No data is sent to
  external servers.
- **Context Isolation**: The Electron renderer process runs with strict context isolation and
  sandbox enabled.
- **Input Validation**: All IPC communications use Zod schema validation to prevent injection
  attacks.
- **Path Sanitization**: File paths are validated against dangerous patterns and system directories.
- **No Telemetry by Default**: Analytics and telemetry are disabled unless explicitly enabled by the
  user.

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these
steps:

### For Critical Vulnerabilities

1. **Do NOT** create a public GitHub issue
2. Email the maintainers directly at [security@stratosort.com](mailto:security@stratosort.com)
3. Include:
   - A clear description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact assessment
   - Any suggested fixes (optional but appreciated)

### For Non-Critical Issues

1. Create a GitHub issue with the `security` label
2. Avoid including exploit code or detailed attack vectors in public issues

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity
  - Critical: 1-7 days
  - High: 7-14 days
  - Medium: 14-30 days
  - Low: Next release cycle

## Security Best Practices for Users

### Installation

- Download StratoSort only from official sources (GitHub Releases)
- Verify checksums when available
- Keep the application updated to the latest version

### Configuration

- Review imported settings files before applying
- Use strong, unique paths for sensitive document organization
- Regularly backup your settings using the built-in backup feature

### Network

- StratoSort communicates only with local services (Ollama, ChromaDB)
- No external network requests are made during normal operation
- If using remote Ollama instances, ensure proper network security

## Known Security Considerations

### Electron Security

- Node integration is disabled in the renderer process
- Context isolation is enabled
- Web security is enabled
- The sandbox is enabled for all renderer processes

### File System Access

- StratoSort requires file system access to organize files
- Dangerous system paths are blocked from organization operations
- Path traversal attacks are mitigated through validation

### Settings Import/Export

- Imported settings are validated against a whitelist of allowed keys
- URL patterns are validated to prevent SSRF-style attacks
- Prototype pollution attacks are explicitly blocked

## Security Updates

Security updates will be released as patch versions (e.g., 1.0.1, 1.0.2) and announced via:

- GitHub Releases
- In-app update notifications (if auto-update is enabled)

## Acknowledgments

We appreciate the security research community's efforts in making StratoSort more secure.
Contributors who report valid security issues will be acknowledged here (with permission).

---

_Last updated: December 2024_

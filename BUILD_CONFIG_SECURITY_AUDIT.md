# Build Configuration & Deployment Security Audit Report

**Project:** StratoSort 1.0.0
**Audit Date:** 2025-11-18
**Scope:** Build configurations, webpack, deployment scripts, and dependencies

---

## Executive Summary

**Found 2 CRITICAL issues, 5 HIGH severity issues, 7 MEDIUM severity issues, and 4 LOW severity issues.**

The audit identified critical command injection vulnerabilities in setup scripts, dependency vulnerabilities requiring immediate patching, insecure webpack configurations, and several missing security hardening measures. While some security measures are in place (CSP in dev server, source map disabled in production), there are significant gaps that need addressing.

---

## Critical Issues (Fix Immediately)

### CRITICAL-1: Command Injection Vulnerability in setup-ollama-windows.ps1

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\scripts\setup-ollama-windows.ps1`
**Lines:** 84-85, 506

**Issue:** The PowerShell script downloads and executes an installer from the internet without verification:

```powershell
# Line 84-85: No signature or hash verification
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile($OLLAMA_DOWNLOAD_URL, $OLLAMA_INSTALLER)

# Line 506: Linux installation executes remote shell script
$installCmd = 'curl -fsSL https://ollama.com/install.sh | sh'
```

**Severity:** CRITICAL - Allows arbitrary code execution if attacker controls DNS/network or compromises ollama.com

**Attack Scenario:**

1. Attacker performs MitM attack or DNS poisoning
2. Substitutes malicious installer/script
3. Script executes malware with user privileges

**Remediation:**

```powershell
# Add SHA256 verification
$OLLAMA_INSTALLER_HASH = "INSERT_EXPECTED_SHA256_HERE"

$webClient.DownloadFile($OLLAMA_DOWNLOAD_URL, $OLLAMA_INSTALLER)

# Verify hash before execution
$actualHash = (Get-FileHash $OLLAMA_INSTALLER -Algorithm SHA256).Hash
if ($actualHash -ne $OLLAMA_INSTALLER_HASH) {
    Write-ColorOutput "✗ Installer verification failed! Hash mismatch." "Red"
    Remove-Item $OLLAMA_INSTALLER -Force
    exit 1
}
```

For Linux installation, download and verify before piping to sh:

```bash
curl -fsSL https://ollama.com/install.sh -o /tmp/install.sh
# Verify hash or signature
sha256sum -c install.sh.sha256 || exit 1
sh /tmp/install.sh
```

---

### CRITICAL-2: Command Injection in setup-ollama.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\setup-ollama.js`
**Lines:** 146-150, 196-202

**Issue:** HTTPS module used without certificate validation, and spawning child processes with shell:true:

```javascript
// Line 146-150: No TLS verification
const request = (url.protocol === 'https:' ? https : require('http')).get(
  url,
  (res) => {
    resolve(res.statusCode === 200);
  },
);

// Line 196-202: shell:true enables command injection
const ollamaProcess = spawn('ollama', ['serve'], {
  detached: true,
  stdio: 'ignore',
  shell: process.platform === 'win32', // DANGEROUS
});
```

**Severity:** CRITICAL - MitM attacks possible, shell injection risk

**Remediation:**

```javascript
// Add TLS verification
const https = require('https');
const options = {
  rejectUnauthorized: true, // Enforce certificate validation
  timeout: 2000,
};

https
  .get(url, options, (res) => {
    resolve(res.statusCode === 200);
  })
  .on('error', () => resolve(false));

// Avoid shell:true - use explicit path
const ollamaPath = which.sync('ollama', { nothrow: true });
if (!ollamaPath) {
  console.error('ollama not found in PATH');
  return false;
}

const ollamaProcess = spawn(ollamaPath, ['serve'], {
  detached: true,
  stdio: 'ignore',
  shell: false, // SAFER
});
```

---

## High Severity Issues

### HIGH-1: npm Dependency Vulnerabilities

**Location:** package.json dependencies
**Detected by:** npm audit

**Vulnerabilities Found:**

1. **glob** (High): Command injection via -c/--cmd flag (GHSA-5j98-mcp5-4vw2)
   - Affected versions: 10.3.7-10.4.5, 11.0.0-11.0.3
   - CVSS Score: 7.5
   - CWE-78: OS Command Injection

2. **js-yaml** (Moderate): Prototype pollution in merge (GHSA-mh29-5h37-fv8m)
   - Affected versions: <3.14.2, 4.0.0-4.1.1
   - CVSS Score: 5.3
   - CWE-1321: Prototype Pollution

**Impact:** Although these are dev dependencies, they could be exploited during build process.

**Remediation:**

```bash
# Update vulnerable packages
npm audit fix

# If automatic fix fails, manually update:
npm install glob@latest js-yaml@latest --save-dev

# Verify fix
npm audit
```

---

### HIGH-2: Missing Content Security Policy in Production

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\webpack.config.js`
**Lines:** 112-126

**Issue:** CSP is only configured for dev server, not for production builds:

```javascript
// Line 112-126: CSP only in devServer
devServer: isProduction
  ? undefined
  : {
      headers: {
        'Content-Security-Policy': "default-src 'self'; ...",
      },
    };
```

**Severity:** HIGH - XSS attacks possible in production builds

**Remediation:**
Add CSP meta tag to HTML template or use HtmlWebpackPlugin to inject:

```javascript
new HtmlWebpackPlugin({
  template: './src/renderer/index.html',
  filename: 'index.html',
  inject: true,
  scriptLoading: 'blocking',
  meta: isProduction ? {
    'Content-Security-Policy': {
      'http-equiv': 'Content-Security-Policy',
      content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://localhost:11434 http://127.0.0.1:11434; object-src 'none'; base-uri 'self';"
    }
  } : {}
}),
```

---

### HIGH-3: Webpack Source Maps Disabled in Production

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\webpack.config.js`
**Line:** 109

**Issue:**

```javascript
devtool: isProduction ? false : 'source-map',
```

**Severity:** HIGH - While this prevents source exposure, it makes debugging production issues impossible

**Analysis:** This is actually a security-positive configuration (preventing source code leakage), but it's a double-edged sword. Consider alternatives:

**Recommendation:**

```javascript
// Use hidden source maps for production
devtool: isProduction ? 'hidden-source-map' : 'source-map',

// In optimization section, ensure source maps aren't extracted
optimization: {
  minimize: isProduction,
  minimizer: isProduction ? [
    new TerserPlugin({
      parallel: true,
      extractComments: false,  // Good!
      terserOptions: {
        compress: {
          drop_console: true,  // Good!
        },
        // Add source map configuration
        sourceMap: {
          filename: '[file].map[query]',
          // Don't include sources in the source map
          include: false,
        }
      },
    }),
  ] : [],
}
```

Store source maps internally, don't ship them with the app. Upload to error tracking service (Sentry, etc.) separately.

---

### HIGH-4: No Subresource Integrity (SRI) for External Resources

**Location:** Webpack configuration

**Issue:** No SRI hashes for any bundled resources. While this is an Electron app (primarily local resources), any remote resources loaded should have integrity checks.

**Remediation:**

```javascript
// Install webpack-subresource-integrity
npm install --save-dev webpack-subresource-integrity

// In webpack.config.js
const SriPlugin = require('webpack-subresource-integrity');

module.exports = {
  output: {
    crossOriginLoading: 'anonymous',
  },
  plugins: [
    new SriPlugin({
      hashFuncNames: ['sha384'],
      enabled: isProduction,
    }),
  ],
};
```

---

### HIGH-5: Insecure File Operations in generate-icons.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\scripts\generate-icons.js`
**Lines:** 213-214, 248

**Issue:** Path traversal vulnerability and arbitrary module execution:

```javascript
// Line 213-214: User-controlled process.cwd() used in path
const projectRoot = process.cwd();
const sourceLogo = path.join(projectRoot, 'assets', 'stratosort-logo.png');

// Line 248: Dynamic require without validation
require('./generate-nsis-assets');
```

**Severity:** HIGH - If an attacker can control working directory or file system, arbitrary code execution is possible

**Remediation:**

```javascript
// Use __dirname instead of process.cwd()
const projectRoot = __dirname;
const sourceLogo = path.join(
  projectRoot,
  '..',
  'assets',
  'stratosort-logo.png',
);

// Validate path doesn't escape project directory
const resolvedPath = path.resolve(sourceLogo);
if (!resolvedPath.startsWith(path.resolve(projectRoot, '..'))) {
  console.error('Invalid path - directory traversal detected');
  process.exit(1);
}

// Import at top of file instead of dynamic require
const nsisAssets = require('./generate-nsis-assets');
// Later in code:
nsisAssets.generateAssets();
```

---

## Medium Severity Issues

### MEDIUM-1: Missing Webpack Security Headers

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\webpack.config.js`

**Issue:** Dev server missing critical security headers:

- X-Content-Type-Options
- X-Frame-Options
- X-XSS-Protection
- Referrer-Policy

**Remediation:**

```javascript
devServer: {
  headers: {
    'Content-Security-Policy': "...",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  }
}
```

---

### MEDIUM-2: Overly Permissive CSP for WebSockets

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\webpack.config.js`
**Line:** 124

**Issue:**

```javascript
connect-src 'self' http://localhost:11434 http://127.0.0.1:11434 ws://localhost:*
```

The `ws://localhost:*` allows connections to ANY port on localhost.

**Remediation:**

```javascript
// Be specific about WebSocket port
'connect-src': "'self' http://localhost:11434 http://127.0.0.1:11434 ws://localhost:3000"
```

---

### MEDIUM-3: Unvalidated Environment Variables

**Location:** Multiple files (setup-ollama.js, webpack.config.js)

**Issue:** Environment variables used without validation:

```javascript
// setup-ollama.js line 38
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// startup-check.js line 50
const ollamaHost = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
```

**Severity:** MEDIUM - URL injection possible if attacker controls environment

**Remediation:**

```javascript
function validateOllamaHost(host) {
  const defaultHost = 'http://127.0.0.1:11434';

  if (!host) return defaultHost;

  try {
    const url = new URL(host);
    // Only allow localhost/127.0.0.1
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      console.warn('Invalid OLLAMA_HOST - must be localhost');
      return defaultHost;
    }
    // Only allow http protocol
    if (url.protocol !== 'http:') {
      console.warn('Invalid OLLAMA_HOST - must use http://');
      return defaultHost;
    }
    return host;
  } catch {
    return defaultHost;
  }
}

const OLLAMA_HOST = validateOllamaHost(process.env.OLLAMA_HOST);
```

---

### MEDIUM-4: Shell Execution Vulnerability in generate-icons.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\scripts\generate-icons.js`
**Line:** 115

**Issue:**

```javascript
execSync(`iconutil -c icns -o "${icnsPath}" "${iconsetDir}"`);
```

**Severity:** MEDIUM - Command injection if paths contain special characters

**Remediation:**

```javascript
const { execFileSync } = require('child_process');

// Use execFileSync with array arguments (safer)
execFileSync('iconutil', ['-c', 'icns', '-o', icnsPath, iconsetDir], {
  stdio: 'inherit',
});
```

---

### MEDIUM-5: Insecure Defaults in electron-builder.json

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\electron-builder.json`

**Issues:**

1. **Line 66:** `allowElevation: true` - Permits UAC bypass attempts
2. **Line 76:** `hardenedRuntime: true` but **Line 77:** `gatekeeperAssess: false` - Disables macOS security checks
3. **No code signing configured** - Builds will be flagged as untrusted

**Remediation:**

```json
{
  "nsis": {
    "allowElevation": false, // Only allow if truly necessary
    "requestExecutionLevel": "user"
  },
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": true, // Enable Gatekeeper
    "electronLanguages": ["en"],
    "identity": "Developer ID Application: Your Name (TEAM_ID)",
    "entitlements": "assets/entitlements.mac.plist",
    "entitlementsInherit": "assets/entitlements.mac.plist"
  },
  "win": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "${env.CERT_PASSWORD}",
    "signingHashAlgorithms": ["sha256"]
  }
}
```

---

### MEDIUM-6: Missing Input Validation in startup-check.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\startup-check.js`
**Lines:** 51-66

**Issue:** Injecting user-controlled URL into shell command:

```javascript
// Line 51-58: URL from env var used in PowerShell
`try { (Invoke-WebRequest -Uri "${ollamaHost}/api/tags" -UseBasicParsing).StatusCode } catch { 0 }`;
```

**Severity:** MEDIUM - PowerShell command injection possible

**Remediation:**

```javascript
// Validate URL before use
function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new Error('Only localhost allowed');
    }
    return url;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

const ollamaHost = validateUrl(
  process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
);

// Use proper escaping
const escapedUrl = ollamaHost.replace(/["'$`]/g, '\\$&');
```

---

### MEDIUM-7: Potential Prototype Pollution in tailwind.config.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\tailwind.config.js`

**Issue:** Large safelist with dynamically generated class names could be exploited if user input controls class names anywhere in the app.

**Severity:** MEDIUM - Potential XSS if class names come from untrusted sources

**Remediation:**

- Minimize safelist to only truly dynamic classes
- Never use user input to generate class names
- Use allowlist patterns instead of explicit class names:

```javascript
safelist: [
  {
    pattern:
      /^(btn|badge|alert)-(primary|secondary|success|warning|error|info)$/,
    variants: ['hover', 'focus', 'active'],
  },
  // Instead of listing 100+ individual classes
];
```

---

## Low Severity Issues

### LOW-1: Development Dependencies in Production Bundle

**Location:** package.json

**Issue:** Some packages like `electron-debug` appear in dependencies but should be devDependencies.

**Check:** Review if these are actually needed at runtime:

- @types/\* packages should be in devDependencies
- Testing libraries should be in devDependencies

**Remediation:**

```bash
npm install --save-dev @types/node @types/react @types/react-dom
```

---

### LOW-2: Missing Error Handling in generate-nsis-assets.js

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\scripts\generate-nsis-assets.js`
**Line:** 54

**Issue:**

```javascript
process.exit(0); // Always exits with success even on error
```

**Remediation:**

```javascript
main().catch((err) => {
  console.error('[nsis-assets] Error generating assets', err);
  // Don't fail build if assets are missing
  console.warn('[nsis-assets] Build will continue without custom NSIS assets');
  process.exit(0);
});
```

---

### LOW-3: Hardcoded Credentials Risk

**Location:** .gitignore

**Good:** .env files are properly ignored
**Warning:** No .env.example file to document required environment variables

**Remediation:**
Create `.env.example`:

```bash
# Ollama Configuration
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Build Configuration
NODE_ENV=development
WEBPACK_DEV_SERVER=false

# Code Signing (DO NOT COMMIT ACTUAL VALUES)
# CERT_PASSWORD=your_certificate_password_here
# APPLE_ID=your_apple_id
# APPLE_ID_PASSWORD=@keychain:AC_PASSWORD
```

---

### LOW-4: Babel Configuration Missing Security Options

**Location:** `C:\Users\benja\Downloads\StratoSort-1.0.0\StratoSort-1.0.0\babel.config.js`

**Issue:** Very basic configuration, missing security-related transforms

**Remediation:**

```javascript
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { node: 'current' },
        modules: 'auto',
        bugfixes: true, // Enable latest fixes
      },
    ],
    '@babel/preset-react',
    '@babel/preset-typescript',
  ],
  plugins: [
    // Add security-focused plugins
    ['transform-remove-console', { exclude: ['error', 'warn'] }],
  ],
  env: {
    production: {
      plugins: ['transform-remove-console', 'transform-remove-debugger'],
    },
  },
};
```

---

## Configuration Best Practices

### Webpack Security Hardening Checklist

- [x] Source maps disabled in production
- [x] Console statements removed in production
- [ ] CSP meta tag in production HTML
- [ ] Subresource Integrity (SRI) hashes
- [ ] Security headers in production
- [x] HTTPS-only in production (Electron app, N/A)
- [ ] Bundle analysis to detect suspicious code

### Dependency Security Checklist

- [ ] Regular npm audit
- [ ] Automated dependency updates (Dependabot/Renovate)
- [ ] Lock file committed (.npmrc configured)
- [x] Dev dependencies separated from production
- [ ] License compliance check
- [ ] Supply chain attack monitoring

### Build Script Security Checklist

- [ ] No shell injection vulnerabilities
- [ ] Input validation on all external inputs
- [ ] No dynamic require() with user input
- [ ] Path traversal prevention
- [ ] Checksum verification for downloads
- [ ] Code signing certificates protected
- [ ] No secrets in scripts or configs

---

## Immediate Action Items

1. **CRITICAL Priority (Fix this week):**
   - [ ] Add SHA256 verification to setup-ollama-windows.ps1
   - [ ] Remove shell:true from spawn calls in setup-ollama.js
   - [ ] Update vulnerable npm packages (glob, js-yaml)

2. **HIGH Priority (Fix within 2 weeks):**
   - [ ] Implement CSP for production builds
   - [ ] Fix command injection in generate-icons.js
   - [ ] Add input validation for environment variables
   - [ ] Configure code signing for Windows/macOS

3. **MEDIUM Priority (Fix within 1 month):**
   - [ ] Add security headers to webpack config
   - [ ] Restrict WebSocket CSP to specific port
   - [ ] Fix electron-builder security settings
   - [ ] Add SRI hashes for resources

4. **LOW Priority (Technical debt):**
   - [ ] Create .env.example file
   - [ ] Clean up production dependencies
   - [ ] Enhance error handling in build scripts
   - [ ] Set up automated security scanning

---

## Security Scanning Recommendations

### Automated Tools to Integrate

1. **npm audit** - Run in CI/CD:

   ```bash
   npm audit --production --audit-level=moderate
   ```

2. **Snyk** - Comprehensive vulnerability scanning:

   ```bash
   npx snyk test
   npx snyk monitor
   ```

3. **ESLint Security Plugin**:

   ```bash
   npm install --save-dev eslint-plugin-security
   ```

   Add to .eslintrc.js:

   ```javascript
   {
     "plugins": ["security"],
     "extends": ["plugin:security/recommended"]
   }
   ```

4. **Electron Security Checklist**:

   ```bash
   npm install --save-dev @doyensec/electronegativity
   npx electronegativity -i .
   ```

5. **OWASP Dependency-Check**:
   ```bash
   npm install -g owasp-dependency-check
   dependency-check --project StratoSort --scan .
   ```

---

## File-by-File Summary

| File                     | Critical | High | Medium | Low | Status     |
| ------------------------ | -------- | ---- | ------ | --- | ---------- |
| webpack.config.js        | 0        | 2    | 2      | 0   | NEEDS WORK |
| setup-ollama-windows.ps1 | 1        | 0    | 0      | 0   | CRITICAL   |
| setup-ollama.js          | 1        | 0    | 1      | 0   | CRITICAL   |
| generate-icons.js        | 0        | 1    | 1      | 0   | NEEDS WORK |
| electron-builder.json    | 0        | 0    | 1      | 0   | NEEDS WORK |
| package.json             | 0        | 1    | 0      | 1   | NEEDS WORK |
| startup-check.js         | 0        | 0    | 1      | 0   | NEEDS WORK |
| babel.config.js          | 0        | 0    | 0      | 1   | OK         |
| .eslintrc.js             | 0        | 0    | 0      | 0   | OK         |
| tailwind.config.js       | 0        | 0    | 1      | 0   | OK         |
| postcss.config.js        | 0        | 0    | 0      | 0   | OK         |
| generate-nsis-assets.js  | 0        | 0    | 0      | 1   | OK         |
| build/installer.nsh      | 0        | 0    | 0      | 0   | OK         |

---

## Positive Security Findings

The following security measures are already implemented correctly:

1. ✓ Source maps disabled in production (webpack.config.js:109)
2. ✓ Console statements removed in production (webpack.config.js:151)
3. ✓ CSP implemented for dev server (webpack.config.js:123-124)
4. ✓ .env files properly ignored (.gitignore:17-21)
5. ✓ Comments removed from production CSS (postcss.config.js:8)
6. ✓ ASAR packaging enabled (electron-builder.json:12)
7. ✓ Source maps excluded from builds (electron-builder.json:21)
8. ✓ Test files excluded from builds (electron-builder.json:22-25)
9. ✓ Hardened runtime for macOS (electron-builder.json:76)
10. ✓ File associations properly configured (electron-builder.json:47-55)

---

## Conclusion

The StratoSort build configuration has a **moderate security posture** with several critical issues that need immediate attention. The most concerning findings are:

1. **Command injection vulnerabilities** in setup scripts that download and execute remote code without verification
2. **npm dependency vulnerabilities** requiring updates
3. **Missing CSP for production builds** leaving the app vulnerable to XSS
4. **Insecure spawn/exec calls** using shell:true

**Priority:** Address CRITICAL and HIGH severity issues within 1-2 weeks. The application should not be released to production until these are resolved.

**Overall Risk Level:** HIGH

**Recommended Actions:**

1. Implement all CRITICAL fixes immediately
2. Set up automated security scanning in CI/CD
3. Establish a regular security review cadence (monthly npm audit)
4. Configure code signing for production releases
5. Add security testing to pre-release checklist

---

**Auditor Notes:** This audit focused on static analysis of configuration files and build scripts. A full security audit should also include:

- Runtime analysis of the Electron app
- Review of main/renderer process security
- IPC communication security
- Node integration and context isolation settings
- Review of preload script and contextBridge usage

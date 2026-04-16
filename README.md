# FME Workshop Setup

This is not a walkthrough. These are instructions for creating a workshop for a customer.

## Quick Start

### Prerequisites

- Node.js installed
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/dbmartin00/fme-workshop
cd fme-workshop

# Install dependencies
npm install
```

### Configuration

Create a `config` file (no .json extension) with your settings:

```json
{
  "emails": [
    "admin@example.com",
    "developer@example.com",
    "owner@example.com"
  ],
  "apiKey": "YOUR_API_KEY_HERE",
  "accountIdentifier": "<Harness account ID>",
  "harnessOrgIdentifier": "default",
  "orgIdentifier": "<Split org ID if different>",
  "clientSideApiKey": "<optional - for generate phase only>"
}
```

**Configuration Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `emails` | ✅ | Array of recipient email addresses |
| `apiKey` | ✅ | API key for both Harness and Split APIs (sent via `x-api-key` header) |
| `accountIdentifier` | Optional | Harness account ID (required for Harness integration) |
| `harnessOrgIdentifier` | Optional | Harness organization ID (defaults to "default") |
| `orgIdentifier` | Optional | Split organization ID if different from Harness |
| `clientSideApiKey` | Optional | Pre-existing client-side API key (for generate-only mode) |

**API Key Requirements:**

- **All requests use `x-api-key` header** with the `apiKey` value
- Works for both Harness and Split.io APIs
- If using Harness integration, the API key requires these bindings:
  - FME Administrator
  - FME Manager
  - FME Account API (or Account Admin)

## Usage

### Two-Phase Operation

The workshop generator operates in two phases that can be run together or separately:

#### Phase 1: Setup & Initialize
Creates/initializes Harness project, Split workspace, environments, segments, and feature flags.

```bash
node index.js setup
```

#### Phase 2: Generate HTML
Creates HTML files from templates with SDK configuration and packages them into a ZIP file.

```bash
node index.js generate
```

#### Run Both Phases
```bash
node index.js
# or explicitly
node index.js all
```

### Verbose Mode

Enable detailed logging for debugging:

```bash
# Add --verbose or -v to any command
node index.js --verbose
node index.js setup -v
node index.js generate --verbose
```

**Verbose mode shows:**
- Account and organization identifiers
- Workspace and environment IDs
- Individual feature flag operations
- File processing details
- Full error details with URLs and status codes

### Serving HTML Files Locally

After generating HTML files, you can serve them locally for testing:

```bash
# Start local web server
node serve.js

# Access at http://localhost:8000
```

The server:
- ✅ Serves HTML files and assets (images, CSS, JS)
- ✅ Provides auto-generated file listing page
- ✅ Protects source code (index.js, config, etc.)
- ✅ Default port: 8000 (override with `PORT=3000 node serve.js`)

## Environment Variables

Customize API endpoints and behavior using environment variables:

```bash
# Split API base URL (default: https://api.split.io)
SPLIT_API_BASE=https://api.split.io

# Harness API base URL (default: https://app.harness.io)
HARNESS_API_BASE=https://app.harness.io

# Enable verbose logging (default: false)
VERBOSE=true

# Server port for serve.js (default: 8000)
PORT=3000
```

**Example with custom environment:**

```bash
# For custom Split.io deployments (e.g., on-premise)
SPLIT_API_BASE=https://api.custom.split.io node index.js setup
```

## Centralized API Configuration

All API endpoints are configured in `index.js` and derived from environment variables:

```javascript
const SPLIT_API_BASE = process.env.SPLIT_API_BASE || 'https://api.split.io';

const API = {
    harness: {
        projects: (accountId, orgId) => `${HARNESS_API_BASE}/ng/api/projects?...`
    },
    split: {
        workspaces: () => `${SPLIT_API_BASE}/internal/api/v2/workspaces`,
        // ... other Split API endpoints
    },
    sdk: {
        urls: deriveSDKUrls(SPLIT_API_BASE)  // Automatically derives sdk.*, events.*, etc.
    }
};
```

**SDK URL Injection:**
- SDK URLs are automatically derived from `SPLIT_API_BASE` environment variable
- `api.split.io` → `sdk.split.io`, `events.split.io`, `auth.split.io`, `telemetry.split.io`
- HTML templates are injected with these URLs during generation
- CDN URLs for loading the SDK library remain unchanged
- Works with custom/on-premise Split.io deployments

## Output

After successful execution:

1. **HTML Files**: Generated in the project root directory
   - `enigma.html`
   - `erratum.html`
   - `form_follies.html`
   - `magic_boxes.html`
   - `modal_madness.html`

2. **ZIP Archive**: Created in `downloads/` directory
   - Filename: `splitworkshop-<orgIdentifier>.zip`
   - Contains: All HTML files, images, and README

3. **Email List**: Printed as comma-separated list
   - **Manual action required**: You must email the ZIP to recipients yourself
   - The workshop no longer sends emails automatically

## Error Handling

The tool provides clear error messages with context:

### 401 Authentication Errors
```
✗ Failed to get workspace
  Authentication failed (401)
  URL: https://api.split.io/internal/api/v2/workspaces
  → Check that 'apiKey' in config file is valid and has proper permissions
  → All API calls use 'x-api-key' header with apiKey value
```

### Missing Environment
```
❌ Operation failed: Environment not found. Run "node index.js setup" first to create the environment.
```

### General Best Practices
- Use `--verbose` flag when troubleshooting
- Ensure Split workspace "FME-Workshop" exists before running setup
- Run `setup` phase before `generate` phase if running separately
- Check that API key has proper permissions for both Harness and Split

## Security

**Protected Files (.gitignore):**
- `config` - Contains API keys and secrets
- `*.html` - Generated files
- `downloads/` - ZIP archives
- `node_modules/` - Dependencies

**Safe to Commit:**
- `config.sample` - Template without secrets
- `*.html.template` - HTML templates
- Source code changes

## Troubleshooting

### Browser shows old Split.io URLs

**Solution**: Clear browser cache or open in incognito mode
```bash
# Stop server and restart
node serve.js
# Open http://localhost:8000 in incognito mode
```

### "Module not found" error

**Solution**: Ensure you're in the project root directory
```bash
cd /path/to/fme-workshop
node index.js
```

### 404 errors when accessing Split API

**Solution**: Verify the Split workspace exists and API key is correct
```bash
node index.js setup --verbose
```

## Notes

- Your download ZIP is the only copy that exists when you create it
- Customer-facing README.html is currently empty (to be fixed)
- The tool creates a new Workshop project with standard feature flags

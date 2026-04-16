This README is not a walkthrough. These are instructions for creating a workshop for a customer.

Using node.js

Clone the fme-workshop repository, 

https://github.com/dbmartin00/fme-workshop

```
npm install
```

Edit the config file JSON

```json
{
  "emails": [
    "admin@example.com",
    "developer@example.com",
    "owner@example.com"
  ],
  "apiKey": "YOUR_API_KEY_HERE",
  "accountIdentifier": "<optional - Harness account ID>",
  "harnessOrgIdentifier": "<optional - Harness org ID>",
  "orgIdentifier": "<optional - Split org ID if different>"
}
```

**IMPORTANT: API Key Requirements**

- **`apiKey`** (Required): API key used for all API calls
  - **All requests use `x-api-key` header with this value**
  - Works for both Harness and Split.io APIs
  - If using Harness integration, requires these bindings:
    - FME Administrator
    - FME Manager
    - FME Account API (or Account Admin)

Run the generator

```bash
# Run both phases (setup + generate HTML)
node index.js

# Phase 1 only: Setup projects and initialize (no HTML generation)
node index.js setup

# Phase 2 only: Generate HTML files (requires Phase 1 to be done first)
node index.js generate

# Verbose mode (detailed logs, helpful for debugging)
node index.js --verbose
node index.js setup --verbose
node index.js generate -v
```

**Two Phases:**
1. **Setup Phase**: Creates/initializes Harness project, Split workspace, environments, segments, and feature flags
2. **Generate Phase**: Creates HTML files from templates with SDK configuration and packages them into a ZIP file

**Environment Variables** (optional):
```bash
SPLIT_API_BASE=https://api.barclays.split.io                    # Default Split API endpoint
HARNESS_API_BASE=https://fme-barclays-validation.harness.io     # Default Harness API endpoint
VERBOSE=true                                                     # Enable verbose logging
```

You create a new Workshop project with the usual suspects for flags.

A new ZIP is created in the downloads subdirectory and your email addresses are printed out as a comma-separated list.  You need to email your customers with the ZIP attachment yourself.  This is no longer done by Workshop.

Your download ZIP is the only copy that exists when you create it.


To be fixed...

Customer-facing README.html is currently empty



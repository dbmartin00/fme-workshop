// main.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const JSZip = require('jszip');

// ----------------------------
// Configuration
// ----------------------------
const args = process.argv.slice(2);
const VERBOSE = process.env.VERBOSE === 'true' || args.includes('--verbose') || args.includes('-v');

// Command parsing
const command = args.find(arg => !arg.startsWith('-')) || 'all';
const validCommands = ['all', 'setup', 'generate'];

if (!validCommands.includes(command)) {
    console.error(`Invalid command: ${command}`);
    console.error(`Valid commands: ${validCommands.join(', ')}`);
    process.exit(1);
}

// API Base URLs - can be overridden via environment variables
const HARNESS_API_BASE = process.env.HARNESS_API_BASE || 'https://app.harness.io';
const SPLIT_API_BASE = process.env.SPLIT_API_BASE || 'https://api.split.io';

// Derive SDK URLs from SPLIT_API_BASE
// Converts api.split.io -> sdk.split.io, events.split.io, etc.
function deriveSDKUrls(apiBase) {
    const url = new URL(apiBase);
    const baseDomain = url.hostname.replace(/^api\./, '');
    const protocol = url.protocol;

    return {
        sdk: `${protocol}//sdk.${baseDomain}/api`,
        events: `${protocol}//events.${baseDomain}/api`,
        auth: `${protocol}//auth.${baseDomain}/api`,
        telemetry: `${protocol}//telemetry.${baseDomain}/api`
    };
}

// Centralized API endpoints
// NOTE: All Split.io API calls require 'x-api-key' header with a valid Admin API key
const API = {
    harness: {
        projects: (accountId, orgId) =>
            `${HARNESS_API_BASE}/ng/api/projects?accountIdentifier=${accountId}&orgIdentifier=${orgId}`
    },
    split: {
        workspaces: () =>
            `${SPLIT_API_BASE}/internal/api/v2/workspaces`,
        trafficTypes: (workspaceId) =>
            `${SPLIT_API_BASE}/internal/api/v2/trafficTypes/ws/${workspaceId}`,
        environments: (workspaceId) =>
            `${SPLIT_API_BASE}/internal/api/v2/environments/ws/${workspaceId}`,
        apiKeys: () =>
            `${SPLIT_API_BASE}/internal/api/v2/apiKeys`,
        segments: (workspaceId, trafficTypeId) =>
            `${SPLIT_API_BASE}/internal/api/v2/segments/ws/${workspaceId}/trafficTypes/${trafficTypeId}`,
        segmentEnable: (envId, segmentName) =>
            `${SPLIT_API_BASE}/internal/api/v2/segments/${envId}/${segmentName}`,
        segmentKeys: (envId, segmentName) =>
            `${SPLIT_API_BASE}/internal/api/v2/segments/${envId}/${segmentName}/uploadKeys?replace=true`,
        splits: (workspaceId) =>
            `${SPLIT_API_BASE}/internal/api/v2/splits/ws/${workspaceId}/trafficTypes/user`,
        splitEnvironment: (workspaceId, splitName, envId) =>
            `${SPLIT_API_BASE}/internal/api/v2/splits/ws/${workspaceId}/${splitName}/environments/${envId}`
    },
    sdk: {
        urls: deriveSDKUrls(SPLIT_API_BASE)
    }
};

// ----------------------------
// Logging Helpers
// ----------------------------
function logStep(message) {
    console.log(`✓ ${message}`);
}

function logVerbose(message) {
    if (VERBOSE) {
        console.log(`  ${message}`);
    }
}

function logError(message, error) {
    console.error(`✗ ${message}`);
    if (error) {
        if (error.response) {
            const status = error.response.status;
            const url = error.config?.url;

            if (status === 401) {
                console.error(`  Authentication failed (401)`);
                console.error(`  URL: ${url}`);
                console.error(`  → Check that 'apiKey' in config file is valid and has proper permissions`);
                console.error(`  → All API calls use 'x-api-key' header with apiKey value`);
            } else {
                console.error(`  Status: ${status}`);
                if (VERBOSE) {
                    console.error(`  URL: ${url}`);
                    console.error(`  Details: ${error.message}`);
                }
            }
        } else if (VERBOSE) {
            console.error(`  Details: ${error.message || error}`);
        }
    }
}

// ----------------------------
// Load Parameters (from JSON in a file WITHOUT .json extension)
// ----------------------------
logStep("Loading configuration parameters");

const paramFile = fs.readdirSync(process.cwd())
    .find(f => f.startsWith("config") && !f.endsWith('.json') && fs.readFileSync(f, 'utf8').trim().startsWith('{'));

if (!paramFile) {
    logError("Configuration file not found (expected file starting with 'config' without .json extension)");
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(paramFile, 'utf8'));
} catch (error) {
    logError("Invalid JSON in config file", error);
    process.exit(1);
}

const { emails, apiKey, accountIdentifier, harnessOrgIdentifier, orgIdentifier, clientSideApiKey: configClientKey } = config;

// Validate required fields
if (!emails || !Array.isArray(emails) || emails.length === 0) {
    logError("Config missing required field: emails (array)");
    process.exit(1);
}

if (!apiKey) {
    logError("Config missing required field: apiKey");
    console.error("  All API calls require 'x-api-key' header with apiKey value");
    process.exit(1);
}

// Harness fields are optional - only needed if using Harness project creation
const useHarness = accountIdentifier && harnessOrgIdentifier;

logVerbose(useHarness
    ? `Using Harness (account: ${accountIdentifier}, org: ${harnessOrgIdentifier}) + Split, ${emails.length} recipients`
    : `Split-only mode, ${emails.length} recipients`);

// ----------------------------
// Load Feature Flag Definitions (.json files)
// ----------------------------
logStep("Loading feature flag definitions");

const jsonFiles = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.json'));
let splitNames = [];

for (const jsonFile of jsonFiles) {
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const featureFlagName = data.name || path.basename(jsonFile, '.json');

    if(featureFlagName !== "fme-workshop") {
      splitNames.push(featureFlagName);
      logVerbose(`Loaded: ${featureFlagName}`);
    }
}

logVerbose(`${splitNames.length} feature flags ready`);

const instance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
})

// ----------------------------
// Step Functions
// ----------------------------
const projectName = 'FME-Workshop';
let projectIdentifier;  // This will map to Split workspace ID

async function createProject() {
    if (!useHarness) {
        logVerbose("Skipping Harness project creation (no Harness credentials)");
        return;
    }

    logStep("Creating Harness project");

    const body = {
        "project": {
            "orgIdentifier": harnessOrgIdentifier,
            "identifier": "FMEWorkshop",
            "name": projectName,
            "color": "skyblue",
            "description": "FME Workshop",
            "tags": {}
        }
    };

    try {
        const response = await instance.post(
            API.harness.projects(accountIdentifier, harnessOrgIdentifier),
            body,
            { headers: { 'x-api-key': apiKey } }
        );
        projectIdentifier = response?.data?.data?.project?.identifier;
        logVerbose(`Harness project created: ${projectIdentifier}`);
    } catch (error) {
        if (error?.response?.data?.code === 'DUPLICATE_FIELD') {
            logVerbose('Harness project already exists, reusing');
            projectIdentifier = "FMEWorkshop";
        } else {
            logError('Failed to create Harness project', error);
            throw error;
        }
    }
}

// async function getProjects() {
//     logStep("getProjects called");

//     const getUrl = 'https://app.harness.io/ng/api/projects?accountIdentifier=' 
//     + accountIdentifier + '&orgIdentifier=' + orgIdentifier;

//   await axios.get(getUrl, { headers: {'x-api-key': apiKey}})
//     .then(function(response) {
//       console.log('response.data', response.data);

//       console.log('totalItems', response.data.data.totalItems);

//       const projects = response.data.data.content;
//       for(const project of projects) {
//         console.log('project', project);
//       }
//     })
//     .catch(function(error) {
//         console.log(error);
//     })
// }

async function getWorkspaces() {
    logStep("Getting Split workspace ID");

    try {
        const response = await axios.get(API.split.workspaces(), { headers: {'x-api-key': apiKey}});

        // If we have a Harness projectIdentifier, try to find matching workspace
        // Otherwise look for FME-Workshop by name
        const searchName = "FME-Workshop";

        for(const ws of response.data.objects) {
            if(ws.name === searchName) {
                projectIdentifier = ws.id;
                logVerbose(`Split workspace found: ${ws.name} (ID: ${projectIdentifier})`);
                return;
            }
        }

        // If not found, throw error with helpful message
        const availableWorkspaces = response.data.objects.map(ws => ws.name).join(', ');
        throw new Error(
            `Split workspace '${searchName}' not found. ` +
            `Available workspaces: ${availableWorkspaces || 'none'}. ` +
            `Please create the workspace first or update the search name.`
        );
    } catch (error) {
        logError('Failed to get Split workspace', error);
        throw error;
    }
}

async function getTrafficTypeId() {
    logStep("Getting traffic type ID");

    try {
        const response = await axios.get(API.split.trafficTypes(projectIdentifier), { headers: {'x-api-key': apiKey}});
        for(const trafficType of response.data) {
            if(trafficType.name === 'user') {
                trafficTypeId = trafficType.id;
                logVerbose(`Traffic type ID: ${trafficTypeId}`);
                return;
            }
        }
        throw new Error('User traffic type not found');
    } catch (error) {
        logError('Failed to get traffic type ID', error);
        throw error;
    }
}

const ENVIRONMENT_NAME = 'stage';

async function createEnvironment() {
    logStep(`Creating environment: ${ENVIRONMENT_NAME}`);

    const body = {
        name: ENVIRONMENT_NAME,
        production: false
    };

    try {
        const response = await axios.post(API.split.environments(projectIdentifier), body, { headers: {'x-api-key': apiKey}});
        environmentId = response.data.id;
        logVerbose(`Environment ID: ${environmentId}`);
    } catch (error) {
        if(error?.response?.status === 409) {
            logVerbose('Environment already exists, retrieving');
            await findEnvironment();
        } else {
            logError('Failed to create environment', error);
            throw error;
        }
    }
}

async function findEnvironment() {
    try {
        const response = await axios.get(API.split.environments(projectIdentifier), { headers: { 'x-api-key': apiKey } });
        for(const env of response.data) {
            if(env.name === ENVIRONMENT_NAME) {
                environmentId = env.id;
                logVerbose(`Found environment ID: ${environmentId}`);
                return;
            }
        }
        throw new Error(`Environment '${ENVIRONMENT_NAME}' not found`);
    } catch (error) {
        logError('Failed to find environment', error);
        throw error;
    }
}

async function createClientApiKey() {
    logStep("Creating client API key");

    try {
        const response = await axios.post(
            API.split.apiKeys(),
            {
                name: 'workshop-' + new Date().getTime(),
                apiKeyType: 'client_side',
                environments: [{ id: environmentId, type: 'ENVIRONMENT' }],
                workspace: { id: projectIdentifier, type: 'WORKSPACE' }
            },
            { headers: { 'x-api-key': apiKey } }
        );

        clientSideApiKey = response.data.key;
        logVerbose(`API key created: ${clientSideApiKey.substring(0, 20)}...`);
    } catch (error) {
        const errorMsg = error?.response?.data?.message || error.message;
        logError('Failed to create client API key', errorMsg);
        throw error;
    }
}

async function createSegments() {
    logStep("Creating segments");
    await sleep(1000);

    const defsRaw = fs.readFileSync('segments');
    const defsJson = JSON.parse(defsRaw);

    for(const segment of defsJson) {
        const data = {
            name: segment.name,
            description: segment.description
            // Omit owners - they are now optional and will be auto-assigned by the system
        };

        // Create segment
        try {
            await axios.post(
                API.split.segments(projectIdentifier, trafficTypeId),
                data,
                { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey } }
            );
            logVerbose(`Created segment: ${data.name}`);
        } catch (error) {
            if(error?.response?.status === 409) {
                logVerbose(`Segment exists: ${data.name}`);
            } else {
                logError(`Failed to create segment: ${data.name}`, error);
                continue;
            }
        }

        // Enable segment
        try {
            await axios.post(
                API.split.segmentEnable(environmentId, data.name),
                {},
                { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey } }
            );
            logVerbose(`Enabled segment: ${data.name}`);
        } catch (error) {
            if(error?.response?.status !== 409) {
                logError(`Failed to enable segment: ${data.name}`, error);
            }
        }

        // Update segment keys
        try {
            await axios.put(
                API.split.segmentKeys(environmentId, data.name),
                { keys: segment.keys, comment: segment.description },
                { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey } }
            );
            logVerbose(`Updated keys for: ${data.name}`);
        } catch (error) {
            logError(`Failed to update keys for: ${data.name}`, error);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function createSplitWithRetry(config, splitName, retryOn429 = true) {
    try {
        await axios(config);
        logVerbose(`Created: ${splitName}`);
    } catch (error) {
        const status = error?.response?.status;

        if (status === 409) {
            logVerbose(`Already exists: ${splitName}`);
        } else if (status === 429 && retryOn429) {
            logVerbose('Rate limited, retrying...');
            await sleep(2000);
            return createSplitWithRetry(config, splitName, false);
        } else {
            logError(`Failed to create split: ${splitName}`, error);
            throw error;
        }
    }
}

async function createSplits() {
    logStep(`Creating ${splitNames.length} feature flags`);

    for(const splitName of splitNames) {
        // Create split definition
        const config = {
            method: 'post',
            url: API.split.splits(projectIdentifier),
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            data: {
                name: splitName,
                description: 'created for Split Workshop'
                // Omit owners - they are now optional and will be auto-assigned by the system
            }
        };

        await createSplitWithRetry(config, splitName, true);

        // Configure split in environment
        config.url = API.split.splitEnvironment(projectIdentifier, splitName, environmentId);
        let modalBody = fs.readFileSync(splitName + '.json', 'utf8').toString();
        modalBody = modalBody.replace(/(\r\n|\n|\r)/gm, '');
        config.data = JSON.parse(modalBody);

        await createSplitWithRetry(config, splitName, true);
    }
}

// Leave these commented out as requested:
// function createEventTypeIds() {}
// function createMetrics() {}


// ----------------------------
// Run Steps
// ----------------------------
async function setupPhase() {
    console.log('\n📋 Phase 1: Project Setup & Initialization\n');

    // Step 1: Create Harness project (optional - only if credentials provided)
    await createProject();

    // Step 2: Get Split workspace ID (this maps to Harness project ID conceptually)
    // The workspace must already exist in Split
    await getWorkspaces();

    if (!projectIdentifier) {
        throw new Error('No Split workspace ID found. Please ensure the workspace exists in Split.');
    }

    // Step 3-7: Continue with Split configuration
    await getTrafficTypeId();
    await createEnvironment();
    await createClientApiKey();
    await createSegments();
    await createSplits();

    console.log('\n✅ Phase 1 complete: Projects initialized\n');
}

async function generatePhase() {
    console.log('\n🎨 Phase 2: Generate HTML Files\n');

    // Need to get workspace, environment, and client key if not already loaded
    if (!projectIdentifier) {
        await getWorkspaces();
    }
    if (!trafficTypeId) {
        await getTrafficTypeId();
    }
    if (!environmentId) {
        // Try to find existing environment first
        await findEnvironment();
        if (!environmentId) {
            throw new Error('Environment not found. Run "node index.js setup" first to create the environment.');
        }
    }

    // Use client key from config if provided, otherwise it should have been created in setup phase
    if (!clientSideApiKey && configClientKey) {
        clientSideApiKey = configClientKey;
        logVerbose(`Using clientSideApiKey from config: ${clientSideApiKey.substring(0, 20)}...`);
    }

    if (!clientSideApiKey) {
        throw new Error('Client API key not found. Either run "node index.js setup" first or add "clientSideApiKey" to your config file.');
    }

    await swapKeyInTemplates();
    await createZip();
    await sendEmails();

    console.log('\n✅ Phase 2 complete: HTML files generated\n');
}

async function main() {
    console.log('\n🚀 FME Workshop Setup');
    if (VERBOSE) {
        console.log('   (verbose mode enabled)');
    } else {
        console.log('   (use --verbose or -v for detailed logs)');
    }
    console.log(`   Command: ${command}\n`);

    try {
        switch (command) {
            case 'setup':
                await setupPhase();
                break;
            case 'generate':
                await generatePhase();
                break;
            case 'all':
            default:
                await setupPhase();
                await generatePhase();
                break;
        }

        console.log('✅ All operations complete!\n');
    } catch (err) {
        console.error('\n❌ Operation failed:', err.message);
        if (VERBOSE) {
            console.error('\nFull error:', err);
        }
        process.exit(1);
    }
}
main();


async function swapKeyInTemplates() {
    logStep("Generating HTML files from templates");

    const urlsConfig = `urls: {
        sdk: '${API.sdk.urls.sdk}',
        events: '${API.sdk.urls.events}',
        auth: '${API.sdk.urls.auth}',
        telemetry: '${API.sdk.urls.telemetry}'
      }`;

    let processedCount = 0;
    for (const splitName of splitNames) {
        const templateFile = `${splitName}.html.template`;

        if (!fs.existsSync(templateFile)) {
            logVerbose(`Template not found: ${templateFile}`);
            continue;
        }

        let template = fs.readFileSync(templateFile).toString();

        // Replace API key placeholders
        template = template.replace(/\$\$SPLIT_CLIENT_API_KEY\$\$/g, clientSideApiKey);

        // Strategy: Find the core: { } block and inject urls right after it
        // This works for all SDK initialization patterns

        // Match: core: { ... } and capture what comes after
        const coreBlockPattern = /(core:\s*\{(?:[^{}]|\{[^}]*\})*\})(\s*,?\s*)/g;

        let matched = false;
        template = template.replace(coreBlockPattern, (match, coreBlock, afterCore) => {
            // Check if urls already exists (don't inject twice)
            const remainingText = template.substring(template.indexOf(match) + match.length);
            if (remainingText.substring(0, 200).includes('urls:')) {
                return match;
            }

            matched = true;
            // Inject urls after core block
            return `${coreBlock},\n      ${urlsConfig}${afterCore}`;
        });

        if (matched) {
            logVerbose(`Injected custom URLs: ${splitName}`);
        } else {
            logVerbose(`No core block found (or already has URLs): ${splitName}`);
        }

        fs.writeFileSync(`${splitName}.html`, template);
        processedCount++;
    }

    logVerbose(`Generated ${processedCount} HTML files with Barclays SDK configuration`);
}

let filesToArchive = [];
async function createZip() {
    logStep("Creating workshop archive");
    const directory = 'downloads';
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    const outputFilePath = `downloads/splitworkshop-${orgIdentifier}.zip`;

    // Collect files
    for(const splitName of splitNames) {
        if(splitName !== 'erratum' && !filesToArchive.includes(splitName + '.html')) {
            filesToArchive.push(splitName + '.html');
        }
    }
    filesToArchive.push('README');

    try {
        const files = fs.readdirSync('images');
        const reserved = ['apple.jpg', 'meditation.jpg', 'runner.jpg'];
        files.forEach((file) => {
            if(!reserved.includes(file) && !filesToArchive.includes('images/' + file)) {
                filesToArchive.push('images/' + file);
            }
        });
    } catch (err) {
        logError('Failed to read images directory', err);
    }

    logVerbose(`Archiving ${filesToArchive.length} files`);

    const zip = new JSZip();
    const htmlFolder = zip.folder("html");

    for (const htmlFile of filesToArchive) {
        try {
            const htmlData = fs.readFileSync(htmlFile);
            htmlFolder.file(htmlFile, htmlData);
        } catch (err) {
            logError(`Failed to add file to archive: ${htmlFile}`, err);
        }
    }

    const zipContent = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    });

    fs.writeFileSync(outputFilePath, zipContent);
    logVerbose(`Archive created: ${outputFilePath}`);
}

async function sendEmails() {
    logStep("Preparing email distribution");
    const emailList = emails.join(", ");
    console.log(`\nRecipients (${emails.length}): ${emailList}`);
}

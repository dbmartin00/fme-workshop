// main.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const JSZip = require('jszip');

// ----------------------------
// Logging Helper
// ----------------------------
function logStep(message) {
    console.log(`[STEP] ${message}`);
}

// ----------------------------
// Load Parameters (from JSON in a file WITHOUT .json extension)
// ----------------------------
logStep("Loading parameters...");

const paramFile = fs.readdirSync(process.cwd())
    .find(f => f.startsWith("config") && !f.endsWith('.json') && fs.readFileSync(f, 'utf8').trim().startsWith('{'));

if (!paramFile) {
    console.error("No parameter file (JSON content without .json extension) found.");
    process.exit(1);
}

logStep(`Found parameter file: ${paramFile}`);
const { emails, apiKey, accountIdentifier, orgIdentifier } = JSON.parse(fs.readFileSync(paramFile, 'utf8'));
console.log('accountIdentifier', accountIdentifier);
console.log('orgIdentifier', orgIdentifier);

logStep(`Loaded ${emails.length} email(s) and an API key.`);

// ----------------------------
// Load Feature Flag Definitions (.json files)
// ----------------------------
logStep("Scanning working directory for .json feature flag files...");

const jsonFiles = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.json'));

logStep(`Found ${jsonFiles.length} .json files.`);

let splitNames = [];

for (const jsonFile of jsonFiles) {
    logStep(`Reading: ${jsonFile}`);
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

    // Assume each file defines a feature flag with a name property
    const featureFlagName = data.name || path.basename(jsonFile, '.json');
    splitNames.push(featureFlagName);

    logStep(`Extracted feature flag: ${featureFlagName}`);
}

logStep(`Total feature flags loaded: ${splitNames.length}`);

const instance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
})

// ----------------------------
// Step Functions 
// ----------------------------
const projectName = 'FME-Workshop';
let projectIdentifier;

async function createProject() {
    logStep("createProject() called");
  //console.log('apiKey', apiKey);
  const url = "https://app.harness.io/ng/api/projects?accountIdentifier=" 
    + accountIdentifier 
    + "&orgIdentifier=" + orgIdentifier;

  const headers = {
    'x-api-key': apiKey
  }

  const body = {
      "project": {
          "orgIdentifier": orgIdentifier, 
          "identifier": "FMEWorkshop",
          "name": projectName,
          "color": "skyblue",
          "description": "FME Workshop",
          "tags": {}
      }
  }

    await instance.post(url, body, { headers })
      .then((response) => {
        projectIdentifier = response?.data?.data?.project?.identifier;
        console.log('success! projectIdentifier: ' + projectIdentifier)
      })
      .catch((error) => {
        if(error.response.data.code === 'DUPLICATE_FIELD') {
            console.log('project already created');
        } else {
            console.error('Error creating project:', err);
        }
      });
    // If there's a 409 duplicate field error... 
    if(!projectIdentifier) {
        projectIdentifier = "FMEWorkshop";
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

// shouldn't be necessary!
async function getWorkspaces() {
    logStep("getWorkspaces called");

  const getUrl = 'https://api.split.io/internal/api/v2/workspaces';

  await axios.get(getUrl, { headers: {'x-api-key': apiKey}})
    .then(function(response) {
      // console.log('response.data', response.data);
      for(const ws of response.data.objects) {
        if(ws.name === "FME-Workshop") {
            projectIdentifier = ws.id;
        }
      }
    })
    .catch(function(error) {
        console.log(error);
    })

    console.log('projectIdentifier', projectIdentifier);
}

async function getTrafficTypeId() {
    logStep("getTrafficTypeId() called");    

  const getUrl = 'https://api.split.io/internal/api/v2/trafficTypes/ws/' + projectIdentifier;  
  
  await axios.get(getUrl, { headers: {'x-api-key': apiKey}})
    .then(function(response) {
      for(const trafficType of response.data) {
        if(trafficType.name === 'user') {
          trafficTypeId = trafficType.id;
          console.log('user trafficTypeId: ' + trafficTypeId);
        }
      }
    })
    .catch(function(error) {
        console.log(error);
    })
}

const ENVIRONMENT_NAME = 'stage';

async function createEnvironment() {
      logStep("createEnvironment() called for " + ENVIRONMENT_NAME);
  const createUrl = 'https://api.split.io/internal/api/v2/environments/ws/' + projectIdentifier;
  
  const body = {
    name: ENVIRONMENT_NAME,
    production: false
  }

  await axios.post(createUrl, body, { headers: {'x-api-key': apiKey}})
    .then(function(response) {
      console.log('created environment ' + ENVIRONMENT_NAME);
      environmentId = response.data.id;
    })
    .catch(async function (error) {
        if(error.response.status == 409) {
            console.log('environment already created');
            await findEnvironment(); 
        } else {
          console.log('error creating environment: ' + error);
        }
    })
    .finally(() => {
        console.log('createEnvironment environmentId: ' + environmentId);
    });
}

async function findEnvironment() {
    logStep("findEnvironment " + ENVIRONMENT_NAME + " for " + projectIdentifier);

    const url = 'https://api.split.io/internal/api/v2/environments/ws/' + projectIdentifier;

    const config = {
        method: 'get',
        url: url,
        headers: {
          'x-api-key': apiKey,
        },
    };

    await axios(config)
    .then(function (response) {
        for(const env of response.data) {
            if(env.name === ENVIRONMENT_NAME) {
                environmentId = env.id;
                break;
            }
        }
    })
    .catch(function(error) {
      console.log(error);
    })
    .finally(() => {
      console.log('environmentId: ' + environmentId);
    });
}

async function createClientApiKey() {
  
    logStep("createClientApiKey() called");

  const baseUrl = 'https://api.split.io/internal/api/v2/apiKeys';

  const environments = [ 
    {
        id: environmentId,
        type: 'ENVIRONMENT'
    }
  ];

  const workspace = {
    id: projectIdentifier,
    type: 'WORKSPACE'
  };

  try {
    const response = await axios.post(
      baseUrl,
      {
        name: 'workshop-' + new Date().getTime(),
        apiKeyType: 'client_side',
        environments: environments,
        workspace: workspace
      },
      {
        headers: {
          'x-api-key': apiKey
        },
      }
    );

    clientSideApiKey = response.data.key;
    console.log('clientSideApiKey', clientSideApiKey);
  } catch (error) {
    console.error(`Error creating client-side API key: ${error.message}`);
    console.log('msg: ' + error?.response?.data?.message || error.message || 'Unknown error creating client-side key');
    console.log(error);
  }
};

async function createSegments() {
    logStep("createSegments called");

    const defsRaw = fs.readFileSync('segments');
    const defsJson = JSON.parse(defsRaw);

    for(const segment of defsJson) {

        const url = 'https://api.split.io/internal/api/v2/segments/ws/'
            + projectIdentifier + '/trafficTypes/' + trafficTypeId;

        const data = {
            name: segment.name,
            description: segment.description
        }

        const config = {
            method: 'post',
            url: url,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            data: data
        };  

        await axios(config)
        .then(function (response) {
        console.log('created segment: ' + data.name);
        })
        .catch(function(error) {
            if(error.response.status == 409) {
                console.log('already created segment ' + data.name);
            } else {
                console.log(error);
            }
        });

        const enableUrl = 'https://api.split.io/internal/api/v2/segments/' + environmentId 
        + '/' + data.name;

        const enableConfig = {
            method: 'post',
            url: enableUrl,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            data: {}        
        }

        await axios(enableConfig)
        .then(function (response) {
        console.log('segment enabled in environment: ' + data.name);
        })
        .catch(function(error) {
            if(error.response.status == 409) {
                console.log('already enabled segment ' + data.name);
            } else {
                console.log(error);
            }
        });

        const updateUrl = 'https://api.split.io/internal/api/v2/segments/' + environmentId 
        + '/' + data.name + '/uploadKeys?replace=true';

        const updateData = {
            keys: segment.keys,
            comment: segment.description
        }

        const updateConfig = {
            method: 'put',
            url: updateUrl,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            data: updateData
        }

        await axios(updateConfig)
        .then(function (response) {
        console.log('keys updated to segment: ' + data.name);
        })
        .catch(function(error) {
            console.log(error);
        });
    }
}
async function createSplits() {
    logStep("createSplits() called");

    for(const splitName of splitNames) {

        const config = {
            method: 'post',
            url: 'https://api.split.io/internal/api/v2/splits/ws/' + projectIdentifier 
                + '/trafficTypes/user',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            data: {
                name: splitName,
                description: 'created for Split Workshop'
            }
        };

        await axios(config)
        .then(function (response) {
          console.log('created split ' + splitName);
        })
        .catch(function(error) {
            if(error.response.status && error.response.status == 409) {
                console.log('split already created - ' + splitName);
            } else {
              console.log(error);
            }
        });

        config.method = 'post';
        config.url = 'https://api.split.io/internal/api/v2/splits/ws/' + projectIdentifier 
            + '/' + splitName + '/environments/' + environmentId;

        // script split generation
        let modalBody = fs.readFileSync(splitName + '.json', 'utf8').toString();
        modalBody = modalBody.replace(/(\r\n|\n|\r)/gm, '');
        config.data = JSON.parse(modalBody);

        await axios(config)
        .then(function (response) {
          console.log('updated split ' + splitName + '!');
        })
        .catch(function(error) {
            if(error.response.status == 409) {
                console.log('split already has a definition');
            } else {
              console.log(error);
            }
        });

    }

}

// Leave these commented out as requested:
// function createEventTypeIds() {}
// function createMetrics() {}


// ----------------------------
// Run Steps
// ----------------------------
logStep("Running steps...");

async function main() {
    await createProject();
    await getWorkspaces();
    // await getProjects();
    await getTrafficTypeId();
    await createEnvironment();
    await createClientApiKey();
    await createSegments();
    await createSplits();
    await swapKeyInTemplates();
    await createZip();
    await sendEmails();
}
main().catch(err => console.error(err));


async function swapKeyInTemplates() {
    logStep("Replacing template HTML files using split names...");

    for (const splitName of splitNames) {
        const templateFile = `${splitName}.html.template`;

        if (!fs.existsSync(templateFile)) {
            logStep(`Template missing: ${templateFile} (skipping)`);
            continue;
        }

        logStep(`Processing template for: ${splitName}`);

        const original = fs.readFileSync(templateFile).toString();
        const modified = original.replace('$$SPLIT_CLIENT_API_KEY$$', clientSideApiKey);

        fs.writeFileSync(`${splitName}.html`, modified);
        logStep(`Generated: ${splitName}.html`);
    }
}

let filesToArchive = [];
async function createZip() {
    logStep("createZip!");
    const directory = 'downloads';
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory);
      console.log(directory + ' directory created!');
    } else {
      console.log(directory + ' directory already exists.');
    }   
    const outputFilePath = 'downloads/splitworkshop-' + orgIdentifier + '.zip';

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
      console.error('Error reading the images directory:', err);
    }   

    console.log('filesToArchive', filesToArchive);

    const zip = new JSZip();
  const htmlFiles = filesToArchive;
  const htmlFolder = zip.folder("html");

  for (const htmlFile of htmlFiles) {
      const htmlData = fs.readFileSync(htmlFile);
      htmlFolder.file(htmlFile, htmlData);
  }

    downloadUrl = 'https://www.split.io/';
    const zipContent = await zip.generateAsync({ 
            type: 'nodebuffer', 
            compression: 'DEFLATE', 
            compressionOptions: { level: 9 } 
        });

    fs.writeFileSync(outputFilePath, zipContent, (err, data) => {
      if (err) {
        console.error('error writing zip file:', err);
      } else {
        console.log('zip written', outputFilePath);
      }         
    });

}

async function sendEmails() {
    logStep("sendEmails");

    const emailList = emails.join(",");

    console.log("Send the ZIP to this list...");

    console.log(emailList);
}

logStep("Script completed.");

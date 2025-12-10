const fs = require('fs');
const path = require('path');
require('dotenv').config();

const manifestPath = path.join(__dirname, '..', 'snap.manifest.json');
const environment = process.env.ENVIRONMENT || 'local';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (environment === 'local' || environment === 'test') {
  manifest.initialConnections['http://localhost:3000'] = {};
  if (manifest.initialPermissions?.['endowment:keyring']?.allowedOrigins) {
    if (!manifest.initialPermissions['endowment:keyring'].allowedOrigins.includes('http://localhost:3000')) {
      manifest.initialPermissions['endowment:keyring'].allowedOrigins.push('http://localhost:3000');
    }
  }

  // Add endowment:rpc permission for local/dev mode
  manifest.initialPermissions['endowment:rpc'] = {
    dapps: true,
    snaps: false
  };

  console.log('Added localhost entries and endowment:rpc to snap.manifest.json for local development');
} else {
  // Production mode - remove endowment:rpc if it exists
  if (manifest.initialPermissions?.['endowment:rpc']) {
    delete manifest.initialPermissions['endowment:rpc'];
    console.log('Removed endowment:rpc from snap.manifest.json for production');
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');


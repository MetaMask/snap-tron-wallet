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
  console.log('Added localhost entries to snap.manifest.json for local development');
}
// No else branch - production mode doesn't modify anything

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');


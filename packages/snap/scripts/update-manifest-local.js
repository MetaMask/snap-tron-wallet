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

  // Ensure endowment:rpc permission is present.
  manifest.initialPermissions['endowment:rpc'] = {
    dapps: true,
    snaps: true
  };

  console.log(
    'Added localhost entries and ensured endowment:rpc in snap.manifest.json for local development',
  );
} else {
  // Production mode - remove local-only settings
  let changed = false;

  // Remove localhost from initialConnections
  if (manifest.initialConnections?.['http://localhost:3000']) {
    delete manifest.initialConnections['http://localhost:3000'];
    changed = true;
  }

  // Remove localhost from keyring allowedOrigins
  if (manifest.initialPermissions?.['endowment:keyring']?.allowedOrigins) {
    const origins = manifest.initialPermissions['endowment:keyring'].allowedOrigins;
    const index = origins.indexOf('http://localhost:3000');
    if (index > -1) {
      origins.splice(index, 1);
      changed = true;
    }
  }

  // Ensure production keeps RPC permission for onRpcRequest.
  if (!manifest.initialPermissions?.['endowment:rpc']) {
    manifest.initialPermissions['endowment:rpc'] = {
      dapps: true,
      snaps: true,
    };
    changed = true;
  } else {
    manifest.initialPermissions['endowment:rpc'] = {
      dapps: true,
      snaps: true,
    };
    changed = true;
  }

  if (changed) {
    console.log('Removed local-only settings from snap.manifest.json for production');
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');


const fs = require('fs');
const path = require('path');

const newUrl = process.argv[2];

if (!newUrl) {
    console.error('Please provide the new ngrok URL. Example: node update-tunnel-url.js https://abcd-123.ngrok-free.dev');
    process.exit(1);
}

// Remove trailing slash if present
const baseUrl = newUrl.replace(/\/$/, '');
const apiUrl = `${baseUrl}/api`;

const paths = {
    mobile: path.join(__dirname, 'mobile_app', 'lib', 'core', 'constants.dart'),
    webEnv: path.join(__dirname, 'web-dashboard', '.env'),
    backendEnv: path.join(__dirname, 'backend', '.env')
};

// 1. Update Mobile App Constants
if (fs.existsSync(paths.mobile)) {
    let content = fs.readFileSync(paths.mobile, 'utf8');
    content = content.replace(/static const String apiBaseUrl = '.*';/, `static const String apiBaseUrl = '${apiUrl}';`);
    fs.writeFileSync(paths.mobile, content);
    console.log('✅ Updated mobile_app/lib/core/constants.dart');
}

// 2. Update Web Dashboard .env
if (fs.existsSync(paths.webEnv)) {
    let content = fs.readFileSync(paths.webEnv, 'utf8');
    content = content.replace(/VITE_API_URL=.*/, `VITE_API_URL=${apiUrl}`);
    content = content.replace(/VITE_SOCKET_URL=.*/, `VITE_SOCKET_URL=${baseUrl}`);
    fs.writeFileSync(paths.webEnv, content);
    console.log('✅ Updated web-dashboard/.env');
}

// 3. Update Backend .env (CORS)
if (fs.existsSync(paths.backendEnv)) {
    let content = fs.readFileSync(paths.backendEnv, 'utf8');
    // We add the ngrok URL to CORS just in case, but keep localhost
    if (!content.includes(baseUrl)) {
        content = content.replace(/CORS_ORIGIN=(.*)/, `CORS_ORIGIN=$1,${baseUrl}`);
        fs.writeFileSync(paths.backendEnv, content);
        console.log('✅ Updated backend/.env (CORS_ORIGIN)');
    }
}

console.log('\nAll done! Now you can run your projects on the new device.');

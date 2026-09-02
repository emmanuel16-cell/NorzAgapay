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
    barangayApi: path.join(__dirname, 'barangay_app', 'lib', 'services', 'api_service.dart'),
    barangayAuth: path.join(__dirname, 'barangay_app', 'lib', 'services', 'auth_service.dart'),
    barangaySocket: path.join(__dirname, 'barangay_app', 'lib', 'services', 'socket_service.dart'),
    resident: path.join(__dirname, 'resident_app', 'lib', 'core', 'constants.dart'),
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

// 2. Update Barangay App
if (fs.existsSync(paths.barangayApi)) {
    let content = fs.readFileSync(paths.barangayApi, 'utf8');
    content = content.replace(/static const String baseUrl = '.*';/, `static const String baseUrl = '${apiUrl}';`);
    fs.writeFileSync(paths.barangayApi, content);
    console.log('✅ Updated barangay_app/lib/services/api_service.dart');
}
if (fs.existsSync(paths.barangayAuth)) {
    let content = fs.readFileSync(paths.barangayAuth, 'utf8');
    content = content.replace(/static const String _apiBaseUrl = '.*';/, `static const String _apiBaseUrl = '${apiUrl}';`);
    fs.writeFileSync(paths.barangayAuth, content);
    console.log('✅ Updated barangay_app/lib/services/auth_service.dart');
}
if (fs.existsSync(paths.barangaySocket)) {
    let content = fs.readFileSync(paths.barangaySocket, 'utf8');
    content = content.replace(/static const String _socketUrl = '.*';/, `static const String _socketUrl = '${baseUrl}';`);
    fs.writeFileSync(paths.barangaySocket, content);
    console.log('✅ Updated barangay_app/lib/services/socket_service.dart');
}

// 3. Update Resident App Constants
if (fs.existsSync(paths.resident)) {
    let content = fs.readFileSync(paths.resident, 'utf8');
    content = content.replace(/static const String apiBaseUrl = '.*';/, `static const String apiBaseUrl = '${apiUrl}';`);
    content = content.replace(/static const String socketUrl = '.*';/, `static const String socketUrl = '${baseUrl}';`);
    fs.writeFileSync(paths.resident, content);
    console.log('✅ Updated resident_app/lib/core/constants.dart');
}

// 4. Update Web Dashboard .env
if (fs.existsSync(paths.webEnv)) {
    let content = fs.readFileSync(paths.webEnv, 'utf8');
    content = content.replace(/VITE_API_URL=.*/, `VITE_API_URL=${apiUrl}`);
    content = content.replace(/VITE_SOCKET_URL=.*/, `VITE_SOCKET_URL=${baseUrl}`);
    fs.writeFileSync(paths.webEnv, content);
    console.log('✅ Updated web-dashboard/.env');
}

// 5. Update Backend .env (CORS)
if (fs.existsSync(paths.backendEnv)) {
    let content = fs.readFileSync(paths.backendEnv, 'utf8');
    if (!content.includes(baseUrl)) {
        content = content.replace(/CORS_ORIGIN=(.*)/, `CORS_ORIGIN=$1,${baseUrl}`);
        fs.writeFileSync(paths.backendEnv, content);
        console.log('✅ Updated backend/.env (CORS_ORIGIN)');
    }
}

console.log('\nAll done! Now you can run your projects on the new device.');

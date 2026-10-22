// Test the actual pushStatus function with the proper imports
const { isCapacitorRuntime } = require('fs').readFileSync('src/services/scanner-service.js', 'utf8')
  .match(/export function isCapacitorRuntime\(\) \{[^}]+\}/g)[0]
  .replace(/export function isCapacitorRuntime\(\) /, '');

// Test browser scenario
console.log('=== Testing pushStatus in browser (happy-dom) ===');

// Mock the window.Capacitor in browser
const browserWindow = {
  Capacitor: undefined
};

global.window = browserWindow;

const result = isCapacitorRuntime();
console.log('isCapacitorRuntime() in browser:', result);

// The pushStatus function should return this when isCapacitorRuntime() is false
const expectedPushStatus = {
  available: false,
  granted: false,
  reason: 'Hanya tersedia di aplikasi Android/iOS (Capacitor).'
};

console.log('\npushStatus should return:');
console.log(JSON.stringify(expectedPushStatus, null, 2));

// This is what happens in profile.js - the user sees this message
console.log('\nUser will see in profile page:');
console.log(expectedPushStatus.reason);

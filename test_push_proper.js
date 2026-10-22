// Simulate the actual pushStatus usage from profile.js
function isCapacitorRuntime() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

function nativePush() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

async function pushStatus() {
  if (!isCapacitorRuntime()) {
    return { available: false, granted: false, reason: 'Hanya tersedia di aplikasi Android/iOS (Capacitor).' };
  }
  const Push = nativePush();
  if (!Push) {
    return { available: false, granted: false, reason: 'Plugin push belum terpasang di build native (lihat docs/10).' };
  }
  let granted = false;
  try {
    const perm = await Push.checkPermissions();
    granted = perm?.receive === 'granted';
  } catch { /* cek gagal - perlakukan belum izin */ }
  if (!granted) {
    return {
      available: true,
      granted: false,
      reason: 'Izin notifikasi belum diberikan. Izinkan notifikasi agar pesan tampil sebagai system notif.',
    };
  }
  if (!registeredToken) {
    return {
      available: true,
      granted: true,
      reason: 'Izin diberikan, tetapi token belum terdaftar. Coba login ulang (lihat docs/10).',
    };
  }
  return {
    available: true,
    granted: true,
    reason: 'Push native aktif - token perangkat terdaftar. Pesan masuk tampil sebagai system notif.',
  };
}

// Simulate the actual usage from profile.js
async function testPushStatusInProfile() {
  console.log('=== Testing pushStatus in profile.js context ===');
  
  // Setup browser environment (no Capacitor)
  global.window = { Capacitor: undefined };
  
  try {
    const status = await pushStatus();
    console.log('pushStatus result:');
    console.log('  Available:', status.available);
    console.log('  Granted:', status.granted);
    console.log('  Reason:', status.reason);
    
    // This is what happens in profile.js
    const pushRow = document.createElement('div');
    pushRow.textContent = status.reason;
    
    console.log('pushRow.textContent:', pushRow.textContent);
    console.log('Expected: Hanya tersedia di aplikasi Android/iOS (Capacitor).');
    console.log('Match:', pushRow.textContent === 'Hanya tersedia di aplikasi Android/iOS (Capacitor).');
  } catch (error) {
    console.log('Error:', error.message);
  }
}

testPushStatusInProfile();

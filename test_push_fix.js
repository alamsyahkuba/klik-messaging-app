// Test the fix for push notification status in browser environment

const isCapacitorRuntime = () => {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
};

// Function to provide better status message for browser environment
async function pushStatusFixed() {
  if (!isCapacitorRuntime()) {
    return { 
      available: false, 
      granted: false, 
      reason: 'Push notifications tersedia di aplikasi Android/iOS.'
    };
  }
  
  const Push = window.Capacitor?.Plugins?.PushNotifications || null;
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

// Test in browser environment (happy-dom)
global.window = { Capacitor: undefined };

async function testFixedPushStatus() {
  console.log('=== Testing Fixed pushStatus in Browser Environment ===');
  
  const status = await pushStatusFixed();
  console.log('pushStatus result:');
  console.log('  Available:', status.available);
  console.log('  Granted:', status.granted);
  console.log('  Reason:', status.reason);
  
  console.log('\nUser will see in profile page:');
  console.log(status.reason);
  
  console.log('\nThis message is clearer and more helpful for users!');
}

testFixedPushStatus();

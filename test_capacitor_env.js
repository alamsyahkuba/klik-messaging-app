// Test with Capacitor environment
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

// Simulate Capacitor environment with push plugin
let registeredToken = 'mock-fcm-token';

// Setup Capacitor environment with push plugin
const pushPlugin = {
  requestPermissions: async () => ({ receive: 'granted' }),
  register: async () => ({ value: registeredToken }),
  addListener: async (event, callback) => {
    console.log('Push notification listener registered:', event);
  },
  checkPermissions: async () => ({ receive: 'granted' })
};

global.window = {
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      PushNotifications: pushPlugin
    }
  }
};

async function testCapacitorEnvironment() {
  console.log('=== Testing with Capacitor environment ===');
  
  const status = await pushStatus();
  console.log('pushStatus result:');
  console.log('  Available:', status.available);
  console.log('  Granted:', status.granted);
  console.log('  Reason:', status.reason);
}

testCapacitorEnvironment();

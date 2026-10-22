// Simple test to understand pushStatus behavior
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

// Test browser scenario
const testScenarios = [
  {
    name: 'Browser (no Capacitor)',
    window: { Capacitor: undefined },
    expected: 'Hanya tersedia di aplikasi Android/iOS (Capacitor).'
  }
];

for (const scenario of testScenarios) {
  global.window = scenario.window;
  const result = pushStatus();
  console.log(scenario.name + ':');
  console.log('  Reason: ' + result.reason);
  console.log('  Available: ' + result.available);
  console.log('  Granted: ' + result.granted);
  console.log('  Expected: ' + scenario.expected);
  console.log('  Match: ' + (result.reason === scenario.expected ? 'Yes' : 'No'));
}

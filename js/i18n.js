// Translations (English and Indonesian) and a tiny translation helper.
//
// Usage:
//   t('files.empty')                       -> plain string
//   t('connect.expiresIn', { time: '9:58' }) -> "Code expires in 9:58"
//
// Elements can be translated declaratively in the HTML:
//   <span data-i18n="nav.camera"></span>
//   <input data-i18n-attr="placeholder:phone.connectHint">
//
// Missing keys fall back to English, then to the key itself, so a typo shows
// up as readable text instead of crashing the UI.

const EN = {
  'app.name': 'LinkDrop',
  'app.tagline': 'Phone and laptop, connected directly',

  'nav.connect': 'Connect',
  'nav.camera': 'Camera',
  'nav.files': 'Files',
  'nav.settings': 'Settings',
  'nav.help': 'Help',

  'status.disconnected': 'Disconnected',
  'status.waiting': 'Waiting',
  'status.connected': 'Connected',
  'status.connecting': 'Connecting',

  'conn.type.local': 'Local network',
  'conn.type.relayed': 'Relayed',
  'conn.device': 'Device',
  'conn.latency': 'Latency',
  'conn.disconnect': 'Disconnect',
  'conn.reconnecting': 'Reconnecting…',
  'conn.ready': 'Ready',

  'fallback.notice': 'Using backup pairing service',
  'fallback.detail':
    'The usual pairing service was not reachable, so LinkDrop switched to a public backup service. Setup messages stay encrypted.',

  /* ---- laptop connect page ---- */
  'connect.title': 'Connect a phone',
  'connect.subtitle': 'On your phone, open the LinkDrop page and enter this code.',
  'connect.codeLabel': 'Pairing code',
  'connect.copy': 'Copy code',
  'connect.copied': 'Code copied',
  'connect.newCode': 'Generate new code',
  'connect.retry': 'Retry',
  'connect.qrHint': 'Scan this QR code with your phone camera — it opens the phone page with the code filled in.',
  'connect.qrAlt': 'QR code that opens the phone page with the pairing code',
  'connect.openPhone': 'Open phone page',
  'connect.expiresIn': 'Code expires in {time}',
  'connect.expired': 'This code has expired. Generate a new one.',
  'connect.waiting': 'Waiting for a phone…',
  'connect.step1': 'Scan or type the code',
  'connect.step2': 'Allow camera access on the phone',
  'connect.step3': 'Match the 4 digits',
  'connect.connectedTitle': 'Phone connected',
  'connect.connectedSub': '{name} is ready to stream and share files.',
  'connect.openCamera': 'Open camera',
  'connect.sendFiles': 'Send files',
  'connect.detail.status': 'Status',

  /* ---- verification ---- */
  'verify.allowTitle': 'Allow this device to connect?',
  'verify.allowBody': '“{name}” wants to connect to this laptop.',
  'verify.numberLabel': 'Verification number',
  'verify.allow': 'Allow',
  'verify.deny': 'Deny',
  'verify.phoneCheck': 'Check that this number matches the one on your laptop',
  'verify.waitingAccept': 'Waiting for your laptop to accept…',
  'verify.mismatch': 'The numbers did not match, so the connection was closed.',
  'verify.rejected': 'The connection was declined on the laptop.',
  'verify.trusted': 'Trusted device — connecting automatically.',

  /* ---- camera (laptop) ---- */
  'camera.title': 'Camera',
  'camera.subtitle': 'Live view from the connected phone.',
  'camera.empty': 'No video yet. Connect a phone to see its camera.',
  'camera.snapshot': 'Snapshot',
  'camera.record': 'Record',
  'camera.stopRecord': 'Stop recording',
  'camera.fullscreen': 'Fullscreen',
  'camera.mirror': 'Mirror',
  'camera.pip': 'Picture in picture',
  'camera.stats': 'Stats',
  'camera.recording': 'Recording {time}',
  'camera.stat.resolution': 'Resolution',
  'camera.stat.fps': 'Frame rate',
  'camera.stat.bitrate': 'Bitrate',
  'camera.stat.latency': 'Latency',
  'camera.stat.connection': 'Connection',
  'camera.controls': 'Remote controls',
  'camera.controls.camera': 'Camera',
  'camera.controls.front': 'Front',
  'camera.controls.back': 'Back',
  'camera.controls.resolution': 'Resolution',
  'camera.controls.frameRate': 'Frame rate',
  'camera.controls.torch': 'Torch',
  'camera.controls.audio': 'Microphone',
  'camera.controls.audioHint': 'Sends the phone microphone to the laptop',
  'camera.controls.unsupported': 'Not available on this phone',
  'camera.snapshotSaved': 'Snapshot saved',
  'camera.permission.title': 'Allow camera access',
  'camera.permission.hint':
    'Open the camera icon in your browser’s address bar, choose “Allow”, then try again.',
  'camera.nodevice.title': 'No camera found',
  'camera.nodevice.hint': 'Connect a camera, or open LinkDrop on a device that has one.',

  /* ---- camera (phone) ---- */
  'phone.connectTitle': 'Connect to a laptop',
  'phone.connectSubtitle': 'Enter the 8-digit code shown on your laptop.',
  'phone.codeLabel': 'Pairing code',
  'phone.connect': 'Connect',
  'phone.disconnect': 'Disconnect',
  'phone.camTitle': 'Camera',
  'phone.camera': 'Camera',
  'phone.streaming': 'Streaming to {name}',
  'phone.notStreaming': 'Camera is stopped',
  'phone.start': 'Start camera',
  'phone.stop': 'Stop',
  'phone.currentCamera': 'Camera: {camera}',
  'phone.front': 'Front',
  'phone.back': 'Back',
  'phone.keepAwake': 'The screen stays awake while streaming.',
  'phone.wakeLockFailed': 'The screen may turn off while streaming.',

  /* ---- files ---- */
  'files.title': 'Files',
  'files.subtitle': 'Send files in both directions, directly between the devices.',
  'files.send': 'Send files',
  'files.empty': 'No files yet. Drop files here.',
  'files.emptyPhone': 'No files yet. Tap “Send files” to choose some.',
  'files.dropHere': 'Drop files here',
  'files.note':
    'A browser cannot browse your phone’s whole storage. You choose which files to send.',
  'files.chooseFolder': 'Choose save folder',
  'files.folderSet': 'Saving received files to “{name}”.',
  'files.folderCleared': 'Received files will go to your browser’s downloads.',
  'files.folderUnsupported': 'This browser saves received files to your downloads folder.',
  'files.session': 'This session',
  'files.clear': 'Clear list',
  'files.status.queued': 'Queued',
  'files.status.sending': 'Sending',
  'files.status.receiving': 'Receiving',
  'files.status.done': 'Done',
  'files.status.failed': 'Failed',
  'files.status.cancelled': 'Cancelled',
  'files.cancel': 'Cancel',
  'files.retry': 'Retry',
  'files.speed': 'Speed',
  'files.eta': 'Time left',
  'files.dir.toPhone': 'To phone',
  'files.dir.toLaptop': 'To laptop',
  'files.savedTo': 'Saved “{name}”',
  'files.received': 'Received “{name}”',
  'files.remove': 'Remove from list',

  /* ---- settings ---- */
  'settings.title': 'Settings',
  'settings.subtitle': 'Preferences are stored only in this browser.',
  'settings.group.device': 'Device',
  'settings.group.camera': 'Camera defaults',
  'settings.group.connection': 'Connection',
  'settings.group.storage': 'Storage',
  'settings.group.preferences': 'Preferences',
  'settings.group.about': 'App',
  'settings.deviceName': 'Device name',
  'settings.deviceName.help': 'The name the other device sees when you pair.',
  'settings.theme': 'Theme',
  'settings.theme.help': 'Follow your system, or pick light or dark.',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.defaultCamera': 'Default camera',
  'settings.defaultCamera.help': 'Which camera the phone opens with.',
  'settings.resolution': 'Default resolution',
  'settings.resolution.help': 'Higher resolutions use more bandwidth.',
  'settings.frameRate': 'Default frame rate',
  'settings.frameRate.help': '60 fps only works on phones that support it.',
  'settings.audio': 'Microphone',
  'settings.audio.help': 'Send the phone microphone by default. Off by default.',
  'settings.keepAwake': 'Keep screen awake',
  'settings.keepAwake.help': 'Stop the phone screen from sleeping while streaming.',
  'settings.rememberDevice': 'Remember this device',
  'settings.rememberDevice.help':
    'Skip the confirmation next time, but only when the 4-digit number matches a device you trusted before.',
  'settings.saveToDisk': 'Save received files to a folder',
  'settings.saveToDisk.help':
    'When supported, received files are written straight to disk instead of memory.',
  'settings.language': 'Language',
  'settings.language.help': 'Interface language.',
  'settings.reset': 'Reset pairing',
  'settings.reset.help': 'Clears settings, the remembered device and the pairing code.',
  'settings.resetButton': 'Reset pairing data',
  'settings.resetDone': 'Pairing data cleared.',
  'settings.saved': 'Saved',

  /* ---- help ---- */
  'help.title': 'Help',
  'help.subtitle': 'Short answers to the usual questions.',
  'help.pairing.title': 'How pairing works',
  'help.pairing.body':
    'The laptop shows an 8-digit code and a QR code, then walks you through three steps: scan or type the code, allow camera access on the phone, and match the 4 digits. Once connected, it shows the device name, whether the link is local or relayed, and the current latency. The code is only valid for 10 minutes and only one phone can pair at a time.',
  'help.backup.title': 'Backup pairing (experimental)',
  'help.backup.body':
    'LinkDrop pairs through PeerJS Cloud. An optional backup that falls back to public MQTT brokers is experimental and off by default; set ENABLE_BACKUP_SIGNALING to true in config.js to enable it. While it is off, no MQTT code is loaded and the app never mentions a backup service.',
  'help.verify.title': 'The verification number',
  'help.verify.body':
    'After the direct connection is up, both screens show the same 4-digit number, derived from the two devices’ certificates. If the numbers differ, someone may be intercepting the connection — press Deny and try again.',
  'help.usb.title': 'Using a USB cable',
  'help.usb.body':
    'A cable makes the connection faster and more reliable because the two devices share one network. Android: Settings → Network → Hotspot & tethering → turn on USB tethering. iPhone: connect the cable, then turn on Personal Hotspot and choose the USB option. Then pair as usual.',
  'help.wifi.title': 'Wi-Fi tips',
  'help.wifi.body':
    'Put both devices on the same Wi-Fi network. Avoid guest networks and “client isolation”, which block devices from talking to each other. 5 GHz is faster; 2.4 GHz reaches further.',
  'help.troubleshooting.title': 'Troubleshooting',
  'help.troubleshooting.camera':
    'Camera does not start: allow camera access for this site, close other apps that use the camera, and reload the page.',
  'help.troubleshooting.turn':
    'Different networks: if the devices are on different networks (for example phone on mobile data) the connection may need a TURN server. Add one in config.js.',
  'help.troubleshooting.firewall':
    'Firewalls: corporate networks and VPNs often block WebRTC. Try USB tethering or another network.',
  'help.troubleshooting.files':
    'A transfer failed: keep both screens open and retry. Large files need both devices to stay awake.',
  'help.privacy.title': 'Privacy',
  'help.privacy.body':
    'Video and files travel directly between the two devices and are never uploaded to a server. The pairing services only ever see encrypted setup messages, and nothing about your files or video.',

  /* ---- errors ---- */
  'errors.notSecure': 'LinkDrop must be served over https:// or http://localhost.',
  'errors.cryptoUnavailable': 'This browser is missing the cryptography features LinkDrop needs.',
  'errors.wrongOrExpiredCode': 'That code is not valid or has expired. Check the code and try again.',
  'errors.codeInUse': 'That code is already in use. Generate a new one.',
  'errors.codeExpired': 'This code has expired. Generate a new one.',
  'errors.signalingUnreachable': 'The pairing service could not be reached.',
  'errors.signalingTimeout': 'The pairing service did not respond in time.',
  'errors.signalingHint': 'Check that you are online, then try again.',
  'errors.allServicesUnreachable':
    'The pairing service is unreachable. Check your internet connection and try again.',
  'errors.browserIncompatible': 'This browser does not support the features LinkDrop needs. Try a recent Chrome, Edge, Firefox or Safari.',
  'errors.cameraDenied':
    'Camera permission was denied. Allow camera access for this site, then try again.',
  'errors.noCamera': 'No camera was found on this device.',
  'errors.cameraFailed': 'The camera could not be started.',
  'errors.micDenied':
    'Microphone permission was denied. Allow microphone access for this site, then try again.',
  'errors.connectionFailed': 'The connection failed. Please try again.',
  'errors.channelClosed': 'The connection was interrupted during the transfer.',
  'errors.generic': 'Something went wrong.',
  'errors.iceFailed':
    'The two devices could not reach each other directly. This often happens when they are on different networks or one is on mobile data — a TURN server is usually needed. Connect both devices to the same Wi-Fi, or add a TURN server in config.js.',

  /* ---- phone landing + scanner ---- */
  'phone.landingTitle': 'Connect to your laptop',
  'phone.landingSubtitle': 'Type the 8-digit code, or scan the QR code shown on your laptop.',
  'phone.enterCode': 'Pairing code',
  'phone.codeHint': '8 digits, shown on your laptop',
  'phone.scanQr': 'Scan QR code',
  'phone.connectingTo': 'Connecting to your laptop…',
  'phone.connectingHint': 'Setting up a direct connection. This usually takes a few seconds.',
  'phone.scanTitle': 'Scan the QR code',
  'phone.scanHint': 'Point the camera at the QR code on your laptop.',
  'phone.scanStarting': 'Starting the camera…',
  'phone.scanInvalid': 'That QR code is not a LinkDrop code. Try again.',
  'phone.scanUnsupported': 'This browser cannot scan QR codes. Type the code instead.',
  'phone.scanDenied': 'Camera access was denied. Allow it to scan, or type the code.',
  'phone.back': 'Back',
  'phone.tryAgain': 'Try again',
  'phone.switchBackup': 'The usual pairing service is slow — using the backup service.',
  'phone.expired': 'This code has expired. Ask your laptop for a new one.',

  /* ---- role separation ---- */
  'role.phoneOnDesktop.title': 'This page is for your phone',
  'role.phoneOnDesktop.body': 'Open LinkDrop on your computer and scan the QR code with your phone.',

  /* ---- verification (redesigned) ---- */
  'verify.acceptTitle': 'Allow this device?',
  'verify.device': 'Device',
  'verify.hint': 'Check that this number matches the one on your phone, then accept.',
  'verify.accept': 'Accept',
  'verify.reject': 'Reject',

  /* ---- connection check ---- */
  'help.check.title': 'Connection check',
  'help.check.body':
    'Run a quick test to see what kind of connection is likely to work from this device.',
  'checks.intro': 'Run a quick test of the pairing services, STUN and the connection types available from this device.',
  'checks.run': 'Run connection check',
  'checks.runAgain': 'Run again',
  'checks.running': 'Checking…',
  'checks.testing': 'Testing…',
  'checks.notTested': 'Not tested yet',
  'checks.peerjs': 'Pairing service ({host})',
  'checks.broker': 'Backup service ({host})',
  'checks.ice': 'Connection types (ICE)',
  'checks.iceGathered': 'Gathered successfully',
  'checks.candidate.host': 'Direct',
  'checks.candidate.srflx': 'Server reflexive',
  'checks.candidate.relay': 'Relay (TURN)',
  'checks.conclTurn':
    'Excellent — a TURN relay is available, so connections across different networks and mobile data should work.',
  'checks.conclStun':
    'Good — devices on the same Wi-Fi should connect. Devices on different networks, or one on mobile data, may need a TURN server (see config.js).',
  'checks.conclLocalOnly':
    'Only local addresses were found. Both devices must be on the same network; otherwise a TURN server is likely needed (see config.js).',
  'checks.conclNoSignaling':
    'No pairing service could be reached from this device. Check the internet connection, then try again.',
  'checks.conclUnknown': 'No usable connection types were found. Try another network.',
  'checks.detail.reachable': 'Reachable',
  'checks.detail.unreachable': 'Not reachable',
  'checks.detail.blocked': 'Blocked or offline',
  'checks.detail.timeout': 'Timed out',
  'checks.detail.error': 'Connection error',
  'checks.detail.none': 'No candidates gathered',
  'checks.detail.bundleMissing': 'Not available in this browser',

  /* ---- connection lost / reconnect ---- */
  'conn.lostTitle': 'Connection lost',
  'conn.lost': 'The connection to the other device was interrupted.',
  'conn.reconnected': 'Reconnected',
  'conn.reconnectFailed': 'Could not reconnect automatically.',

  /* ---- misc ---- */
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.retry': 'Retry',
  'common.copy': 'Copy',
  'common.show': 'Show',
  'common.hide': 'Hide',
  'common.unsupported': 'Not supported in this browser',
  'common.loading': 'Loading…',
  'common.dismiss': 'Dismiss',
};

const ID = {
  'app.name': 'LinkDrop',
  'app.tagline': 'HP dan laptop, terhubung langsung',

  'nav.connect': 'Sambungkan',
  'nav.camera': 'Kamera',
  'nav.files': 'Berkas',
  'nav.settings': 'Pengaturan',
  'nav.help': 'Bantuan',

  'status.disconnected': 'Terputus',
  'status.waiting': 'Menunggu',
  'status.connected': 'Terhubung',
  'status.connecting': 'Menyambungkan',

  'conn.type.local': 'Jaringan lokal',
  'conn.type.relayed': 'Melalui relay',
  'conn.device': 'Perangkat',
  'conn.latency': 'Latensi',
  'conn.disconnect': 'Putuskan',
  'conn.reconnecting': 'Menyambungkan ulang…',
  'conn.ready': 'Siap',

  'fallback.notice': 'Memakai layanan pemasangan cadangan',
  'fallback.detail':
    'Layanan pemasangan utama tidak dapat dijangkau, jadi LinkDrop beralih ke layanan cadangan publik. Pesan pemasangan tetap terenkripsi.',

  'connect.title': 'Sambungkan HP',
  'connect.subtitle': 'Di HP, buka halaman LinkDrop lalu masukkan kode ini.',
  'connect.codeLabel': 'Kode pemasangan',
  'connect.copy': 'Salin kode',
  'connect.copied': 'Kode disalin',
  'connect.newCode': 'Buat kode baru',
  'connect.retry': 'Coba lagi',
  'connect.qrHint': 'Pindai kode QR ini dengan kamera HP — halaman HP akan terbuka dengan kode terisi.',
  'connect.qrAlt': 'Kode QR untuk membuka halaman HP dengan kode pemasangan',
  'connect.openPhone': 'Buka halaman HP',
  'connect.expiresIn': 'Kode berlaku {time} lagi',
  'connect.expired': 'Kode ini sudah kedaluwarsa. Buat kode baru.',
  'connect.waiting': 'Menunggu HP…',
  'connect.step1': 'Pindai atau ketik kodenya',
  'connect.step2': 'Izinkan akses kamera di HP',
  'connect.step3': 'Cocokkan 4 angka',
  'connect.connectedTitle': 'HP terhubung',
  'connect.connectedSub': '{name} siap streaming dan berbagi berkas.',
  'connect.openCamera': 'Buka kamera',
  'connect.sendFiles': 'Kirim berkas',
  'connect.detail.status': 'Status',

  'verify.allowTitle': 'Izinkan perangkat ini terhubung?',
  'verify.allowBody': '“{name}” ingin terhubung ke laptop ini.',
  'verify.numberLabel': 'Angka verifikasi',
  'verify.allow': 'Izinkan',
  'verify.deny': 'Tolak',
  'verify.phoneCheck': 'Pastikan angka ini sama dengan yang ada di laptop',
  'verify.waitingAccept': 'Menunggu laptop menyetujui…',
  'verify.mismatch': 'Angka tidak cocok, jadi koneksi ditutup.',
  'verify.rejected': 'Koneksi ditolak di laptop.',
  'verify.trusted': 'Perangkat tepercaya — menyambung otomatis.',

  'camera.title': 'Kamera',
  'camera.subtitle': 'Tampilan langsung dari HP yang terhubung.',
  'camera.empty': 'Belum ada video. Sambungkan HP untuk melihat kameranya.',
  'camera.snapshot': 'Tangkapan',
  'camera.record': 'Rekam',
  'camera.stopRecord': 'Hentikan rekaman',
  'camera.fullscreen': 'Layar penuh',
  'camera.mirror': 'Cermin',
  'camera.pip': 'Gambar dalam gambar',
  'camera.stats': 'Statistik',
  'camera.recording': 'Merekam {time}',
  'camera.stat.resolution': 'Resolusi',
  'camera.stat.fps': 'Laju bingkai',
  'camera.stat.bitrate': 'Bitrate',
  'camera.stat.latency': 'Latensi',
  'camera.stat.connection': 'Koneksi',
  'camera.controls': 'Kontrol jarak jauh',
  'camera.controls.camera': 'Kamera',
  'camera.controls.front': 'Depan',
  'camera.controls.back': 'Belakang',
  'camera.controls.resolution': 'Resolusi',
  'camera.controls.frameRate': 'Laju bingkai',
  'camera.controls.torch': 'Lampu',
  'camera.controls.audio': 'Mikrofon',
  'camera.controls.audioHint': 'Mengirim mikrofon HP ke laptop',
  'camera.controls.unsupported': 'Tidak tersedia di HP ini',
  'camera.snapshotSaved': 'Tangkapan disimpan',
  'camera.permission.title': 'Izinkan akses kamera',
  'camera.permission.hint':
    'Buka ikon kamera di bilah alamat peramban, pilih “Izinkan”, lalu coba lagi.',
  'camera.nodevice.title': 'Kamera tidak ditemukan',
  'camera.nodevice.hint': 'Sambungkan kamera, atau buka LinkDrop di perangkat yang memilikinya.',

  'phone.connectTitle': 'Sambungkan ke laptop',
  'phone.connectSubtitle': 'Masukkan 8 angka yang tampil di laptop.',
  'phone.codeLabel': 'Kode pemasangan',
  'phone.connect': 'Sambungkan',
  'phone.disconnect': 'Putuskan',
  'phone.camTitle': 'Kamera',
  'phone.camera': 'Kamera',
  'phone.streaming': 'Mengalir ke {name}',
  'phone.notStreaming': 'Kamera berhenti',
  'phone.start': 'Nyalakan kamera',
  'phone.stop': 'Stop',
  'phone.currentCamera': 'Kamera: {camera}',
  'phone.front': 'Depan',
  'phone.back': 'Belakang',
  'phone.keepAwake': 'Layar tetap menyala selama mengalir.',
  'phone.wakeLockFailed': 'Layar mungkin mati selama mengalir.',

  'files.title': 'Berkas',
  'files.subtitle': 'Kirim berkas dua arah, langsung antar perangkat.',
  'files.send': 'Kirim berkas',
  'files.empty': 'Belum ada berkas. Letakkan berkas di sini.',
  'files.emptyPhone': 'Belum ada berkas. Ketuk “Kirim berkas” untuk memilih.',
  'files.dropHere': 'Letakkan berkas di sini',
  'files.note':
    'Peramban tidak dapat menelusuri seluruh penyimpanan HP. Anda memilih berkas yang ingin dikirim.',
  'files.chooseFolder': 'Pilih folder simpan',
  'files.folderSet': 'Berkas yang diterima disimpan ke “{name}”.',
  'files.folderCleared': 'Berkas yang diterima akan masuk ke unduhan peramban.',
  'files.folderUnsupported': 'Peramban ini menyimpan berkas yang diterima ke folder unduhan.',
  'files.session': 'Sesi ini',
  'files.clear': 'Bersihkan daftar',
  'files.status.queued': 'Dalam antrean',
  'files.status.sending': 'Mengirim',
  'files.status.receiving': 'Menerima',
  'files.status.done': 'Selesai',
  'files.status.failed': 'Gagal',
  'files.status.cancelled': 'Dibatalkan',
  'files.cancel': 'Batalkan',
  'files.retry': 'Coba lagi',
  'files.speed': 'Kecepatan',
  'files.eta': 'Sisa waktu',
  'files.dir.toPhone': 'Ke HP',
  'files.dir.toLaptop': 'Ke laptop',
  'files.savedTo': 'Tersimpan “{name}”',
  'files.received': 'Diterima “{name}”',
  'files.remove': 'Hapus dari daftar',

  'settings.title': 'Pengaturan',
  'settings.subtitle': 'Preferensi hanya disimpan di peramban ini.',
  'settings.group.device': 'Perangkat',
  'settings.group.camera': 'Bawaan kamera',
  'settings.group.connection': 'Koneksi',
  'settings.group.storage': 'Penyimpanan',
  'settings.group.preferences': 'Preferensi',
  'settings.group.about': 'Aplikasi',
  'settings.deviceName': 'Nama perangkat',
  'settings.deviceName.help': 'Nama yang dilihat perangkat lain saat memasang.',
  'settings.theme': 'Tema',
  'settings.theme.help': 'Ikuti sistem, atau pilih terang atau gelap.',
  'settings.theme.system': 'Sistem',
  'settings.theme.light': 'Terang',
  'settings.theme.dark': 'Gelap',
  'settings.defaultCamera': 'Kamera bawaan',
  'settings.defaultCamera.help': 'Kamera yang dibuka HP secara bawaan.',
  'settings.resolution': 'Resolusi bawaan',
  'settings.resolution.help': 'Resolusi lebih tinggi memakai lebih banyak data.',
  'settings.frameRate': 'Laju bingkai bawaan',
  'settings.frameRate.help': '60 fps hanya berfungsi di HP yang mendukung.',
  'settings.audio': 'Mikrofon',
  'settings.audio.help': 'Kirim mikrofon HP secara bawaan. Bawaan mati.',
  'settings.keepAwake': 'Jaga layar tetap menyala',
  'settings.keepAwake.help': 'Cegah layar HP tidur selama mengalir.',
  'settings.rememberDevice': 'Ingat perangkat ini',
  'settings.rememberDevice.help':
    'Lewati konfirmasi di lain waktu, tetapi hanya bila 4 angka cocok dengan perangkat tepercaya.',
  'settings.saveToDisk': 'Simpan berkas yang diterima ke folder',
  'settings.saveToDisk.help':
    'Bila didukung, berkas yang diterima langsung ditulis ke disk, bukan ke memori.',
  'settings.language': 'Bahasa',
  'settings.language.help': 'Bahasa antarmuka.',
  'settings.reset': 'Atur ulang pemasangan',
  'settings.reset.help': 'Menghapus pengaturan, perangkat yang diingat dan kode pemasangan.',
  'settings.resetButton': 'Atur ulang data pemasangan',
  'settings.resetDone': 'Data pemasangan dibersihkan.',
  'settings.saved': 'Disimpan',

  'help.title': 'Bantuan',
  'help.subtitle': 'Jawaban singkat untuk pertanyaan umum.',
  'help.pairing.title': 'Cara pemasangan',
  'help.pairing.body':
    'Laptop menampilkan kode 8 angka dan kode QR, lalu memandu lewat tiga langkah: pindai atau ketik kodenya, izinkan akses kamera di HP, dan samakan 4 angkanya. Setelah tersambung, laptop menampilkan nama perangkat, apakah sambungan lokal atau lewat relay, dan latensi saat ini. Kode hanya berlaku 10 menit dan hanya satu HP yang dapat memasang.',
  'help.backup.title': 'Pemasangan cadangan (eksperimental)',
  'help.backup.body':
    'LinkDrop memasang melalui PeerJS Cloud. Cadangan opsional yang beralih ke broker MQTT publik bersifat eksperimental dan nonaktif secara bawaan; setel ENABLE_BACKUP_SIGNALING ke true di config.js untuk mengaktifkannya. Selama nonaktif, tidak ada kode MQTT yang dimuat dan aplikasi tidak pernah menyebut layanan cadangan.',
  'help.verify.title': 'Angka verifikasi',
  'help.verify.body':
    'Setelah koneksi langsung aktif, kedua layar menampilkan 4 angka yang sama, berasal dari sertifikat kedua perangkat. Bila angkanya berbeda, mungkin ada yang menyadap koneksi — tekan Tolak dan coba lagi.',
  'help.usb.title': 'Memakai kabel USB',
  'help.usb.body':
    'Kabel membuat koneksi lebih cepat dan andal karena kedua perangkat berbagi satu jaringan. Android: Pengaturan → Jaringan → Hotspot & tethering → aktifkan USB tethering. iPhone: sambungkan kabel, lalu aktifkan Personal Hotspot dan pilih opsi USB. Setelah itu pasangkan seperti biasa.',
  'help.wifi.title': 'Tips Wi-Fi',
  'help.wifi.body':
    'Tempatkan kedua perangkat di jaringan Wi-Fi yang sama. Hindari jaringan tamu dan “client isolation”, yang mencegah perangkat saling berkomunikasi. 5 GHz lebih cepat; 2,4 GHz lebih jauh.',
  'help.troubleshooting.title': 'Pemecahan masalah',
  'help.troubleshooting.camera':
    'Kamera tidak menyala: izinkan akses kamera untuk situs ini, tutup aplikasi lain yang memakai kamera, lalu muat ulang halaman.',
  'help.troubleshooting.turn':
    'Jaringan berbeda: bila perangkat berada di jaringan berbeda (misalnya HP memakai data seluler), koneksi mungkin perlu server TURN. Tambahkan di config.js.',
  'help.troubleshooting.firewall':
    'Firewall: jaringan kantor dan VPN sering memblokir WebRTC. Coba USB tethering atau jaringan lain.',
  'help.troubleshooting.files':
    'Transfer gagal: biarkan kedua layar tetap terbuka lalu coba lagi. Berkas besar membuat perangkat harus tetap menyala.',
  'help.privacy.title': 'Privasi',
  'help.privacy.body':
    'Video dan berkas berpindah langsung antar dua perangkat dan tidak pernah diunggah ke server. Layanan pemasangan hanya melihat pesan pemasangan terenkripsi, bukan berkas atau video Anda.',

  'errors.notSecure': 'LinkDrop harus dilayani melalui https:// atau http://localhost.',
  'errors.cryptoUnavailable': 'Peramban ini tidak memiliki fitur kriptografi yang dibutuhkan LinkDrop.',
  'errors.wrongOrExpiredCode': 'Kode tidak valid atau sudah kedaluwarsa. Periksa kode lalu coba lagi.',
  'errors.codeInUse': 'Kode itu sedang dipakai. Buat kode baru.',
  'errors.codeExpired': 'Kode ini sudah kedaluwarsa. Buat kode baru.',
  'errors.signalingUnreachable': 'Layanan pemasangan tidak dapat dijangkau.',
  'errors.signalingTimeout': 'Layanan pemasangan tidak merespons tepat waktu.',
  'errors.signalingHint': 'Pastikan Anda terhubung internet, lalu coba lagi.',
  'errors.allServicesUnreachable':
    'Layanan pemasangan tidak dapat dijangkau. Periksa koneksi internet lalu coba lagi.',
  'errors.browserIncompatible':
    'Peramban ini tidak mendukung fitur yang dibutuhkan LinkDrop. Coba Chrome, Edge, Firefox atau Safari terbaru.',
  'errors.cameraDenied':
    'Izin kamera ditolak. Izinkan akses kamera untuk situs ini, lalu coba lagi.',
  'errors.noCamera': 'Kamera tidak ditemukan di perangkat ini.',
  'errors.cameraFailed': 'Kamera tidak dapat dinyalakan.',
  'errors.micDenied':
    'Izin mikrofon ditolak. Izinkan akses mikrofon untuk situs ini, lalu coba lagi.',
  'errors.connectionFailed': 'Koneksi gagal. Silakan coba lagi.',
  'errors.channelClosed': 'Koneksi terputus saat transfer berlangsung.',
  'errors.generic': 'Terjadi kesalahan.',
  'errors.iceFailed':
    'Kedua perangkat tidak dapat saling terhubung secara langsung. Ini sering terjadi bila perangkat berada di jaringan berbeda atau salah satunya memakai data seluler — biasanya perlu server TURN. Sambungkan kedua perangkat ke Wi-Fi yang sama, atau tambahkan server TURN di config.js.',

  'phone.landingTitle': 'Sambungkan ke laptop',
  'phone.landingSubtitle': 'Ketik kode 8 angka, atau pindai kode QR di laptop.',
  'phone.enterCode': 'Kode pemasangan',
  'phone.codeHint': '8 angka, tampil di laptop',
  'phone.scanQr': 'Pindai kode QR',
  'phone.connectingTo': 'Menyambungkan ke laptop…',
  'phone.connectingHint': 'Menyiapkan koneksi langsung. Biasanya hanya butuh beberapa detik.',
  'phone.scanTitle': 'Pindai kode QR',
  'phone.scanHint': 'Arahkan kamera ke kode QR di laptop.',
  'phone.scanStarting': 'Menyalakan kamera…',
  'phone.scanInvalid': 'Kode QR itu bukan kode LinkDrop. Coba lagi.',
  'phone.scanUnsupported': 'Peramban ini tidak dapat memindai kode QR. Ketik kodenya saja.',
  'phone.scanDenied': 'Akses kamera ditolak. Izinkan untuk memindai, atau ketik kodenya.',
  'phone.back': 'Kembali',
  'phone.tryAgain': 'Coba lagi',
  'phone.switchBackup': 'Layanan pemasangan utama lambat — memakai layanan cadangan.',
  'phone.expired': 'Kode ini sudah kedaluwarsa. Minta kode baru dari laptop.',

  'role.phoneOnDesktop.title': 'Halaman ini untuk HP Anda',
  'role.phoneOnDesktop.body': 'Buka LinkDrop di komputer Anda lalu pindai kode QR dengan HP.',

  'verify.acceptTitle': 'Izinkan perangkat ini?',
  'verify.device': 'Perangkat',
  'verify.hint': 'Cocokkan angka ini dengan yang ada di HP, lalu setujui.',
  'verify.accept': 'Setujui',
  'verify.reject': 'Tolak',

  'help.check.title': 'Pemeriksaan koneksi',
  'help.check.body':
    'Jalankan uji cepat untuk melihat jenis koneksi yang mungkin berhasil dari perangkat ini.',
  'checks.intro': 'Jalankan uji cepat layanan pemasangan, STUN, dan jenis koneksi yang tersedia dari perangkat ini.',
  'checks.run': 'Jalankan pemeriksaan',
  'checks.runAgain': 'Jalankan lagi',
  'checks.running': 'Memeriksa…',
  'checks.testing': 'Menguji…',
  'checks.notTested': 'Belum diuji',
  'checks.peerjs': 'Layanan pemasangan ({host})',
  'checks.broker': 'Layanan cadangan ({host})',
  'checks.ice': 'Jenis koneksi (ICE)',
  'checks.iceGathered': 'Berhasil dikumpulkan',
  'checks.candidate.host': 'Langsung',
  'checks.candidate.srflx': 'Server reflexive',
  'checks.candidate.relay': 'Relay (TURN)',
  'checks.conclTurn':
    'Bagus — relay TURN tersedia, jadi koneksi antar jaringan berbeda dan data seluler seharusnya berhasil.',
  'checks.conclStun':
    'Bagus — perangkat di Wi-Fi yang sama seharusnya terhubung. Perangkat di jaringan berbeda, atau salah satunya memakai data seluler, mungkin perlu server TURN (lihat config.js).',
  'checks.conclLocalOnly':
    'Hanya alamat lokal yang ditemukan. Kedua perangkat harus berada di jaringan yang sama; jika tidak, kemungkinan perlu server TURN (lihat config.js).',
  'checks.conclNoSignaling':
    'Tidak ada layanan pemasangan yang dapat dijangkau dari perangkat ini. Periksa koneksi internet lalu coba lagi.',
  'checks.conclUnknown': 'Tidak ada jenis koneksi yang dapat dipakai. Coba jaringan lain.',
  'checks.detail.reachable': 'Dapat dijangkau',
  'checks.detail.unreachable': 'Tidak dapat dijangkau',
  'checks.detail.blocked': 'Diblokir atau offline',
  'checks.detail.timeout': 'Waktu habis',
  'checks.detail.error': 'Kesalahan koneksi',
  'checks.detail.none': 'Tidak ada kandidat',
  'checks.detail.bundleMissing': 'Tidak tersedia di peramban ini',

  'conn.lostTitle': 'Koneksi terputus',
  'conn.lost': 'Koneksi ke perangkat lain terputus.',
  'conn.reconnected': 'Tersambung kembali',
  'conn.reconnectFailed': 'Tidak dapat menyambung ulang secara otomatis.',

  'common.close': 'Tutup',
  'common.cancel': 'Batal',
  'common.ok': 'OK',
  'common.retry': 'Coba lagi',
  'common.copy': 'Salin',
  'common.show': 'Tampilkan',
  'common.hide': 'Sembunyikan',
  'common.unsupported': 'Tidak didukung di peramban ini',
  'common.loading': 'Memuat…',
  'common.dismiss': 'Tutup',
};

const DICTIONARIES = { en: EN, id: ID };

let currentLanguage = 'en';

/** Change the active language and update <html lang>. */
export function setLanguage(language) {
  currentLanguage = DICTIONARIES[language] ? language : 'en';
  try {
    document.documentElement.lang = currentLanguage;
  } catch {
    /* ignore */
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function availableLanguages() {
  return Object.keys(DICTIONARIES);
}

/**
 * Translate a key, with optional {placeholder} interpolation.
 * Falls back: requested language -> English -> the key itself.
 */
export function t(key, params) {
  const table = DICTIONARIES[currentLanguage] || EN;
  let text = table[key] ?? EN[key] ?? key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
  }
  return text;
}

/** Translate every [data-i18n] / [data-i18n-attr] node inside `root`. */
export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((node) => {
    // Format: "placeholder:phone.connectHint;aria-label:common.close"
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) node.setAttribute(attr.trim(), t(key.trim()));
    }
  });
}

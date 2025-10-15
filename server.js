require('dotenv').config();
const app = require('./src/app');
const os = require('os');

const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0'; // Listen on all network interfaces

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('🚀 ========================================');
  console.log(`🚀  BanTrans TMS Backend Server Started`);
  console.log('🚀 ========================================');
  console.log(`🌐  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌  Local: http://localhost:${PORT}`);
  console.log(`🌍  Network: http://${localIP}:${PORT}`);
  console.log(`📡  API: http://${localIP}:${PORT}/api`);
  console.log(`💚  Health: http://${localIP}:${PORT}/health`);
  console.log(`🗄️  Database: WampServer MySQL`);
  console.log(`📊  phpMyAdmin: http://localhost/phpmyadmin`);
  console.log('');
  console.log('📱  Access from other devices:');
  console.log(`    http://${localIP}:${PORT}/login.html`);
  console.log('🚀 ========================================');
  console.log('');
});

// Handle server errors
app.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use!`);
    console.error('💡 Try: ');
    console.error('   1. Close other applications using this port');
    console.error('   2. Change PORT in .env file');
    console.error(`   3. Kill process: netstat -ano | findstr :${PORT}`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});
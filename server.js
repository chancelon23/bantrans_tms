require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0',() => {
  console.log('');
  console.log('🚀 ========================================');
  console.log(`🚀  BanTrans TMS Backend Server Started`);
  console.log('🚀 ========================================');
  console.log(`🌐  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌  Server: http://localhost:${PORT}`);
  console.log(`📡  API: http://localhost:${PORT}/api`);
  console.log(`💚  Health: http://localhost:${PORT}/health`);
  console.log(`🗄️  Database: WampServer MySQL`);
  console.log(`📊  phpMyAdmin: http://localhost/phpmyadmin`);
  console.log('🚀 ========================================');
  console.log('');
});
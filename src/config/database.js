const mysql = require('mysql2/promise');
require('dotenv').config();

// WampServer MySQL Configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bantrans_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to WampServer MySQL successfully');
    console.log(`📊 Database: ${process.env.DB_NAME}`);
    console.log(`🔌 Host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    connection.release();
  } catch (err) {
    console.error('❌ WampServer MySQL connection failed!');
    console.error('📋 Error:', err.message);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Check if WampServer icon is GREEN');
    console.error('   2. Verify MySQL service is running');
    console.error('   3. Check database name in .env file');
    console.error('   4. Verify credentials (default: root with no password)');
    console.error('   5. Import bantrans_db.sql in phpMyAdmin');
    process.exit(1);
  }
};

testConnection();

module.exports = pool;
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  };

const connectToDatabase = async () => {
  try {
    const pool = await sql.connect(dbConfig);
    console.log('Connected to SQL Server database');
    return pool;
  } catch (err) {
    console.error('Database connection error:', err);
    throw err;
  }
};

module.exports = { connectToDatabase, sql };
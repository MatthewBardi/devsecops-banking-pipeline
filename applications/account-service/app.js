const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const winston = require('winston');

const app = express();
const port = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use(limiter);

// Logging setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'bankuser',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'bankdb',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('Access attempt without token', { ip: req.ip });
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, user) => {
    if (err) {
      logger.warn('Invalid token attempt', { ip: req.ip, error: err.message });
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'account-service',
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// Metrics endpoint for Prometheus
app.get('/metrics', (req, res) => {
  // Basic metrics - in production, use prometheus client
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP account_service_requests_total Total number of requests
# TYPE account_service_requests_total counter
account_service_requests_total 100

# HELP account_service_response_time Response time in seconds
# TYPE account_service_response_time histogram
account_service_response_time_bucket{le="0.1"} 10
account_service_response_time_bucket{le="0.5"} 50
account_service_response_time_bucket{le="1.0"} 80
account_service_response_time_bucket{le="+Inf"} 100
  `);
});

// Get account information
app.get('/api/account/:id', authenticateToken, async (req, res) => {
  try {
    const accountId = req.params.id;
    
    // Input validation
    if (!accountId || !/^\d+$/.test(accountId)) {
      logger.warn('Invalid account ID format', { accountId, userId: req.user.id });
      return res.status(400).json({ error: 'Invalid account ID' });
    }

    // Authorization check - user can only access their own account
    if (req.user.id !== parseInt(accountId)) {
      logger.warn('Unauthorized account access attempt', { 
        requestedAccount: accountId, 
        userId: req.user.id 
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT account_id, account_number, balance, account_type, created_at FROM accounts WHERE account_id = $1 AND user_id = $2',
      [accountId, req.user.id]
    );

    if (result.rows.length === 0) {
      logger.info('Account not found', { accountId, userId: req.user.id });
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = result.rows[0];
    
    // Mask sensitive data
    account.account_number = account.account_number.replace(/\d(?=\d{4})/g, '*');
    
    logger.info('Account accessed successfully', { accountId, userId: req.user.id });
    res.json(account);

  } catch (error) {
    logger.error('Error fetching account', { 
      error: error.message, 
      accountId: req.params.id,
      userId: req.user?.id 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new account
app.post('/api/account', authenticateToken, async (req, res) => {
  try {
    const { accountType, initialDeposit } = req.body;

    // Input validation
    if (!accountType || !['checking', 'savings'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type' });
    }

    if (!initialDeposit || initialDeposit < 0 || initialDeposit > 1000000) {
      return res.status(400).json({ error: 'Invalid initial deposit amount' });
    }

    // Generate account number (simplified)
    const accountNumber = Math.floor(Math.random() * 1000000000).toString().padStart(10, '0');

    const result = await pool.query(
      'INSERT INTO accounts (user_id, account_number, account_type, balance) VALUES ($1, $2, $3, $4) RETURNING account_id',
      [req.user.id, accountNumber, accountType, initialDeposit]
    );

    logger.info('New account created', { 
      accountId: result.rows[0].account_id,
      userId: req.user.id,
      accountType 
    });

    res.status(201).json({
      accountId: result.rows[0].account_id,
      accountNumber: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      accountType,
      balance: initialDeposit
    });

  } catch (error) {
    logger.error('Error creating account', { 
      error: error.message, 
      userId: req.user?.id 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Account balance update (internal service call)
app.patch('/api/account/:id/balance', authenticateToken, async (req, res) => {
  try {
    const { amount, transactionType } = req.body;
    const accountId = req.params.id;

    // Validation
    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!['credit', 'debit'].includes(transactionType)) {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    // Get current balance
    const balanceResult = await pool.query(
      'SELECT balance FROM accounts WHERE account_id = $1 AND user_id = $2',
      [accountId, req.user.id]
    );

    if (balanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const currentBalance = parseFloat(balanceResult.rows[0].balance);
    const newBalance = transactionType === 'credit' 
      ? currentBalance + amount 
      : currentBalance - amount;

    // Prevent negative balance (simplified business rule)
    if (newBalance < 0) {
      logger.warn('Insufficient funds transaction attempt', {
        accountId,
        currentBalance,
        attemptedAmount: amount,
        transactionType
      });
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    // Update balance
    await pool.query(
      'UPDATE accounts SET balance = $1, updated_at = NOW() WHERE account_id = $2 AND user_id = $3',
      [newBalance, accountId, req.user.id]
    );

    logger.info('Balance updated', {
      accountId,
      oldBalance: currentBalance,
      newBalance,
      transactionType,
      amount
    });

    res.json({ 
      success: true, 
      newBalance,
      transactionType,
      amount 
    });

  } catch (error) {
    logger.error('Error updating balance', { 
      error: error.message, 
      accountId: req.params.id,
      userId: req.user?.id 
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', { 
    error: error.message, 
    stack: error.stack,
    url: req.url,
    method: req.method 
  });
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('404 - Route not found', { url: req.originalUrl, method: req.method });
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(port, () => {
  logger.info(`Account service running on port ${port}`, {
    service: 'account-service',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
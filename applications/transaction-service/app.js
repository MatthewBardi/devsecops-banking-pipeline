const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

const app = express();
const port = process.env.PORT || 3002;

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for transaction service
  message: 'Too many transaction requests from this IP'
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
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'transaction.log' })
  ]
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'transaction-service',
    version: '1.0.0'
  });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP transaction_service_requests_total Total transactions processed
# TYPE transaction_service_requests_total counter
transaction_service_requests_total 250

# HELP transaction_service_amount_total Total transaction amount
# TYPE transaction_service_amount_total counter
transaction_service_amount_total 125000.50
  `);
});

// Mock transaction endpoints
app.post('/api/transaction', (req, res) => {
  const { fromAccount, toAccount, amount } = req.body;
  
  // Basic validation
  if (!fromAccount || !toAccount || !amount || amount <= 0) {
    logger.warn('Invalid transaction request', { fromAccount, toAccount, amount });
    return res.status(400).json({ error: 'Invalid transaction data' });
  }

  // Simulate transaction processing
  const transactionId = 'txn_' + Math.random().toString(36).substr(2, 9);
  
  logger.info('Transaction processed', {
    transactionId,
    fromAccount,
    toAccount,
    amount,
    timestamp: new Date().toISOString()
  });

  res.status(201).json({
    transactionId,
    status: 'completed',
    fromAccount,
    toAccount,
    amount,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/transaction/:id', (req, res) => {
  const transactionId = req.params.id;
  
  // Mock transaction data
  res.json({
    transactionId,
    status: 'completed',
    amount: 150.00,
    timestamp: new Date().toISOString(),
    description: 'Account transfer'
  });
});

// Start server
app.listen(port, () => {
  logger.info(`Transaction service running on port ${port}`);
});

module.exports = app;

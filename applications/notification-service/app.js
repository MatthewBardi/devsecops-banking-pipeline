const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

const app = express();
const port = process.env.PORT || 3003;

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '5mb' }));

// Rate limiting for notifications
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Lower limit for notification service
  message: 'Too many notification requests from this IP'
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
    new winston.transports.File({ filename: 'notification.log' })
  ]
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'notification-service',
    version: '1.0.0',
    channels: ['email', 'sms', 'push']
  });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP notification_service_sent_total Total notifications sent
# TYPE notification_service_sent_total counter
notification_service_sent_total{type="email"} 150
notification_service_sent_total{type="sms"} 75
notification_service_sent_total{type="push"} 300
  `);
});

// Send notification endpoint
app.post('/api/notification/send', (req, res) => {
  const { userId, type, message, priority } = req.body;
  
  // Validation
  if (!userId || !type || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['email', 'sms', 'push'].includes(type)) {
    return res.status(400).json({ error: 'Invalid notification type' });
  }

  // Generate notification ID
  const notificationId = 'notif_' + Math.random().toString(36).substr(2, 9);
  
  // Log notification (simulate sending)
  logger.info('Notification sent', {
    notificationId,
    userId,
    type,
    priority: priority || 'normal',
    timestamp: new Date().toISOString()
  });

  // Simulate different delivery times based on type
  const deliveryTime = {
    'email': 2000,
    'sms': 1000,
    'push': 500
  }[type];

  setTimeout(() => {
    logger.info('Notification delivered', { notificationId, type });
  }, deliveryTime);

  res.status(201).json({
    notificationId,
    status: 'queued',
    type,
    estimatedDelivery: new Date(Date.now() + deliveryTime).toISOString()
  });
});

// Get notification status
app.get('/api/notification/:id', (req, res) => {
  const notificationId = req.params.id;
  
  res.json({
    notificationId,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
    type: 'email'
  });
});

// Security alert notifications
app.post('/api/notification/security-alert', (req, res) => {
  const { alertType, severity, details } = req.body;
  
  logger.warn('Security alert notification', {
    alertType,
    severity,
    details,
    timestamp: new Date().toISOString()
  });

  res.json({
    status: 'security alert processed',
    alertId: 'alert_' + Math.random().toString(36).substr(2, 9),
    escalated: severity === 'high'
  });
});

// Start server
app.listen(port, () => {
  logger.info(`Notification service running on port ${port}`);
});

module.exports = app;

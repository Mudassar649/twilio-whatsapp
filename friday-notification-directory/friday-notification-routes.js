const express = require('express');
const fridayController = require('./friday-notification-controller'); // Adjust path as needed

const route = express.Router();

// API endpoints
route.get('/friday-notifications', fridayController.getAllNotifications.bind(fridayController));

route.get('/friday-notifications/:phoneNumber', fridayController.getNotificationByPhone.bind(fridayController));

// Manual trigger endpoints
route.post('/trigger-friday-notifications', fridayController.triggerFridayNotifications.bind(fridayController));

route.post('/trigger-reminders', fridayController.triggerReminders.bind(fridayController));

route.post('/trigger-saturday-messages', fridayController.triggerSaturdayMessages.bind(fridayController));

// Test endpoints
route.post('/test-friday-response', fridayController.testFridayResponse.bind(fridayController));

route.post('/create-test-notification', fridayController.createTestNotification.bind(fridayController));

module.exports = route;
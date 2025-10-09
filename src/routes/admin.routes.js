const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/admin/dashboard.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// Apply auth and role middleware to all routes
router.use(protect);
router.use(authorize('admin'));

// Routes
router.get('/dashboard', dashboardController.getDashboard);
router.get('/reports/revenue', dashboardController.getRevenueReport);
router.get('/reports/trips', dashboardController.getTripStatistics);
router.get('/reports/drivers', dashboardController.getDriverPerformanceReport);

module.exports = router;
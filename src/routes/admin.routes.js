const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const dashboardController = require('../controllers/admin/dashboard.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validators');

// Apply auth and role middleware to all routes
router.use(protect);
router.use(authorize('admin'));

// ==================== DASHBOARD ====================
router.get('/dashboard', dashboardController.getDashboard);

// ==================== REPORTS ====================
router.get('/reports/revenue', dashboardController.getRevenueReport);
router.get('/reports/trips', dashboardController.getTripStatistics);
router.get('/reports/drivers', dashboardController.getDriverPerformanceReport);

// ==================== USER MANAGEMENT ====================
const updateUserValidation = [
  body('firstname').trim().notEmpty().withMessage('First name is required'),
  body('lastname').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('role').isIn(['admin', 'dispatcher', 'driver', 'passenger']).withMessage('Invalid role'),
  body('status').isIn(['active', 'inactive', 'blocked']).withMessage('Invalid status')
];

const updateStatusValidation = [
  body('status').isIn(['active', 'inactive', 'blocked']).withMessage('Invalid status')
];

router.get('/users', dashboardController.getAllUsers);
router.get('/users/:id', dashboardController.getUserById);
router.put('/users/:id', updateUserValidation, validate, dashboardController.updateUser);
router.put('/users/:id/status', updateStatusValidation, validate, dashboardController.updateUserStatus);
router.delete('/users/:id', dashboardController.deleteUser);

// ==================== ROUTE MANAGEMENT ====================
const createRouteValidation = [
  body('origin').trim().notEmpty().withMessage('Origin is required'),
  body('destination').trim().notEmpty().withMessage('Destination is required'),
  body('distance_km').isFloat({ min: 0 }).withMessage('Valid distance is required'),
  body('estimated_duration_minutes').isInt({ min: 1 }).withMessage('Valid duration is required'),
  body('fare_price').isFloat({ min: 0 }).withMessage('Valid fare price is required')
];

const updateRouteValidation = [
  ...createRouteValidation,
  body('status').isIn(['active', 'inactive']).withMessage('Invalid status')
];

router.get('/routes', dashboardController.getAllRoutes);
router.post('/routes', createRouteValidation, validate, dashboardController.createRoute);
router.put('/routes/:id', updateRouteValidation, validate, dashboardController.updateRoute);
router.delete('/routes/:id', dashboardController.deleteRoute);

// ==================== VEHICLE MANAGEMENT ====================
const createVehicleValidation = [
  body('plate_number').trim().notEmpty().withMessage('Plate number is required'),
  body('make').trim().notEmpty().withMessage('Make is required'),
  body('model').trim().notEmpty().withMessage('Model is required'),
  body('year').isInt({ min: 1900, max: 2100 }).withMessage('Valid year is required'),
  body('vehicle_type').isIn(['van', 'mini-bus']).withMessage('Invalid vehicle type'),
  body('capacity').isInt({ min: 1 }).withMessage('Valid capacity is required')
];

const updateVehicleValidation = [
  ...createVehicleValidation,
  body('vehicle_status').isIn(['available', 'in_service', 'maintenance', 'retired']).withMessage('Invalid status')
];

router.get('/vehicles', dashboardController.getAllVehicles);
router.post('/vehicles', createVehicleValidation, validate, dashboardController.createVehicle);
router.put('/vehicles/:id', updateVehicleValidation, validate, dashboardController.updateVehicle);
router.delete('/vehicles/:id', dashboardController.deleteVehicle);

// ==================== SYSTEM LOGS ====================
router.get('/logs', dashboardController.getSystemLogs);

module.exports = router;
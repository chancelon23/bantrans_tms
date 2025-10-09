const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const queueController = require('../controllers/dispatcher/queue.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validators');

// Apply auth and role middleware to all routes
router.use(protect);
router.use(authorize('dispatcher', 'admin'));

// Validation rules
const createTripValidation = [
  body('route_id').isInt().withMessage('Valid route ID is required'),
  body('vehicle_id').isInt().withMessage('Valid vehicle ID is required'),
  body('driver_id').isInt().withMessage('Valid driver ID is required'),
  body('estimated_departure').isISO8601().withMessage('Valid departure time is required')
];

const walkInBookingValidation = [
  body('trip_id').isInt().withMessage('Valid trip ID is required'),
  body('firstname').trim().notEmpty().withMessage('First name is required'),
  body('lastname').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('seat_count').isInt({ min: 1, max: 10 }).withMessage('Seat count must be between 1 and 10'),
  body('payment_method').isIn(['cash', 'gcash', 'paymaya', 'terminal']).withMessage('Invalid payment method'),
  body('payment_reference').trim().notEmpty().withMessage('Payment reference is required')
];

// Routes
router.get('/queue', queueController.getQueueStatus);
router.post('/trips', createTripValidation, validate, queueController.createTrip);
router.get('/trips/:id', queueController.getTripDetails);
router.post('/trips/:id/depart', queueController.markTripDeparted);
router.post('/bookings/walk-in', walkInBookingValidation, validate, queueController.createWalkInBooking);
router.get('/bookings', queueController.getActiveBookings);

module.exports = router;
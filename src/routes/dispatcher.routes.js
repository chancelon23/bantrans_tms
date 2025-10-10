const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const queueController = require('../controllers/dispatcher/queue.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validators');

// Apply auth middleware only (remove role check for now)
router.use(protect);

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

const reassignVehicleValidation = [
  body('vehicle_id').isInt().withMessage('Valid vehicle ID is required')
];

const reassignDriverValidation = [
  body('driver_id').isInt().withMessage('Valid driver ID is required')
];

// Queue Management Routes
router.get('/queue', queueController.getQueueStatus);
router.get('/queue/route/:route_id', queueController.getQueueByRoute);

// Trip Creation & Management Routes
router.post('/trips', createTripValidation, validate, queueController.createTrip);
router.get('/trips/:id', queueController.getTripDetails);
router.get('/trips/:trip_id/bookings', queueController.getTripBookings);
router.get('/trips/:trip_id/manifest', queueController.generateManifest);

// Queue Operations Routes
router.post('/trips/:id/depart', queueController.markTripDeparted);
router.put('/trips/:id/reassign-vehicle', reassignVehicleValidation, validate, queueController.reassignVehicle);
router.put('/trips/:id/reassign-driver', reassignDriverValidation, validate, queueController.reassignDriver);

// Booking Management Routes
router.post('/bookings/walk-in', walkInBookingValidation, validate, queueController.createWalkInBooking);
router.get('/bookings', queueController.getActiveBookings);
router.get('/bookings/search/name/:name', queueController.searchBookingsByName);
router.get('/bookings/search/email/:email', queueController.searchBookingsByEmail);
router.get('/bookings/search/ticket/:ticket_reference', queueController.searchBookingsByTicket);
router.get('/bookings/:id/payment-status', queueController.verifyPaymentStatus);
router.post('/bookings/:id/cancel', queueController.cancelBooking);
router.get('/bookings/cancellations', queueController.getCancellationHistory);
router.get('/bookings/:id/passenger-contact', queueController.getPassengerContact);

// Real-time Monitoring Routes
router.get('/monitor/queue', queueController.monitorLiveQueue);
router.get('/monitor/seat-availability', queueController.checkSeatAvailability);
router.get('/monitor/bookings', queueController.trackBookingsRealtime);

// Resource Management Routes
router.get('/resources/drivers', queueController.getAvailableDrivers);
router.get('/resources/drivers/:id/status', queueController.getDriverStatus);
router.get('/resources/drivers/:id/history', queueController.getDriverAssignmentHistory);
router.get('/drivers/:id/contact', queueController.getDriverContact);
router.get('/resources/vehicles', queueController.getAvailableVehicles);
router.get('/resources/vehicles/:id/status', queueController.getVehicleStatus);
router.get('/resources/vehicles/:id/history', queueController.getVehicleAssignmentHistory);

// Communication Routes
router.get('/notifications', queueController.getNotifications);
router.put('/notifications/:id/read', queueController.markNotificationAsRead);

module.exports = router;
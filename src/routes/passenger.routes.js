const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const bookingsController = require('../controllers/passenger/bookings.controller');
const { validate } = require('../middleware/validators');

// Validation rules
const createBookingValidation = [
  body('route_id').isInt().withMessage('Valid route ID is required'),
  body('firstname').trim().notEmpty().withMessage('First name is required'),
  body('lastname').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('seat_count').isInt({ min: 1, max: 10 }).withMessage('Seat count must be between 1 and 10'),
  body('payment_method').isIn(['cash', 'gcash', 'paymaya', 'online']).withMessage('Invalid payment method'),
  body('payment_reference').trim().notEmpty().withMessage('Payment reference is required')
];

const createBookingForTripValidation = [
  body('firstname').trim().notEmpty().withMessage('First name is required'),
  body('lastname').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('seat_count').isInt({ min: 1, max: 10 }).withMessage('Seat count must be between 1 and 10'),
  body('payment_method').isIn(['cash', 'gcash', 'paymaya', 'online']).withMessage('Invalid payment method'),
  body('payment_reference').trim().notEmpty().withMessage('Payment reference is required')
];

const emailValidation = [
  param('email').isEmail().withMessage('Valid email is required')
];

// Routes

// Get all active routes
router.get('/routes', bookingsController.getRoutes);

// Get next available trip for a route
router.get('/routes/:route_id/next-trip', bookingsController.getNextAvailableTrip);

// Get all available trips
router.get('/trips/available', bookingsController.getAvailableTrips);

// Get available trips by route
router.get('/trips/route/:route_id', bookingsController.getAvailableTripsByRoute);

// Create booking (smart booking - auto finds best trip)
router.post('/bookings', createBookingValidation, validate, bookingsController.createBooking);

// Create booking for specific trip
router.post('/bookings/trip/:trip_id', createBookingForTripValidation, validate, bookingsController.createBookingForTrip);

// Get booking details
router.get('/bookings/:id', bookingsController.getBookingDetails);

// Get booking by reference number
router.get('/bookings/reference/:booking_id', bookingsController.getBookingByReference);

// Cancel booking
router.post('/bookings/:id/cancel', bookingsController.cancelBooking);

// Search bookings by email
router.get('/bookings/search/email/:email', emailValidation, validate, bookingsController.searchBookingsByEmail);

module.exports = router;

// Track booking by ticket reference
router.get('/bookings/track/:ticket_reference', bookingsController.trackBookingByReference);

// @desc    Track booking by ticket reference
// @route   GET /api/passenger/bookings/track/:ticket_reference
// @access  Public
exports.trackBookingByReference = async (req, res) => {
  try {
    const [booking] = await db.query(
      'CALL get_booking_by_ticket_reference(?)',
      [req.params.ticket_reference]
    );

    if (booking[0].length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found with this ticket reference'
      });
    }

    res.json({
      success: true,
      data: booking[0][0]
    });
  } catch (error) {
    console.error('Track booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error tracking booking'
    });
  }
};
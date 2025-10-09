const db = require('../../config/database');

// @desc    Get available trips
// @route   GET /api/passenger/trips/available
// @access  Public
exports.getAvailableTrips = async (req, res) => {
  try {
    const [trips] = await db.query('CALL get_available_trips()');
    
    res.json({
      success: true,
      count: trips[0].length,
      data: trips[0]
    });
  } catch (error) {
    console.error('Get available trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available trips'
    });
  }
};

// @desc    Get available trips by route
// @route   GET /api/passenger/trips/route/:route_id
// @access  Public
exports.getAvailableTripsByRoute = async (req, res) => {
  try {
    const [trips] = await db.query(
      `SELECT 
        t.trip_id,
        t.estimated_departure_time,
        t.seats_available,
        t.capacity,
        t.fare_price,
        t.trip_status,
        t.queue_position,
        r.route_id,
        r.origin,
        r.destination,
        r.estimated_duration_minutes,
        v.vehicle_type,
        v.plate_number,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      JOIN users u ON t.driver_id = u.user_id
      WHERE t.route_id = ?
        AND t.is_accepting_bookings = TRUE
        AND t.trip_status IN ('boarding', 'full')
        AND r.status = 'active'
      ORDER BY t.estimated_departure_time`,
      [req.params.route_id]
    );

    res.json({
      success: true,
      count: trips.length,
      data: trips
    });
  } catch (error) {
    console.error('Get trips by route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trips for this route'
    });
  }
};

// @desc    Create booking (smart booking - auto finds best trip)
// @route   POST /api/passenger/bookings
// @access  Public
exports.createBooking = async (req, res) => {
  const {
    route_id,
    firstname,
    lastname,
    email,
    phone,
    address,
    seat_count,
    payment_method,
    payment_reference
  } = req.body;

  try {
    const [result] = await db.query(
      'CALL smart_booking(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        route_id,
        firstname,
        lastname,
        email,
        phone,
        address,
        seat_count,
        'online',
        payment_method,
        payment_reference
      ]
    );

    // The stored procedure now returns ticket_reference
    const bookingData = result[0][0];
    
    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking_id: bookingData.booking_id,
        trip_id: bookingData.trip_id,
        total_amount: bookingData.total_amount,
        ticket_reference: bookingData.ticket_reference // Now included!
      }
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error creating booking'
    });
  }
};
// @desc    Create booking for specific trip
// @route   POST /api/passenger/bookings/trip/:trip_id
// @access  Public
exports.createBookingForTrip = async (req, res) => {
  const {
    firstname,
    lastname,
    email,
    phone,
    address,
    seat_count,
    payment_method,
    payment_reference
  } = req.body;

  const trip_id = req.params.trip_id;

  try {
    const [result] = await db.query(
      'CALL create_booking(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        trip_id,
        firstname,
        lastname,
        email,
        phone,
        address,
        seat_count,
        'online',
        payment_method,
        payment_reference
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: result[0][0]
    });
  } catch (error) {
    console.error('Create booking for trip error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error creating booking'
    });
  }
};

// @desc    Get booking details
// @route   GET /api/passenger/bookings/:id
// @access  Public
exports.getBookingDetails = async (req, res) => {
  try {
    const [booking] = await db.query(
      'CALL get_booking_details(?)',
      [req.params.id]
    );

    if (booking[0].length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking[0][0]
    });
  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking details'
    });
  }
};

// @desc    Cancel booking
// @route   POST /api/passenger/bookings/:id/cancel
// @access  Public
exports.cancelBooking = async (req, res) => {
  try {
    await db.query('CALL cancel_booking(?)', [req.params.id]);
    
    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error cancelling booking'
    });
  }
};

// @desc    Search bookings by email
// @route   GET /api/passenger/bookings/search/email/:email
// @access  Public
exports.searchBookingsByEmail = async (req, res) => {
  try {
    const [bookings] = await db.query(
      `SELECT * FROM view_active_bookings 
       WHERE passenger_email = ? 
       ORDER BY booking_date DESC`,
      [req.params.email]
    );

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('Search bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching bookings'
    });
  }
};

// @desc    Get booking by reference number
// @route   GET /api/passenger/bookings/reference/:booking_id
// @access  Public
exports.getBookingByReference = async (req, res) => {
  try {
    const [booking] = await db.query(
      `SELECT 
        b.booking_id,
        b.trip_id,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_email,
        b.passenger_phone,
        b.passenger_address,
        b.seat_count,
        b.booking_type,
        b.payment_status,
        b.total_amount,
        b.booking_date,
        t.estimated_departure_time,
        t.actual_departure_datetime,
        t.actual_arrival_datetime,
        t.trip_status,
        t.seats_available,
        t.capacity,
        r.origin,
        r.destination,
        r.fare_price,
        r.estimated_duration_minutes,
        v.plate_number,
        v.vehicle_type,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.phone_number AS driver_phone
      FROM bookings b
      JOIN trips t ON b.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      LEFT JOIN users u ON t.driver_id = u.user_id
      WHERE b.booking_id = ?`,
      [req.params.booking_id]
    );

    if (booking.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking[0]
    });
  } catch (error) {
    console.error('Get booking by reference error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking'
    });
  }
};

// @desc    Get all routes
// @route   GET /api/passenger/routes
// @access  Public
exports.getRoutes = async (req, res) => {
  try {
    const [routes] = await db.query(
      `SELECT 
        route_id,
        origin,
        destination,
        distance_km,
        estimated_duration_minutes,
        fare_price,
        status
      FROM routes
      WHERE status = 'active'
      ORDER BY destination`
    );

    res.json({
      success: true,
      count: routes.length,
      data: routes
    });
  } catch (error) {
    console.error('Get routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes'
    });
  }
};

// @desc    Get next available trip for route
// @route   GET /api/passenger/routes/:route_id/next-trip
// @access  Public
exports.getNextAvailableTrip = async (req, res) => {
  try {
    const [trip] = await db.query(
      `SELECT 
        t.trip_id,
        t.estimated_departure_time,
        t.seats_available,
        t.capacity,
        t.fare_price,
        t.trip_status,
        t.queue_position,
        r.origin,
        r.destination,
        r.estimated_duration_minutes,
        v.vehicle_type,
        v.plate_number,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      JOIN users u ON t.driver_id = u.user_id
      WHERE t.route_id = ?
        AND t.is_accepting_bookings = TRUE
        AND t.trip_status IN ('boarding')
        AND r.status = 'active'
      ORDER BY t.queue_position
      LIMIT 1`,
      [req.params.route_id]
    );

    if (trip.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No available trips for this route'
      });
    }

    res.json({
      success: true,
      data: trip[0]
    });
  } catch (error) {
    console.error('Get next trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching next available trip'
    });
  }
};
// Track Booking by Reference Number
exports.trackBookingByReference = async (req, res) => {
  try {
    const [booking] = await db.query(
      'CALL get_booking_by_ticket_reference(?)',
      [req.params.ticket_reference]
    );

    if (booking[0].length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
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
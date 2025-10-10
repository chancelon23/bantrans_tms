const db = require('../../config/database');

// ==================== QUEUE MANAGEMENT ====================

// @desc    Get queue status for all routes
// @route   GET /api/dispatcher/queue
// @access  Private (Dispatcher/Admin)
exports.getQueueStatus = async (req, res) => {
  try {
    const [queue] = await db.query('SELECT * FROM view_queue_status ORDER BY route_id, queue_position');
    
    // Group by route
    const queueByRoute = queue.reduce((acc, trip) => {
      if (!acc[trip.route_id]) {
        acc[trip.route_id] = {
          route_id: trip.route_id,
          origin: trip.origin,
          destination: trip.destination,
          trips: []
        };
      }
      acc[trip.route_id].trips.push(trip);
      return acc;
    }, {});

    res.json({
      success: true,
      data: Object.values(queueByRoute)
    });
  } catch (error) {
    console.error('Get queue status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching queue status'
    });
  }
};

// @desc    Get queue status for specific route
// @route   GET /api/dispatcher/queue/route/:route_id
// @access  Private (Dispatcher/Admin)
exports.getQueueByRoute = async (req, res) => {
  try {
    const [queue] = await db.query(
      'SELECT * FROM view_queue_status WHERE route_id = ? ORDER BY queue_position',
      [req.params.route_id]
    );

    res.json({
      success: true,
      count: queue.length,
      data: queue
    });
  } catch (error) {
    console.error('Get queue by route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching queue for this route'
    });
  }
};

// ==================== TRIP CREATION ====================

// @desc    Create new trip in queue
// @route   POST /api/dispatcher/trips
// @access  Private (Dispatcher/Admin)
exports.createTrip = async (req, res) => {
  const { route_id, vehicle_id, driver_id, estimated_departure } = req.body;

  try {
    const [result] = await db.query(
      'CALL create_trip_in_queue(?, ?, ?, ?)',
      [route_id, vehicle_id, driver_id, estimated_departure]
    );

    res.status(201).json({
      success: true,
      message: 'Trip created successfully in queue',
      data: {
        trip_id: result[0][0].trip_id
      }
    });
  } catch (error) {
    console.error('Create trip error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error creating trip'
    });
  }
};

// @desc    Get trip details with manifest
// @route   GET /api/dispatcher/trips/:id
// @access  Private (Dispatcher/Admin)
exports.getTripDetails = async (req, res) => {
  try {
    // Get trip details
    const [tripDetails] = await db.query(
      `SELECT 
        t.trip_id,
        t.queue_position,
        t.is_accepting_bookings,
        t.estimated_departure_time,
        t.actual_departure_datetime,
        t.capacity,
        t.seats_booked,
        t.seats_available,
        t.trip_status,
        t.fare_price,
        r.route_id,
        r.origin,
        r.destination,
        r.distance_km,
        r.estimated_duration_minutes,
        v.vehicle_id,
        v.plate_number,
        v.vehicle_type,
        v.capacity as vehicle_capacity,
        u.user_id as driver_id,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.phone_number as driver_phone
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      LEFT JOIN users u ON t.driver_id = u.user_id
      WHERE t.trip_id = ?`,
      [req.params.id]
    );

    if (tripDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    // Get passenger manifest
    const [manifest] = await db.query(
      `SELECT 
        b.booking_id,
        b.ticket_reference,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_phone,
        b.passenger_email,
        b.seat_count,
        b.booking_type,
        b.payment_status,
        b.total_amount,
        b.booking_date
      FROM bookings b
      WHERE b.trip_id = ? AND b.payment_status = 'paid'
      ORDER BY b.booking_date`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        trip: tripDetails[0],
        manifest: manifest,
        total_passengers: manifest.reduce((sum, b) => sum + b.seat_count, 0)
      }
    });
  } catch (error) {
    console.error('Get trip details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trip details'
    });
  }
};

// ==================== QUEUE OPERATIONS ====================

// @desc    Mark trip as departed and advance queue
// @route   POST /api/dispatcher/trips/:id/depart
// @access  Private (Dispatcher/Admin)
exports.markTripDeparted = async (req, res) => {
  try {
    await db.query('CALL advance_queue(?)', [req.params.id]);

    res.json({
      success: true,
      message: 'Trip marked as departed and queue advanced successfully'
    });
  } catch (error) {
    console.error('Mark trip departed error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error marking trip as departed'
    });
  }
};

// @desc    Reassign vehicle to trip
// @route   PUT /api/dispatcher/trips/:id/reassign-vehicle
// @access  Private (Dispatcher/Admin)
exports.reassignVehicle = async (req, res) => {
  const { vehicle_id } = req.body;

  try {
    // Get vehicle capacity
    const [vehicle] = await db.query(
      'SELECT capacity FROM vehicles WHERE vehicle_id = ?',
      [vehicle_id]
    );

    if (vehicle.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Update trip
    await db.query(
      'UPDATE trips SET assigned_vehicle_id = ?, capacity = ? WHERE trip_id = ?',
      [vehicle_id, vehicle[0].capacity, req.params.id]
    );

    res.json({
      success: true,
      message: 'Vehicle reassigned successfully'
    });
  } catch (error) {
    console.error('Reassign vehicle error:', error);
    res.status(400).json({
      success: false,
      message: 'Error reassigning vehicle'
    });
  }
};

// @desc    Reassign driver to trip
// @route   PUT /api/dispatcher/trips/:id/reassign-driver
// @access  Private (Dispatcher/Admin)
exports.reassignDriver = async (req, res) => {
  const { driver_id } = req.body;

  try {
    // Verify driver exists and is available
    const [driver] = await db.query(
      `SELECT u.user_id, dd.driver_status 
       FROM users u
       JOIN driver_details dd ON u.user_id = dd.driver_id
       WHERE u.user_id = ? AND u.role = 'driver'`,
      [driver_id]
    );

    if (driver.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Update trip
    await db.query(
      'UPDATE trips SET driver_id = ? WHERE trip_id = ?',
      [driver_id, req.params.id]
    );

    res.json({
      success: true,
      message: 'Driver reassigned successfully'
    });
  } catch (error) {
    console.error('Reassign driver error:', error);
    res.status(400).json({
      success: false,
      message: 'Error reassigning driver'
    });
  }
};

// ==================== WALK-IN BOOKING MANAGEMENT ====================

// @desc    Create walk-in booking
// @route   POST /api/dispatcher/bookings/walk-in
// @access  Private (Dispatcher/Admin)
exports.createWalkInBooking = async (req, res) => {
  const {
    trip_id,
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
      'CALL create_booking(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        trip_id,
        firstname,
        lastname,
        email,
        phone,
        address,
        seat_count,
        'walk-in',
        payment_method,
        payment_reference
      ]
    );

    const bookingData = result[0][0];

    res.status(201).json({
      success: true,
      message: 'Walk-in booking created successfully',
      data: {
        booking_id: bookingData.booking_id,
        trip_id: bookingData.trip_id,
        total_amount: bookingData.total_amount,
        ticket_reference: bookingData.ticket_reference
      }
    });
  } catch (error) {
    console.error('Create walk-in booking error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error creating walk-in booking'
    });
  }
};

// ==================== BOOKING MANAGEMENT ====================

// @desc    Get all active bookings
// @route   GET /api/dispatcher/bookings
// @access  Private (Dispatcher/Admin)
exports.getActiveBookings = async (req, res) => {
  try {
    const [bookings] = await db.query(
      `SELECT * FROM view_active_bookings 
       ORDER BY estimated_departure_time, booking_date`
    );

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('Get active bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active bookings'
    });
  }
};

// @desc    Get bookings for specific trip
// @route   GET /api/dispatcher/trips/:trip_id/bookings
// @access  Private (Dispatcher/Admin)
exports.getTripBookings = async (req, res) => {
  try {
    const [bookings] = await db.query(
      `SELECT * FROM view_active_bookings 
       WHERE trip_id = ? 
       ORDER BY booking_date`,
      [req.params.trip_id]
    );

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('Get trip bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trip bookings'
    });
  }
};

// @desc    Generate passenger manifest for trip
// @route   GET /api/dispatcher/trips/:trip_id/manifest
// @access  Private (Dispatcher/Admin)
exports.generateManifest = async (req, res) => {
  try {
    const [manifest] = await db.query(
      `SELECT 
        b.booking_id,
        b.ticket_reference,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_phone,
        b.passenger_email,
        b.passenger_address,
        b.seat_count,
        b.booking_type,
        b.payment_status,
        b.total_amount,
        b.booking_date
      FROM bookings b
      WHERE b.trip_id = ? AND b.payment_status = 'paid'
      ORDER BY b.booking_date`,
      [req.params.trip_id]
    );

    // Get trip details
    const [trip] = await db.query(
      `SELECT 
        t.trip_id,
        t.estimated_departure_time,
        t.seats_booked,
        t.capacity,
        r.origin,
        r.destination,
        v.plate_number,
        v.vehicle_type,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      LEFT JOIN users u ON t.driver_id = u.user_id
      WHERE t.trip_id = ?`,
      [req.params.trip_id]
    );

    if (trip.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    res.json({
      success: true,
      data: {
        trip_info: trip[0],
        passengers: manifest,
        total_passengers: manifest.reduce((sum, b) => sum + b.seat_count, 0),
        total_bookings: manifest.length
      }
    });
  } catch (error) {
    console.error('Generate manifest error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating passenger manifest'
    });
  }
};

// @desc    Search bookings by passenger name
// @route   GET /api/dispatcher/bookings/search/name/:name
// @access  Private (Dispatcher/Admin)
exports.searchBookingsByName = async (req, res) => {
  try {
    const searchTerm = `%${req.params.name}%`;
    const [bookings] = await db.query(
      `SELECT * FROM view_active_bookings 
       WHERE passenger_name LIKE ?
       ORDER BY booking_date DESC`,
      [searchTerm]
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

// @desc    Search bookings by email
// @route   GET /api/dispatcher/bookings/search/email/:email
// @access  Private (Dispatcher/Admin)
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

// @desc    Search bookings by ticket reference
// @route   GET /api/dispatcher/bookings/search/ticket/:ticket_reference
// @access  Private (Dispatcher/Admin)
exports.searchBookingsByTicket = async (req, res) => {
  try {
    const [bookings] = await db.query(
      `SELECT * FROM view_active_bookings 
       WHERE ticket_reference = ?`,
      [req.params.ticket_reference]
    );

    if (bookings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: bookings[0]
    });
  } catch (error) {
    console.error('Search booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching booking'
    });
  }
};

// @desc    Verify payment status
// @route   GET /api/dispatcher/bookings/:id/payment-status
// @access  Private (Dispatcher/Admin)
exports.verifyPaymentStatus = async (req, res) => {
  try {
    const [payment] = await db.query(
      `SELECT 
        p.payment_id,
        p.booking_id,
        p.amount,
        p.payment_method,
        p.payment_reference,
        p.payment_datetime,
        b.payment_status,
        b.ticket_reference,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name
      FROM payment_log p
      JOIN bookings b ON p.booking_id = b.booking_id
      WHERE p.booking_id = ?
      ORDER BY p.payment_datetime DESC
      LIMIT 1`,
      [req.params.id]
    );

    if (payment.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment information not found'
      });
    }

    res.json({
      success: true,
      data: payment[0]
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment status'
    });
  }
};

// @desc    Cancel booking with refund
// @route   POST /api/dispatcher/bookings/:id/cancel
// @access  Private (Dispatcher/Admin)
exports.cancelBooking = async (req, res) => {
  try {
    await db.query('CALL cancel_booking(?)', [req.params.id]);

    res.json({
      success: true,
      message: 'Booking cancelled successfully with refund'
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(400).json({
      success: false,
      message: error.sqlMessage || 'Error cancelling booking'
    });
  }
};

// @desc    View cancellation history
// @route   GET /api/dispatcher/bookings/cancellations
// @access  Private (Dispatcher/Admin)
exports.getCancellationHistory = async (req, res) => {
  try {
    const [cancellations] = await db.query(
      `SELECT 
        b.booking_id,
        b.ticket_reference,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_email,
        b.passenger_phone,
        b.seat_count,
        b.total_amount,
        b.booking_date,
        b.updated_at as cancellation_date,
        t.trip_id,
        r.origin,
        r.destination,
        t.estimated_departure_time
      FROM bookings b
      JOIN trips t ON b.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE b.payment_status = 'cancelled'
      ORDER BY b.updated_at DESC
      LIMIT 50`,
      []
    );

    res.json({
      success: true,
      count: cancellations.length,
      data: cancellations
    });
  } catch (error) {
    console.error('Get cancellation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cancellation history'
    });
  }
};

// ==================== REAL-TIME MONITORING ====================

// @desc    Monitor live queue status
// @route   GET /api/dispatcher/monitor/queue
// @access  Private (Dispatcher/Admin)
exports.monitorLiveQueue = async (req, res) => {
  try {
    const [queue] = await db.query(
      `SELECT * FROM view_queue_status 
       WHERE trip_status IN ('waiting', 'boarding', 'full')
       ORDER BY route_id, queue_position`
    );

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: queue
    });
  } catch (error) {
    console.error('Monitor queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Error monitoring queue'
    });
  }
};

// @desc    Check seat availability for all trips
// @route   GET /api/dispatcher/monitor/seat-availability
// @access  Private (Dispatcher/Admin)
exports.checkSeatAvailability = async (req, res) => {
  try {
    const [availability] = await db.query(
      `SELECT 
        t.trip_id,
        t.queue_position,
        t.capacity,
        t.seats_booked,
        t.seats_available,
        t.trip_status,
        t.estimated_departure_time,
        r.origin,
        r.destination,
        v.plate_number
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.trip_status IN ('boarding', 'full')
      ORDER BY r.route_id, t.queue_position`
    );

    res.json({
      success: true,
      data: availability
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking seat availability'
    });
  }
};

// @desc    Track bookings in real-time
// @route   GET /api/dispatcher/monitor/bookings
// @access  Private (Dispatcher/Admin)
exports.trackBookingsRealtime = async (req, res) => {
  try {
    const [recentBookings] = await db.query(
      `SELECT 
        b.booking_id,
        b.ticket_reference,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.seat_count,
        b.booking_type,
        b.total_amount,
        b.booking_date,
        t.trip_id,
        r.destination,
        t.estimated_departure_time,
        t.seats_available
      FROM bookings b
      JOIN trips t ON b.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE b.payment_status = 'paid'
        AND t.trip_status IN ('boarding', 'full')
      ORDER BY b.booking_date DESC
      LIMIT 20`
    );

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: recentBookings.length,
      data: recentBookings
    });
  } catch (error) {
    console.error('Track bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error tracking bookings'
    });
  }
};

// ==================== RESOURCE MANAGEMENT ====================

// @desc    Get all available drivers
// @route   GET /api/dispatcher/resources/drivers
// @access  Private (Dispatcher/Admin)
exports.getAvailableDrivers = async (req, res) => {
  try {
    const [drivers] = await db.query(
      `SELECT 
        u.user_id,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.email,
        u.phone_number,
        dd.license_number,
        dd.driver_status,
        dd.trips_completed,
        dd.total_distance_driven
      FROM users u
      JOIN driver_details dd ON u.user_id = dd.driver_id
      WHERE u.role = 'driver' 
        AND u.status = 'active'
        AND dd.driver_status IN ('available', 'off_duty')
      ORDER BY dd.driver_status, u.lastname`
    );

    res.json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Get available drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available drivers'
    });
  }
};

// @desc    Get driver status
// @route   GET /api/dispatcher/resources/drivers/:id/status
// @access  Private (Dispatcher/Admin)
exports.getDriverStatus = async (req, res) => {
  try {
    const [driver] = await db.query(
      `SELECT 
        u.user_id,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.phone_number,
        dd.driver_status,
        dd.trips_completed,
        t.trip_id,
        t.trip_status,
        r.origin,
        r.destination
      FROM users u
      JOIN driver_details dd ON u.user_id = dd.driver_id
      LEFT JOIN trips t ON u.user_id = t.driver_id 
        AND t.trip_status IN ('boarding', 'full', 'departed')
      LEFT JOIN routes r ON t.route_id = r.route_id
      WHERE u.user_id = ?`,
      [req.params.id]
    );

    if (driver.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.json({
      success: true,
      data: driver[0]
    });
  } catch (error) {
    console.error('Get driver status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver status'
    });
  }
};

// @desc    Get all available vehicles
// @route   GET /api/dispatcher/resources/vehicles
// @access  Private (Dispatcher/Admin)
exports.getAvailableVehicles = async (req, res) => {
  try {
    const [vehicles] = await db.query(
      `SELECT 
        vehicle_id,
        plate_number,
        make,
        model,
        year,
        vehicle_type,
        capacity,
        vehicle_status,
        last_maintenance_date
      FROM vehicles
      WHERE vehicle_status IN ('available', 'maintenance')
      ORDER BY vehicle_status, vehicle_type, plate_number`
    );

    res.json({
      success: true,
      count: vehicles.length,
      data: vehicles
    });
  } catch (error) {
    console.error('Get available vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available vehicles'
    });
  }
};

// @desc    Get vehicle status
// @route   GET /api/dispatcher/resources/vehicles/:id/status
// @access  Private (Dispatcher/Admin)
exports.getVehicleStatus = async (req, res) => {
  try {
    const [vehicle] = await db.query(
      `SELECT 
        v.vehicle_id,
        v.plate_number,
        v.vehicle_type,
        v.capacity,
        v.vehicle_status,
        t.trip_id,
        t.trip_status,
        r.origin,
        r.destination,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
      FROM vehicles v
      LEFT JOIN trips t ON v.vehicle_id = t.assigned_vehicle_id 
        AND t.trip_status IN ('boarding', 'full', 'departed')
      LEFT JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN users u ON t.driver_id = u.user_id
      WHERE v.vehicle_id = ?`,
      [req.params.id]
    );

    if (vehicle.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    res.json({
      success: true,
      data: vehicle[0]
    });
  } catch (error) {
    console.error('Get vehicle status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vehicle status'
    });
  }
};

// @desc    Check driver assignment history
// @route   GET /api/dispatcher/resources/drivers/:id/history
// @access  Private (Dispatcher/Admin)
exports.getDriverAssignmentHistory = async (req, res) => {
  try {
    const [history] = await db.query(
      `SELECT 
        t.trip_id,
        t.actual_departure_datetime,
        t.actual_arrival_datetime,
        t.trip_status,
        t.seats_booked,
        r.origin,
        r.destination,
        v.plate_number
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.driver_id = ?
      ORDER BY t.actual_departure_datetime DESC
      LIMIT 10`,
      [req.params.id]
    );

    res.json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('Get driver history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver assignment history'
    });
  }
};

// @desc    Check vehicle assignment history
// @route   GET /api/dispatcher/resources/vehicles/:id/history
// @access  Private (Dispatcher/Admin)
exports.getVehicleAssignmentHistory = async (req, res) => {
  try {
    const [history] = await db.query(
      `SELECT 
        t.trip_id,
        t.actual_departure_datetime,
        t.actual_arrival_datetime,
        t.trip_status,
        t.seats_booked,
        r.origin,
        r.destination,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN users u ON t.driver_id = u.user_id
      WHERE t.assigned_vehicle_id = ?
      ORDER BY t.actual_departure_datetime DESC
      LIMIT 10`,
      [req.params.id]
    );

    res.json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('Get vehicle history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vehicle assignment history'
    });
  }
};

// ==================== COMMUNICATION ====================

// @desc    View dispatcher notifications
// @route   GET /api/dispatcher/notifications
// @access  Private (Dispatcher/Admin)
exports.getNotifications = async (req, res) => {
  try {
    const [notifications] = await db.query(
      `SELECT 
        n.notification_id,
        n.title,
        n.body,
        n.created_at,
        un.is_read,
        un.read_at,
        CONCAT(u.firstname, ' ', u.lastname) AS created_by
      FROM user_notifications un
      JOIN notifications n ON un.notification_id = n.notification_id
      JOIN users u ON n.creator_id = u.user_id
      WHERE un.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 20`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      count: notifications.length,
      data: notifications
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
};

// @desc    Mark notification as read
// @route   PUT /api/dispatcher/notifications/:id/read
// @access  Private (Dispatcher/Admin)
exports.markNotificationAsRead = async (req, res) => {
  try {
    await db.query(
      `UPDATE user_notifications 
       SET is_read = TRUE, read_at = NOW()
       WHERE notification_id = ? AND user_id = ?`,
      [req.params.id, req.user.user_id]
    );

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read'
    });
  }
};

// @desc    Get driver contact information
// @route   GET /api/dispatcher/drivers/:id/contact
// @access  Private (Dispatcher/Admin)
exports.getDriverContact = async (req, res) => {
  try {
    const [driver] = await db.query(
      `SELECT 
        u.user_id,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.email,
        u.phone_number,
        dd.driver_status
      FROM users u
      JOIN driver_details dd ON u.user_id = dd.driver_id
      WHERE u.user_id = ? AND u.role = 'driver'`,
      [req.params.id]
    );

    if (driver.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.json({
      success: true,
      data: driver[0]
    });
  } catch (error) {
    console.error('Get driver contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver contact information'
    });
  }
};

// @desc    Get passenger contact information
// @route   GET /api/dispatcher/bookings/:id/passenger-contact
// @access  Private (Dispatcher/Admin)
exports.getPassengerContact = async (req, res) => {
  try {
    const [passenger] = await db.query(
      `SELECT 
        booking_id,
        CONCAT(passenger_firstname, ' ', passenger_lastname) AS passenger_name,
        passenger_email,
        passenger_phone,
        passenger_address
      FROM bookings
      WHERE booking_id = ?`,
      [req.params.id]
    );

    if (passenger.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: passenger[0]
    });
  } catch (error) {
    console.error('Get passenger contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching passenger contact information'
    });
  }
};
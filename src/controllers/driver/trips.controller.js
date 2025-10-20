const db = require('../../config/database');

// ==================== CURRENT TRIP ====================

// @desc    Get current assigned trip
// @route   GET /api/driver/trip/current
// @access  Private (Driver)
exports.getCurrentTrip = async (req, res) => {
  try {
    const [trip] = await db.query(
      `SELECT 
        t.trip_id,
        t.queue_position,
        t.estimated_departure_time,
        t.actual_departure_datetime,
        t.capacity,
        t.seats_booked,
        t.seats_available,
        t.trip_status,
        t.fare_price,
        t.estimated_trip_duration_minutes,
        r.route_id,
        r.origin,
        r.destination,
        r.distance_km,
        v.vehicle_id,
        v.plate_number,
        v.vehicle_type,
        v.make,
        v.model
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.driver_id = ?
        AND t.trip_status IN ('waiting', 'boarding', 'full', 'departed')
      ORDER BY t.estimated_departure_time
      LIMIT 1`,
      [req.user.user_id]
    );

    if (trip.length === 0) {
      return res.json({
        success: true,
        message: 'No active trip assigned',
        data: null
      });
    }

    res.json({
      success: true,
      data: trip[0]
    });
  } catch (error) {
    console.error('Get current trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching current trip'
    });
  }
};

// @desc    Get trip manifest (passenger list)
// @route   GET /api/driver/trip/:id/manifest
// @access  Private (Driver)
exports.getTripManifest = async (req, res) => {
  try {
    // Verify this trip is assigned to the logged-in driver
    const [tripCheck] = await db.query(
      'SELECT driver_id FROM trips WHERE trip_id = ?',
      [req.params.id]
    );

    if (tripCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    if (tripCheck[0].driver_id !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'This trip is not assigned to you'
      });
    }

    // Get manifest
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
        b.total_amount,
        b.booking_date
      FROM bookings b
      WHERE b.trip_id = ? AND b.payment_status = 'paid'
      ORDER BY b.booking_date`,
      [req.params.id]
    );

    // Get trip details
    const [trip] = await db.query(
      `SELECT 
        t.trip_id,
        t.estimated_departure_time,
        t.seats_booked,
        t.capacity,
        t.trip_status,
        r.origin,
        r.destination,
        v.plate_number
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.trip_id = ?`,
      [req.params.id]
    );

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
    console.error('Get trip manifest error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trip manifest'
    });
  }
};

// @desc    Mark trip as arrived
// @route   POST /api/driver/trip/:id/arrive
// @access  Private (Driver)
exports.markTripArrived = async (req, res) => {
  try {
    // Verify this trip is assigned to the logged-in driver
    const [tripCheck] = await db.query(
      'SELECT driver_id, trip_status FROM trips WHERE trip_id = ?',
      [req.params.id]
    );

    if (tripCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    if (tripCheck[0].driver_id !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'This trip is not assigned to you'
      });
    }

    if (tripCheck[0].trip_status !== 'departed') {
      return res.status(400).json({
        success: false,
        message: 'Trip must be departed before marking as arrived'
      });
    }

    // Mark as arrived using stored procedure
    await db.query('CALL mark_trip_arrived(?)', [req.params.id]);

    res.json({
      success: true,
      message: 'Trip marked as arrived successfully'
    });
  } catch (error) {
    console.error('Mark trip arrived error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking trip as arrived'
    });
  }
};

// ==================== TRIP MANAGEMENT ====================

// @desc    Get upcoming trips
// @route   GET /api/driver/trips/upcoming
// @access  Private (Driver)
exports.getUpcomingTrips = async (req, res) => {
  try {
    const [trips] = await db.query(
      `SELECT 
        t.trip_id,
        t.queue_position,
        t.estimated_departure_time,
        t.capacity,
        t.seats_booked,
        t.seats_available,
        t.trip_status,
        r.origin,
        r.destination,
        r.distance_km,
        r.estimated_duration_minutes,
        v.plate_number,
        v.vehicle_type
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.driver_id = ?
        AND t.trip_status IN ('waiting', 'boarding', 'full')
      ORDER BY t.estimated_departure_time`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      count: trips.length,
      data: trips
    });
  } catch (error) {
    console.error('Get upcoming trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching upcoming trips'
    });
  }
};

// @desc    Get trip history
// @route   GET /api/driver/trips/history
// @access  Private (Driver)
exports.getTripHistory = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const [trips] = await db.query(
      `SELECT 
        t.trip_id,
        t.actual_departure_datetime,
        t.actual_arrival_datetime,
        t.trip_status,
        t.seats_booked,
        t.capacity,
        t.fare_price,
        r.origin,
        r.destination,
        r.distance_km,
        v.plate_number,
        v.vehicle_type,
        TIMESTAMPDIFF(MINUTE, t.actual_departure_datetime, t.actual_arrival_datetime) as actual_duration_minutes
      FROM trips t
      JOIN routes r ON t.route_id = r.route_id
      LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
      WHERE t.driver_id = ?
        AND t.trip_status IN ('departed', 'arrived')
      ORDER BY t.actual_departure_datetime DESC
      LIMIT ?`,
      [req.user.user_id, parseInt(limit)]
    );

    res.json({
      success: true,
      count: trips.length,
      data: trips
    });
  } catch (error) {
    console.error('Get trip history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trip history'
    });
  }
};

// ==================== STATISTICS ====================

// @desc    Get driver statistics
// @route   GET /api/driver/stats
// @access  Private (Driver)
exports.getDriverStats = async (req, res) => {
  try {
    // Get driver details
    const [driverDetails] = await db.query(
      `SELECT 
        trips_completed,
        total_distance_driven,
        delayed_trips,
        driver_status
      FROM driver_details
      WHERE driver_id = ?`,
      [req.user.user_id]
    );

    // Get today's trips
    const [todayTrips] = await db.query(
      `SELECT COUNT(*) as count
       FROM trips
       WHERE driver_id = ?
         AND DATE(actual_departure_datetime) = CURDATE()
         AND trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    // Get this week's trips
    const [weekTrips] = await db.query(
      `SELECT COUNT(*) as count
       FROM trips
       WHERE driver_id = ?
         AND YEARWEEK(actual_departure_datetime, 1) = YEARWEEK(CURDATE(), 1)
         AND trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    // Get this month's trips
    const [monthTrips] = await db.query(
      `SELECT COUNT(*) as count
       FROM trips
       WHERE driver_id = ?
         AND YEAR(actual_departure_datetime) = YEAR(CURDATE())
         AND MONTH(actual_departure_datetime) = MONTH(CURDATE())
         AND trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    // Get average passengers per trip
    const [avgPassengers] = await db.query(
      `SELECT AVG(seats_booked) as average
       FROM trips
       WHERE driver_id = ?
         AND trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      data: {
        lifetime: driverDetails[0] || {
          trips_completed: 0,
          total_distance_driven: 0,
          delayed_trips: 0,
          driver_status: 'available'
        },
        today: {
          trips: todayTrips[0].count
        },
        this_week: {
          trips: weekTrips[0].count
        },
        this_month: {
          trips: monthTrips[0].count
        },
        performance: {
          average_passengers_per_trip: parseFloat(avgPassengers[0].average || 0).toFixed(2)
        }
      }
    });
  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver statistics'
    });
  }
};

// @desc    Get earnings summary
// @route   GET /api/driver/earnings
// @access  Private (Driver)
exports.getEarningsSummary = async (req, res) => {
  try {
    // Get today's earnings
    const [todayEarnings] = await db.query(
      `SELECT 
        COUNT(t.trip_id) as trips_count,
        SUM(b.total_amount) as total_earnings,
        SUM(b.seat_count) as passengers_transported
       FROM trips t
       LEFT JOIN bookings b ON t.trip_id = b.trip_id AND b.payment_status = 'paid'
       WHERE t.driver_id = ?
         AND DATE(t.actual_departure_datetime) = CURDATE()
         AND t.trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    // Get this week's earnings
    const [weekEarnings] = await db.query(
      `SELECT 
        COUNT(t.trip_id) as trips_count,
        SUM(b.total_amount) as total_earnings,
        SUM(b.seat_count) as passengers_transported
       FROM trips t
       LEFT JOIN bookings b ON t.trip_id = b.trip_id AND b.payment_status = 'paid'
       WHERE t.driver_id = ?
         AND YEARWEEK(t.actual_departure_datetime, 1) = YEARWEEK(CURDATE(), 1)
         AND t.trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    // Get this month's earnings
    const [monthEarnings] = await db.query(
      `SELECT 
        COUNT(t.trip_id) as trips_count,
        SUM(b.total_amount) as total_earnings,
        SUM(b.seat_count) as passengers_transported
       FROM trips t
       LEFT JOIN bookings b ON t.trip_id = b.trip_id AND b.payment_status = 'paid'
       WHERE t.driver_id = ?
         AND YEAR(t.actual_departure_datetime) = YEAR(CURDATE())
         AND MONTH(t.actual_departure_datetime) = MONTH(CURDATE())
         AND t.trip_status IN ('departed', 'arrived')`,
      [req.user.user_id]
    );

    res.json({
      success: true,
      data: {
        today: {
          trips: todayEarnings[0].trips_count,
          earnings: parseFloat(todayEarnings[0].total_earnings || 0),
          passengers: todayEarnings[0].passengers_transported || 0
        },
        this_week: {
          trips: weekEarnings[0].trips_count,
          earnings: parseFloat(weekEarnings[0].total_earnings || 0),
          passengers: weekEarnings[0].passengers_transported || 0
        },
        this_month: {
          trips: monthEarnings[0].trips_count,
          earnings: parseFloat(monthEarnings[0].total_earnings || 0),
          passengers: monthEarnings[0].passengers_transported || 0
        }
      }
    });
  } catch (error) {
    console.error('Get earnings summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching earnings summary'
    });
  }
};
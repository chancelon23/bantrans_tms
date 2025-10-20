const db = require('../../config/database');

// ==================== DASHBOARD ====================

// @desc    Get dashboard overview
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
exports.getDashboard = async (req, res) => {
  try {
    // Get today's stats
    const [todayRevenue] = await db.query(
      `SELECT SUM(amount) as total FROM payment_log WHERE DATE(payment_datetime) = CURDATE()`
    );

    const [todayBookings] = await db.query(
      `SELECT COUNT(*) as count FROM bookings WHERE DATE(booking_date) = CURDATE() AND payment_status = 'paid'`
    );

    const [activeTrips] = await db.query(
      `SELECT COUNT(*) as count FROM trips WHERE trip_status IN ('boarding', 'waiting', 'departed')`
    );

    const [totalUsers] = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN role = 'driver' THEN 1 ELSE 0 END) as drivers,
        SUM(CASE WHEN role = 'dispatcher' THEN 1 ELSE 0 END) as dispatchers,
        SUM(CASE WHEN role = 'passenger' THEN 1 ELSE 0 END) as passengers
      FROM users WHERE status = 'active'`
    );

    const [recentBookings] = await db.query(
      `SELECT * FROM view_active_bookings ORDER BY booking_date DESC LIMIT 10`
    );

    res.json({
      success: true,
      data: {
        revenue: {
          today: todayRevenue[0].total || 0
        },
        bookings: {
          today: todayBookings[0].count
        },
        trips: {
          active: activeTrips[0].count
        },
        users: totalUsers[0],
        recent_bookings: recentBookings
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
};

// ==================== REPORTS ====================

// @desc    Get revenue report
// @route   GET /api/admin/reports/revenue
// @access  Private (Admin)
exports.getRevenueReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const [report] = await db.query(
      'CALL get_revenue_report(?, ?)',
      [start_date || '2025-10-01', end_date || '2025-12-31']
    );

    res.json({
      success: true,
      count: report[0].length,
      data: report[0]
    });
  } catch (error) {
    console.error('Get revenue report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching revenue report'
    });
  }
};

// @desc    Get trip statistics
// @route   GET /api/admin/reports/trips
// @access  Private (Admin)
exports.getTripStatistics = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const [stats] = await db.query(
      'CALL get_trip_statistics(?, ?)',
      [start_date || '2025-10-01', end_date || '2025-12-31']
    );

    res.json({
      success: true,
      count: stats[0].length,
      data: stats[0]
    });
  } catch (error) {
    console.error('Get trip statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching trip statistics'
    });
  }
};

// @desc    Get driver performance report
// @route   GET /api/admin/reports/drivers
// @access  Private (Admin)
exports.getDriverPerformanceReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const [performance] = await db.query(
      'CALL get_driver_performance_report(?, ?)',
      [start_date || '2025-10-01', end_date || '2025-12-31']
    );

    res.json({
      success: true,
      count: performance[0].length,
      data: performance[0]
    });
  } catch (error) {
    console.error('Get driver performance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver performance report'
    });
  }
};

// ==================== USER MANAGEMENT ====================

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private (Admin)
exports.getAllUsers = async (req, res) => {
  try {
    const { role, status } = req.query;
    
    let query = `
      SELECT 
        user_id,
        firstname,
        lastname,
        email,
        phone_number,
        role,
        status,
        created_at
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const [users] = await db.query(query, params);

    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
};

// @desc    Get user by ID
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
exports.getUserById = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT 
        user_id,
        firstname,
        lastname,
        email,
        phone_number,
        role,
        status,
        created_at,
        updated_at
      FROM users
      WHERE user_id = ?`,
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If driver, get driver details
    if (users[0].role === 'driver') {
      const [driverDetails] = await db.query(
        `SELECT * FROM driver_details WHERE driver_id = ?`,
        [req.params.id]
      );
      users[0].driver_details = driverDetails[0] || null;
    }

    res.json({
      success: true,
      data: users[0]
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
};

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
exports.updateUser = async (req, res) => {
  const { firstname, lastname, email, phone_number, role, status } = req.body;

  try {
    // Check if email is already used by another user
    const [existing] = await db.query(
      'SELECT user_id FROM users WHERE email = ? AND user_id != ?',
      [email, req.params.id]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already in use'
      });
    }

    await db.query(
      `UPDATE users 
       SET firstname = ?, lastname = ?, email = ?, phone_number = ?, role = ?, status = ?
       WHERE user_id = ?`,
      [firstname, lastname, email, phone_number, role, status, req.params.id]
    );

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
};

// @desc    Update user status
// @route   PUT /api/admin/users/:id/status
// @access  Private (Admin)
exports.updateUserStatus = async (req, res) => {
  const { status } = req.body;

  try {
    await db.query(
      'UPDATE users SET status = ? WHERE user_id = ?',
      [status, req.params.id]
    );

    res.json({
      success: true,
      message: 'User status updated successfully'
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user status'
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
exports.deleteUser = async (req, res) => {
  try {
    // Check if user exists
    const [users] = await db.query(
      'SELECT user_id FROM users WHERE user_id = ?',
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Don't allow deleting yourself
    if (parseInt(req.params.id) === req.user.user_id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    await db.query('DELETE FROM users WHERE user_id = ?', [req.params.id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user'
    });
  }
};

// ==================== ROUTE MANAGEMENT ====================

// @desc    Get all routes
// @route   GET /api/admin/routes
// @access  Private (Admin)
exports.getAllRoutes = async (req, res) => {
  try {
    const [routes] = await db.query(
      'SELECT * FROM routes ORDER BY destination'
    );

    res.json({
      success: true,
      count: routes.length,
      data: routes
    });
  } catch (error) {
    console.error('Get all routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes'
    });
  }
};

// @desc    Create route
// @route   POST /api/admin/routes
// @access  Private (Admin)
exports.createRoute = async (req, res) => {
  const { origin, destination, distance_km, estimated_duration_minutes, fare_price } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO routes (origin, destination, distance_km, estimated_duration_minutes, fare_price, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [origin, destination, distance_km, estimated_duration_minutes, fare_price]
    );

    res.status(201).json({
      success: true,
      message: 'Route created successfully',
      data: {
        route_id: result.insertId
      }
    });
  } catch (error) {
    console.error('Create route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating route'
    });
  }
};

// @desc    Update route
// @route   PUT /api/admin/routes/:id
// @access  Private (Admin)
exports.updateRoute = async (req, res) => {
  const { origin, destination, distance_km, estimated_duration_minutes, fare_price, status } = req.body;

  try {
    await db.query(
      `UPDATE routes 
       SET origin = ?, destination = ?, distance_km = ?, 
           estimated_duration_minutes = ?, fare_price = ?, status = ?
       WHERE route_id = ?`,
      [origin, destination, distance_km, estimated_duration_minutes, fare_price, status, req.params.id]
    );

    res.json({
      success: true,
      message: 'Route updated successfully'
    });
  } catch (error) {
    console.error('Update route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating route'
    });
  }
};

// @desc    Delete route
// @route   DELETE /api/admin/routes/:id
// @access  Private (Admin)
exports.deleteRoute = async (req, res) => {
  try {
    // Check if route has active trips
    const [activeTrips] = await db.query(
      `SELECT COUNT(*) as count FROM trips 
       WHERE route_id = ? AND trip_status IN ('waiting', 'boarding', 'departed')`,
      [req.params.id]
    );

    if (activeTrips[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete route with active trips'
      });
    }

    await db.query('DELETE FROM routes WHERE route_id = ?', [req.params.id]);

    res.json({
      success: true,
      message: 'Route deleted successfully'
    });
  } catch (error) {
    console.error('Delete route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting route'
    });
  }
};

// ==================== VEHICLE MANAGEMENT ====================

// @desc    Get all vehicles
// @route   GET /api/admin/vehicles
// @access  Private (Admin)
exports.getAllVehicles = async (req, res) => {
  try {
    const [vehicles] = await db.query(
      'SELECT * FROM vehicles ORDER BY plate_number'
    );

    res.json({
      success: true,
      count: vehicles.length,
      data: vehicles
    });
  } catch (error) {
    console.error('Get all vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vehicles'
    });
  }
};

// @desc    Create vehicle
// @route   POST /api/admin/vehicles
// @access  Private (Admin)
exports.createVehicle = async (req, res) => {
  const { plate_number, make, model, year, vehicle_type, capacity, brand } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO vehicles (plate_number, make, model, year, vehicle_type, capacity, brand, vehicle_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
      [plate_number, make, model, year, vehicle_type, capacity, brand]
    );

    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: {
        vehicle_id: result.insertId
      }
    });
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({
      success: false,
      message: error.code === 'ER_DUP_ENTRY' ? 'Plate number already exists' : 'Error creating vehicle'
    });
  }
};

// @desc    Update vehicle
// @route   PUT /api/admin/vehicles/:id
// @access  Private (Admin)
exports.updateVehicle = async (req, res) => {
  const { plate_number, make, model, year, vehicle_type, capacity, brand, vehicle_status, last_maintenance_date } = req.body;

  try {
    await db.query(
      `UPDATE vehicles 
       SET plate_number = ?, make = ?, model = ?, year = ?, 
           vehicle_type = ?, capacity = ?, brand = ?, 
           vehicle_status = ?, last_maintenance_date = ?
       WHERE vehicle_id = ?`,
      [plate_number, make, model, year, vehicle_type, capacity, brand, vehicle_status, last_maintenance_date, req.params.id]
    );

    res.json({
      success: true,
      message: 'Vehicle updated successfully'
    });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating vehicle'
    });
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/admin/vehicles/:id
// @access  Private (Admin)
exports.deleteVehicle = async (req, res) => {
  try {
    // Check if vehicle has active trips
    const [activeTrips] = await db.query(
      `SELECT COUNT(*) as count FROM trips 
       WHERE assigned_vehicle_id = ? AND trip_status IN ('waiting', 'boarding', 'departed')`,
      [req.params.id]
    );

    if (activeTrips[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vehicle with active trips'
      });
    }

    await db.query('DELETE FROM vehicles WHERE vehicle_id = ?', [req.params.id]);

    res.json({
      success: true,
      message: 'Vehicle deleted successfully'
    });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting vehicle'
    });
  }
};

// ==================== SYSTEM LOGS ====================

// @desc    Get system logs
// @route   GET /api/admin/logs
// @access  Private (Admin)
exports.getSystemLogs = async (req, res) => {
  try {
    const { limit = 100, action_type } = req.query;

    let query = `
      SELECT 
        l.log_id,
        l.action_type,
        l.description,
        l.ip_address,
        l.created_at,
        CONCAT(u.firstname, ' ', u.lastname) as user_name,
        u.role as user_role
      FROM system_log l
      LEFT JOIN users u ON l.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (action_type) {
      query += ' AND l.action_type = ?';
      params.push(action_type);
    }

    query += ' ORDER BY l.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const [logs] = await db.query(query, params);

    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('Get system logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching system logs'
    });
  }
};
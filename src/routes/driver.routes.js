const express = require('express');
const router = express.Router();
const tripsController = require('../controllers/driver/trips.controller');
const { protect } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// Apply auth and role middleware to all routes
router.use(protect);
router.use(authorize('driver'));

// ==================== CURRENT TRIP ====================
router.get('/trip/current', tripsController.getCurrentTrip);
router.get('/trip/:id/manifest', tripsController.getTripManifest);
router.post('/trip/:id/arrive', tripsController.markTripArrived);

// ==================== TRIP MANAGEMENT ====================
router.get('/trips/upcoming', tripsController.getUpcomingTrips);
router.get('/trips/history', tripsController.getTripHistory);

// ==================== STATISTICS ====================
router.get('/stats', tripsController.getDriverStats);
router.get('/earnings', tripsController.getEarningsSummary);

module.exports = router;
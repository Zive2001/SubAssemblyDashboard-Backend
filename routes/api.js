const express = require('express');
const router = express.Router();
const productionService = require('../services/productionService');
const targetService = require('../services/targetService');





// Get current production data
router.get('/production', async (req, res) => {
  try {
    const data = await productionService.getCurrentProductionData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh production data (trigger the stored procedure)
router.post('/refresh', async (req, res) => {
  try {
    const pool = await require('../config/db').connectToDatabase();
    await pool.request().execute('RefreshProductionSummary');
    res.json({ success: true, message: 'Production data refreshed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add these new routes

// Get production data for a specific date
router.get('/production/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const data = await productionService.getProductionDataByDate(date);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get list of available dates
router.get('/available-dates', async (req, res) => {
  try {
    const dates = await productionService.getAvailableDates();
    res.json(dates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Set a target for a workcenter
router.post('/targets', async (req, res) => {
  try {
    const result = await targetService.setTarget(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get targets for a specific date
router.get('/targets/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const targets = await targetService.getTargetsByDate(date);
    res.json(targets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hourly targets for a specific date
router.get('/hourly-targets/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const targets = await targetService.getHourlyTargetsByDate(date);
    res.json(targets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get production data with target comparison
router.get('/production-targets/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const data = await targetService.getProductionWithTargets(date);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get distinct workcenters
router.get('/workcenters', async (req, res) => {
  try {
    const workcenters = await productionService.getDistinctWorkcenters();
    // Make sure to send proper JSON response
    res.json(workcenters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
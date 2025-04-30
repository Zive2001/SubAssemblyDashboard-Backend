// services/targetService.js
const { connectToDatabase, sql } = require('../config/db');
const { mapTimeSlotToPosition } = require('../utils/timeSlotMapper'); // Make sure this import is present!

class TargetService {
  // Create or update a target
  async setTarget(targetData) {
    try {
      const { targetDate, workcenter, shift, planQty, hours = 8, createdBy } = targetData;
      const pool = await connectToDatabase();
      
      // Check if the target already exists
      const checkResult = await pool.request()
        .input('targetDate', sql.Date, new Date(targetDate))
        .input('workcenter', sql.VarChar, workcenter)
        .input('shift', sql.VarChar, shift)
        .query(`
          SELECT id FROM WorkcenterTargets 
          WHERE targetDate = @targetDate AND workcenter = @workcenter AND shift = @shift
        `);
      
      if (checkResult.recordset.length > 0) {
        // Update existing target
        const result = await pool.request()
          .input('targetDate', sql.Date, new Date(targetDate))
          .input('workcenter', sql.VarChar, workcenter)
          .input('shift', sql.VarChar, shift)
          .input('planQty', sql.Int, planQty)
          .input('hours', sql.Int, hours)
          .input('updatedAt', sql.DateTime, new Date())
          .query(`
            UPDATE WorkcenterTargets
            SET planQty = @planQty, 
                hours = @hours, 
                updatedAt = @updatedAt
            WHERE targetDate = @targetDate 
              AND workcenter = @workcenter 
              AND shift = @shift
          `);
        
        return { id: checkResult.recordset[0].id, updated: true };
      } else {
        // Insert new target
        const result = await pool.request()
          .input('targetDate', sql.Date, new Date(targetDate))
          .input('workcenter', sql.VarChar, workcenter)
          .input('shift', sql.VarChar, shift)
          .input('planQty', sql.Int, planQty)
          .input('hours', sql.Int, hours)
          .input('createdBy', sql.VarChar, createdBy || 'system')
          .query(`
            INSERT INTO WorkcenterTargets (targetDate, workcenter, shift, planQty, hours, createdBy)
            VALUES (@targetDate, @workcenter, @shift, @planQty, @hours, @createdBy);
            
            SELECT SCOPE_IDENTITY() AS id;
          `);
        
        return { id: result.recordset[0].id, updated: false };
      }
    } catch (error) {
      console.error('Error setting target:', error);
      throw error;
    }
  }

  // Get targets for a specific date
  async getTargetsByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT 
            targetDate, 
            workcenter, 
            shift, 
            planQty, 
            hours
          FROM 
            WorkcenterTargets
          WHERE 
            targetDate = @date
          ORDER BY 
            workcenter, shift
        `);
      
      return result.recordset;
    } catch (error) {
      console.error('Error fetching targets:', error);
      throw error;
    }
  }

  // Get hourly targets for a specific date
  async getHourlyTargetsByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT 
            targetDate, 
            workcenter, 
            shift, 
            timeSlot, 
            targetQty
          FROM 
            vw_WorkcenterHourlyTargets
          WHERE 
            targetDate = @date
          ORDER BY 
            workcenter, shift, timeSlot
        `);
      
      return this.formatHourlyTargets(result.recordset);
    } catch (error) {
      console.error('Error fetching hourly targets:', error);
      throw error;
    }
  }

  // Format hourly targets to match the production data structure
  formatHourlyTargets(records) {
    // Get unique workcenters
    const workcenters = [...new Set(records.map(record => record.workcenter))].sort();
    
    // Initialize the data structure
    const formattedData = {
      Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0]))),
      Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0])))
    };
    
    // Fill in the target data
    records.forEach(record => {
      const { shift, timeSlot, workcenter, targetQty } = record;
      
      // Get the position based on the time slot mapping
      const position = mapTimeSlotToPosition(timeSlot, shift);
      
      if (position > 0 && position <= 8) {
        formattedData[shift][position-1][workcenter] = targetQty;
      }
    });
    
    return {
      workcenters,
      data: formattedData
    };
  }

  // Get production data with target comparison for a specific date
  async getProductionWithTargets(date) {
    try {
      const pool = await connectToDatabase();
      
      const query = `
        SELECT 
          p.productionDate,
          p.shift,
          p.timeSlot,
          p.workcenter,
          p.totalQty AS actualQty,
          t.targetQty,
          CASE
            WHEN t.targetQty IS NULL THEN 'grey'
            WHEN p.totalQty >= t.targetQty THEN 'green'
            WHEN p.totalQty >= t.targetQty * 0.8 THEN 'yellow'
            ELSE 'red'
          END AS status
        FROM 
          (SELECT 
            productionDate,
            shift,
            timeSlot,
            workcenter,
            SUM(totalQty) as totalQty
          FROM 
            ProductionSummary
          WHERE 
            productionDate = @date
          GROUP BY
            productionDate,
            shift,
            timeSlot,
            workcenter) p
        LEFT JOIN 
          vw_WorkcenterHourlyTargets t
        ON 
          p.productionDate = t.targetDate AND
          p.workcenter = t.workcenter AND
          p.shift = t.shift AND
          p.timeSlot = t.timeSlot
        ORDER BY 
          p.shift, p.timeSlot, p.workcenter
      `;
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(query);
      
      return this.formatDataWithTargets(result.recordset);
    } catch (error) {
      console.error('Error fetching production with targets:', error);
      throw error;
    }
  }

  // Format data with targets
  formatDataWithTargets(records) {
    // Get unique workcenters
    const workcenters = [...new Set(records.map(record => record.workcenter))].sort();
    
    // Initialize the data structure
    const formattedData = {
      Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { actual: 0, target: 0, status: 'grey' }]))),
      Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { actual: 0, target: 0, status: 'grey' }])))
    };
    
    // Fill in the data
    records.forEach(record => {
      const { shift, timeSlot, workcenter, actualQty, targetQty, status } = record;
      
      // Get the position based on the time slot mapping
      const position = mapTimeSlotToPosition(timeSlot, shift);
      
      if (position > 0 && position <= 8) {
        formattedData[shift][position-1][workcenter] = {
          actual: actualQty || 0,
          target: targetQty || 0,
          status: status
        };
      }
    });
    
    return {
      workcenters,
      data: formattedData
    };
  }
}

module.exports = new TargetService();
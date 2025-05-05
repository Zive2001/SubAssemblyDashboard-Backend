// services/targetService.js
const { connectToDatabase, sql } = require('../config/db');
const { mapTimeSlotToPosition } = require('../utils/timeSlotMapper');

class TargetService {
  // Create or update a target with optional time slot specific targets
  async setTarget(targetData) {
    try {
      const { 
        targetDate, 
        workcenter, 
        shift, 
        planQty, 
        hours = 8, 
        createdBy,
        teamMemberCount = 0,
        smv = 0,
        timeSlotTargets = null  // Optional specific time slot targets
      } = targetData;
      
      const pool = await connectToDatabase();
      let transaction = null;
      
      try {
        // Begin transaction for atomic operations
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        const request = new sql.Request(transaction);
        
        // Check if the target already exists
        const checkResult = await request
          .input('targetDate', sql.Date, new Date(targetDate))
          .input('workcenter', sql.VarChar, workcenter)
          .input('shift', sql.VarChar, shift)
          .query(`
            SELECT id FROM WorkcenterTargets 
            WHERE targetDate = @targetDate AND workcenter = @workcenter AND shift = @shift
          `);
        
        let targetId;
        let isUpdated = false;
        
        if (checkResult.recordset.length > 0) {
          // Update existing target
          targetId = checkResult.recordset[0].id;
          await request
            .input('id', sql.Int, targetId)
            .input('planQty', sql.Int, planQty)
            .input('hours', sql.Int, hours)
            .input('teamMemberCount', sql.Int, teamMemberCount)
            .input('smv', sql.Decimal, smv)
            .input('updatedAt', sql.DateTime, new Date())
            .query(`
              UPDATE WorkcenterTargets
              SET planQty = @planQty, 
                  hours = @hours,
                  teamMemberCount = @teamMemberCount,
                  smv = @smv,
                  updatedAt = @updatedAt
              WHERE id = @id
            `);
          
          isUpdated = true;
        } else {
          // Insert new target
          const insertResult = await request
            .input('targetDate', sql.Date, new Date(targetDate))
            .input('workcenter', sql.VarChar, workcenter)
            .input('shift', sql.VarChar, shift)
            .input('planQty', sql.Int, planQty)
            .input('hours', sql.Int, hours)
            .input('teamMemberCount', sql.Int, teamMemberCount)
            .input('smv', sql.Decimal, smv)
            .input('createdBy', sql.VarChar, createdBy || 'system')
            .query(`
              INSERT INTO WorkcenterTargets 
                (targetDate, workcenter, shift, planQty, hours, teamMemberCount, smv, createdBy)
              VALUES 
                (@targetDate, @workcenter, @shift, @planQty, @hours, @teamMemberCount, @smv, @createdBy);
              
              SELECT SCOPE_IDENTITY() AS id;
            `);
          
          targetId = insertResult.recordset[0].id;
        }
        
        // If time slot specific targets are provided, update them
        if (timeSlotTargets) {
          // First delete existing time slot targets
          await request
            .input('targetId', sql.Int, targetId)
            .query(`
              DELETE FROM WorkcenterTimeSlotTargets
              WHERE targetId = @targetId
            `);
          
          // Then insert the new ones
          for (const entry of timeSlotTargets) {
            const { timeSlot, targetQty } = entry;
            const position = mapTimeSlotToPosition(timeSlot, shift);
            
            await request
              .input('targetId', sql.Int, targetId)
              .input('timeSlot', sql.VarChar, timeSlot)
              .input('targetQty', sql.Int, targetQty)
              .input('position', sql.Int, position)
              .query(`
                INSERT INTO WorkcenterTimeSlotTargets (targetId, timeSlot, targetQty, position)
                VALUES (@targetId, @timeSlot, @targetQty, @position)
              `);
          }
        } else {
          // Calculate and store hourly targets automatically
          await this.calculateAndStoreHourlyTargets(request, targetId, planQty, hours, shift);
        }
        
        // Commit the transaction
        await transaction.commit();
        
        return { id: targetId, updated: isUpdated };
      } catch (error) {
        // If there's an error, roll back the transaction
        if (transaction) {
          await transaction.rollback();
        }
        throw error;
      }
    } catch (error) {
      console.error('Error setting target:', error);
      throw error;
    }
  }
  
  // Helper method to calculate and store hourly targets
  async calculateAndStoreHourlyTargets(request, targetId, planQty, hours, shift) {
    try {
      // Get the time slots for the shift
      const timeSlots = shift === 'Morning' 
        ? ['05:30-06:00', '06:00-07:00', '07:00-08:00', '08:00-09:30', '09:30-10:30', '10:30-11:30', '11:30-12:30', '12:30-13:30']
        : ['13:30-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:30', '18:30-19:30', '19:30-20:30', '20:30-21:30'];
      
      // Delete existing time slot targets
      await request
        .input('targetId', sql.Int, targetId)
        .query(`
          DELETE FROM WorkcenterTimeSlotTargets
          WHERE targetId = @targetId
        `);
      
      // Calculate and insert hourly targets
      for (const timeSlot of timeSlots) {
        const position = mapTimeSlotToPosition(timeSlot, shift);
        
        // Get the duration for this time slot
        let duration;
        switch (timeSlot) {
          case '05:30-06:00': case '13:30-14:00': duration = 30; break;
          case '08:00-09:30': case '17:00-18:30': duration = 90; break;
          default: duration = 60; break;
        }
        
        // Calculate the target quantity based on duration
        const targetQty = Math.round((planQty * (duration / 60.0)) / hours);
        
        await request
          .input('targetId', sql.Int, targetId)
          .input('timeSlot', sql.VarChar, timeSlot)
          .input('targetQty', sql.Int, targetQty)
          .input('position', sql.Int, position)
          .query(`
            INSERT INTO WorkcenterTimeSlotTargets (targetId, timeSlot, targetQty, position)
            VALUES (@targetId, @timeSlot, @targetQty, @position)
          `);
      }
    } catch (error) {
      console.error('Error calculating hourly targets:', error);
      throw error;
    }
  }

  // Get targets for a specific date with hourly breakdown
  async getTargetsByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT 
            wt.id as targetId,
            wt.targetDate, 
            wt.workcenter, 
            wt.shift, 
            wt.planQty, 
            wt.hours,
            wt.teamMemberCount,
            wt.smv
          FROM 
            WorkcenterTargets wt
          WHERE 
            wt.targetDate = @date
          ORDER BY 
            wt.workcenter, wt.shift
        `);
      
      const targets = result.recordset;
      
      // For each target, get the time slot specific targets
      for (const target of targets) {
        const timeSlotResult = await pool.request()
          .input('targetId', sql.Int, target.targetId)
          .query(`
            SELECT 
              timeSlot,
              targetQty,
              position
            FROM 
              WorkcenterTimeSlotTargets
            WHERE 
              targetId = @targetId
            ORDER BY 
              position
          `);
        
        target.timeSlotTargets = timeSlotResult.recordset;
      }
      
      return targets;
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
            wt.targetDate, 
            wt.workcenter, 
            wt.shift, 
            tst.timeSlot, 
            tst.targetQty
          FROM 
            WorkcenterTargets wt
          JOIN
            WorkcenterTimeSlotTargets tst ON wt.id = tst.targetId
          WHERE 
            wt.targetDate = @date
          ORDER BY 
            wt.workcenter, wt.shift, tst.position
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

  // Calculate efficiency based on output, SMV, and team member count
  calculateEfficiency(output, smv, teamMemberCount, workMinutes) {
    if (teamMemberCount <= 0 || workMinutes <= 0) {
      return 0;
    }
    
    // Efficiency = (SMV * Output) * 100 / (Team Members * Work Minutes)
    return (smv * output) * 100 / (teamMemberCount * workMinutes);
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
          tst.targetQty,
          wt.teamMemberCount,
          wt.smv,
          CASE
            WHEN tst.targetQty IS NULL THEN 'grey'
            WHEN p.totalQty >= tst.targetQty THEN 'green'
            WHEN p.totalQty >= tst.targetQty * 0.8 THEN 'yellow'
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
          WorkcenterTargets wt ON p.productionDate = wt.targetDate AND p.workcenter = wt.workcenter AND p.shift = wt.shift
        LEFT JOIN 
          WorkcenterTimeSlotTargets tst ON wt.id = tst.targetId AND p.timeSlot = tst.timeSlot
        ORDER BY 
          p.shift, tst.position, p.workcenter
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

  // Format data with targets and efficiency
  formatDataWithTargets(records) {
    // Get unique workcenters
    const workcenters = [...new Set(records.map(record => record.workcenter))].sort();
    
    // Initialize the data structure
    const formattedData = {
      Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { actual: 0, target: 0, efficiency: 0, status: 'grey' }]))),
      Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { actual: 0, target: 0, efficiency: 0, status: 'grey' }])))
    };
    
    // Fill in the data
    records.forEach(record => {
      const { shift, timeSlot, workcenter, actualQty, targetQty, status, teamMemberCount, smv } = record;
      
      // Get the position based on the time slot mapping
      const position = mapTimeSlotToPosition(timeSlot, shift);
      
      if (position > 0 && position <= 8) {
        // Get duration for efficiency calculation
        let duration;
        switch (timeSlot) {
          case '05:30-06:00': case '13:30-14:00': duration = 30; break;
          case '08:00-09:30': case '17:00-18:30': duration = 90; break;
          default: duration = 60; break;
        }
        
        // Calculate work minutes
        const workMinutes = teamMemberCount * duration;
        
        // Calculate efficiency
        const efficiency = this.calculateEfficiency(actualQty || 0, smv || 0, teamMemberCount || 0, workMinutes);
        
        formattedData[shift][position-1][workcenter] = {
          actual: actualQty || 0,
          target: targetQty || 0,
          efficiency: Math.round(efficiency * 100) / 100, // Round to 2 decimal places
          status: status
        };
      }
    });
    
    return {
      workcenters,
      data: formattedData
    };
  }

  // Get efficiency for a specific date
  async getEfficiencyByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const query = `
        SELECT 
          p.productionDate,
          p.shift,
          p.workcenter,
          SUM(p.totalQty) AS totalOutput,
          wt.smv,
          wt.teamMemberCount,
          wt.hours * 60 AS totalWorkMinutes
        FROM 
          (SELECT 
            productionDate,
            shift,
            workcenter,
            SUM(totalQty) as totalQty
          FROM 
            ProductionSummary
          WHERE 
            productionDate = @date
          GROUP BY
            productionDate,
            shift,
            workcenter) p
        LEFT JOIN 
          WorkcenterTargets wt ON p.productionDate = wt.targetDate AND p.workcenter = wt.workcenter AND p.shift = wt.shift
        GROUP BY
          p.productionDate,
          p.shift,
          p.workcenter,
          wt.smv,
          wt.teamMemberCount,
          wt.hours
        ORDER BY 
          p.shift, p.workcenter
      `;
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(query);
      
      const efficiencyData = result.recordset.map(record => {
        const efficiency = this.calculateEfficiency(
          record.totalOutput || 0, 
          record.smv || 0, 
          record.teamMemberCount || 0, 
          record.totalWorkMinutes || 0
        );
        
        return {
          ...record,
          efficiency: Math.round(efficiency * 100) / 100 // Round to 2 decimal places
        };
      });
      
      return efficiencyData;
    } catch (error) {
      console.error('Error fetching efficiency:', error);
      throw error;
    }
  }
}

module.exports = new TargetService();
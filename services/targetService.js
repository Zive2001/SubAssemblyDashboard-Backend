// services/targetService.js
const { connectToDatabase, sql } = require('../config/db');
const { mapTimeSlotToPosition } = require('../utils/timeSlotMapper');

class TargetService {
  /**
   * Create or update a target with hourly breakdown
   */
 // services/targetService.js - Fixed setTarget method
async setTarget(targetData) {
    try {
      const { 
        targetDate, 
        workcenter, 
        shift, 
        planQty, 
        hours = 8, 
        createdBy,
        teamMemberCount = 1,
        smv = 0,
        timeSlotTargets = null
      } = targetData;
      
      const pool = await connectToDatabase();
      let transaction = null;
      
      try {
        // Begin transaction for atomic operations
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        const request = new sql.Request(transaction);
        
        // Check if the target already exists
        // Use a different parameter name for each query
        request.input('checkDate', sql.Date, new Date(targetDate))
           .input('checkWorkcenter', sql.VarChar, workcenter)
           .input('checkShift', sql.VarChar, shift);
        
        const checkResult = await request.query(`
          SELECT id FROM WorkcenterTargets 
          WHERE targetDate = @checkDate AND workcenter = @checkWorkcenter AND shift = @checkShift
        `);
        
        let targetId;
        let isUpdated = false;
        
        if (checkResult.recordset.length > 0) {
          // Update existing target
          targetId = checkResult.recordset[0].id;
          
          // Create a new request for the update to avoid parameter conflicts
          const updateRequest = new sql.Request(transaction);
          updateRequest.input('id', sql.Int, targetId)
            .input('planQty', sql.Int, planQty)
            .input('hours', sql.Int, hours)
            .input('teamMemberCount', sql.Int, teamMemberCount)
            .input('smv', sql.Decimal, smv)
            .input('updatedAt', sql.DateTime, new Date());
          
          await updateRequest.query(`
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
          // Create a new request for the insert to avoid parameter conflicts
          const insertRequest = new sql.Request(transaction);
          insertRequest.input('insertDate', sql.Date, new Date(targetDate))
            .input('insertWorkcenter', sql.VarChar, workcenter)
            .input('insertShift', sql.VarChar, shift)
            .input('planQty', sql.Int, planQty)
            .input('hours', sql.Int, hours)
            .input('teamMemberCount', sql.Int, teamMemberCount)
            .input('smv', sql.Decimal, smv)
            .input('createdBy', sql.VarChar, createdBy || 'system');
          
          const insertResult = await insertRequest.query(`
            INSERT INTO WorkcenterTargets 
              (targetDate, workcenter, shift, planQty, hours, teamMemberCount, smv, createdBy)
            VALUES 
              (@insertDate, @insertWorkcenter, @insertShift, @planQty, @hours, @teamMemberCount, @smv, @createdBy);
            
            SELECT SCOPE_IDENTITY() AS id;
          `);
          
          targetId = insertResult.recordset[0].id;
        }
        
        // First delete existing time slot targets
        // Create a new request for the delete to avoid parameter conflicts
        const deleteRequest = new sql.Request(transaction);
        deleteRequest.input('targetId', sql.Int, targetId);
        
        await deleteRequest.query(`
          DELETE FROM WorkcenterTimeSlotTargets
          WHERE targetId = @targetId
        `);
        
        // Calculate and insert hourly targets
        // If timeSlotTargets is provided, use those values
        // Otherwise, calculate based on duration and total plan
        const timeSlots = shift === 'Morning' 
          ? ['05:30-06:00', '06:00-07:00', '07:00-08:00', '08:00-09:30', '09:30-10:30', '10:30-11:30', '11:30-12:30', '12:30-13:30']
          : ['13:30-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:30', '18:30-19:30', '19:30-20:30', '20:30-21:30'];
        
        // Calculate duration for each time slot
        const timeSlotDurations = {
          '05:30-06:00': 30, '13:30-14:00': 30,
          '08:00-09:30': 90, '17:00-18:30': 90,
          '06:00-07:00': 60, '07:00-08:00': 60, '09:30-10:30': 60, '10:30-11:30': 60, '11:30-12:30': 60, '12:30-13:30': 60,
          '14:00-15:00': 60, '15:00-16:00': 60, '16:00-17:00': 60, '18:30-19:30': 60, '19:30-20:30': 60, '20:30-21:30': 60
        };
        
        // Create time slot targets with quantities
        for (let i = 0; i < timeSlots.length; i++) {
          const timeSlot = timeSlots[i];
          const position = i + 1;
          const duration = timeSlotDurations[timeSlot];
          
          // Use provided target or calculate
          let targetQty;
          if (timeSlotTargets && timeSlotTargets[i] && typeof timeSlotTargets[i].targetQty === 'number') {
            targetQty = timeSlotTargets[i].targetQty;
          } else {
            // Calculate based on duration and total plan
            targetQty = Math.round((planQty * (duration / 60)) / hours);
          }
          
          // Insert time slot target - create a new request for each insert
          const slotRequest = new sql.Request(transaction);
          slotRequest.input('targetId', sql.Int, targetId)
            .input('timeSlot', sql.VarChar, timeSlot)
            .input('targetQty', sql.Int, targetQty)
            .input('position', sql.Int, position);
          
          await slotRequest.query(`
            INSERT INTO WorkcenterTimeSlotTargets (targetId, timeSlot, targetQty, position)
            VALUES (@targetId, @timeSlot, @targetQty, @position)
          `);
        }
        
        // Commit the transaction
        await transaction.commit();
        
        // Return the id and updated status
        return { 
          id: targetId, 
          updated: isUpdated,
          message: isUpdated ? 'Target updated successfully' : 'Target created successfully'
        };
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

  /**
   * Get targets for a specific date with hourly breakdown
   */
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

  /**
   * Get hourly targets for a specific date
   */
  async getHourlyTargetsByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      // Get all workcenters first
      const workcentersResult = await pool.request()
        .query(`
          SELECT DISTINCT workcenter FROM ProductionSummary
          UNION
          SELECT DISTINCT workcenter FROM WorkcenterTargets
          ORDER BY workcenter
        `);
      
      const workcenters = workcentersResult.recordset.map(r => r.workcenter);
      
      // Get hourly targets for the date
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          SELECT 
            wt.targetDate, 
            wt.workcenter, 
            wt.shift, 
            tst.timeSlot, 
            tst.targetQty,
            tst.position
          FROM 
            WorkcenterTargets wt
          JOIN
            WorkcenterTimeSlotTargets tst ON wt.id = tst.targetId
          WHERE 
            wt.targetDate = @date
          ORDER BY 
            wt.workcenter, wt.shift, tst.position
        `);
      
      // Format data to match expected structure
      const formattedData = {
        workcenters,
        data: {
          Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0]))),
          Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0])))
        }
      };
      
      // Fill in target data
      result.recordset.forEach(record => {
        const { shift, position, workcenter, targetQty } = record;
        
        // Adjust position to be 0-based index
        const index = position - 1;
        
        if (index >= 0 && index < 8 && (shift === 'Morning' || shift === 'Evening')) {
          formattedData.data[shift][index][workcenter] = targetQty;
        }
      });
      
      return formattedData;
    } catch (error) {
      console.error('Error fetching hourly targets:', error);
      throw error;
    }
  }

  /**
   * Calculate efficiency based on output, SMV, and team member count
   */
  calculateEfficiency(output, smv, teamMemberCount, workMinutes) {
    if (!output || !smv || teamMemberCount <= 0 || workMinutes <= 0) {
      return 0;
    }
    
    // Efficiency = (SMV * Output) * 100 / (Team Members * Work Minutes)
    return (smv * output) * 100 / (teamMemberCount * workMinutes);
  }

  /**
   * Get production data with target comparison for a specific date
   */
  async getProductionWithTargets(date) {
    try {
      const pool = await connectToDatabase();
      
      // Get all workcenters first to ensure consistent data structure
      const workcentersResult = await pool.request()
        .query(`
          SELECT DISTINCT workcenter FROM ProductionSummary
          UNION
          SELECT DISTINCT workcenter FROM WorkcenterTargets
          ORDER BY workcenter
        `);
      
      const workcenters = workcentersResult.recordset.map(r => r.workcenter);
      
      // Get all production data with targets, even if targets don't exist
      const query = `
        -- Get all time slots for the date and shift
        WITH AllTimeSlots AS (
            SELECT 
                @date AS productionDate,
                'Morning' AS shift,
                timeSlot,
                position
            FROM (
                VALUES 
                    ('05:30-06:00', 1),
                    ('06:00-07:00', 2),
                    ('07:00-08:00', 3),
                    ('08:00-09:30', 4),
                    ('09:30-10:30', 5),
                    ('10:30-11:30', 6),
                    ('11:30-12:30', 7),
                    ('12:30-13:30', 8)
            ) AS MorningSlots(timeSlot, position)
            
            UNION ALL
            
            SELECT 
                @date AS productionDate,
                'Evening' AS shift,
                timeSlot,
                position
            FROM (
                VALUES 
                    ('13:30-14:00', 1),
                    ('14:00-15:00', 2),
                    ('15:00-16:00', 3),
                    ('16:00-17:00', 4),
                    ('17:00-18:30', 5),
                    ('18:30-19:30', 6),
                    ('19:30-20:30', 7),
                    ('20:30-21:30', 8)
            ) AS EveningSlots(timeSlot, position)
        ),
        
        -- Get all workcenters
        AllWorkcenters AS (
            SELECT DISTINCT workcenter 
            FROM ProductionSummary
            
            UNION
            
            SELECT DISTINCT workcenter 
            FROM WorkcenterTargets
        ),
        
        -- Cartesian product of all time slots and workcenters
        AllCombinations AS (
            SELECT 
                ts.productionDate,
                ts.shift,
                ts.timeSlot,
                ts.position,
                wc.workcenter
            FROM 
                AllTimeSlots ts
            CROSS JOIN 
                AllWorkcenters wc
        )
        
        -- Final query joining with actual data
        SELECT 
            ac.productionDate,
            ac.shift,
            ac.timeSlot,
            ac.position,
            ac.workcenter,
            COALESCE(p.totalQty, 0) AS actualQty,
            COALESCE(tst.targetQty, 0) AS targetQty,
            wt.teamMemberCount,
            wt.smv,
            CASE
                WHEN tst.targetQty IS NULL OR tst.targetQty = 0 THEN 'grey'
                WHEN COALESCE(p.totalQty, 0) >= tst.targetQty THEN 'green'
                WHEN COALESCE(p.totalQty, 0) >= tst.targetQty * 0.8 THEN 'yellow'
                ELSE 'red'
            END AS status
        FROM 
            AllCombinations ac
        LEFT JOIN (
            SELECT 
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
                workcenter
        ) p ON 
            ac.productionDate = p.productionDate AND 
            ac.shift = p.shift AND 
            ac.timeSlot = p.timeSlot AND 
            ac.workcenter = p.workcenter
        LEFT JOIN 
            WorkcenterTargets wt ON 
            ac.productionDate = wt.targetDate AND 
            ac.workcenter = wt.workcenter AND 
            ac.shift = wt.shift
        LEFT JOIN 
            WorkcenterTimeSlotTargets tst ON 
            wt.id = tst.targetId AND 
            ac.timeSlot = tst.timeSlot
        ORDER BY 
            ac.shift, ac.position, ac.workcenter
      `;
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(query);
      
      // Format the data for the frontend
      const actualData = {
        Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0]))),
        Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0])))
      };
      
      const targetData = {
        Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { target: 0, efficiency: 0, status: 'grey' }]))),
        Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, { target: 0, efficiency: 0, status: 'grey' }])))
      };
      
      // Time slot durations in minutes
      const timeSlotDurations = {
        '05:30-06:00': 30, '13:30-14:00': 30,
        '08:00-09:30': 90, '17:00-18:30': 90,
        '06:00-07:00': 60, '07:00-08:00': 60, '09:30-10:30': 60, '10:30-11:30': 60, '11:30-12:30': 60, '12:30-13:30': 60,
        '14:00-15:00': 60, '15:00-16:00': 60, '16:00-17:00': 60, '18:30-19:30': 60, '19:30-20:30': 60, '20:30-21:30': 60
      };
      
      // Process the data
      result.recordset.forEach(record => {
        const { 
          shift, position, workcenter, 
          actualQty, targetQty, status, 
          teamMemberCount, smv, timeSlot 
        } = record;
        
        // Position is 1-based, so subtract 1 for array index
        const index = position - 1;
        
        if (index >= 0 && index < 8) {
          // Set actual quantity
          actualData[shift][index][workcenter] = actualQty || 0;
          
          // Calculate efficiency if we have the required data
          let efficiency = 0;
          if (teamMemberCount && smv && timeSlot) {
            const duration = timeSlotDurations[timeSlot] || 60;
            const workMinutes = teamMemberCount * duration;
            efficiency = this.calculateEfficiency(actualQty, smv, teamMemberCount, workMinutes);
          }
          
          // Set target data
          targetData[shift][index][workcenter] = {
            target: targetQty || 0,
            efficiency: Math.round(efficiency * 100) / 100, // Round to 2 decimal places
            status: status || 'grey'
          };
        }
      });
      
      return {
        workcenters,
        actualData,
        targetData
      };
    } catch (error) {
      console.error('Error fetching production with targets:', error);
      throw error;
    }
  }

  /**
   * Get efficiency data for a specific date
   */
  async getEfficiencyByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const query = `
        SELECT 
          p.productionDate,
          p.shift,
          p.workcenter,
          SUM(p.totalQty) AS totalOutput,
          wt.planQty AS totalTarget,
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
          wt.planQty,
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
          efficiency: Math.round(efficiency * 100) / 100, // Round to 2 decimal places
          achievementPercentage: record.totalTarget > 0 
            ? Math.round((record.totalOutput / record.totalTarget) * 100) 
            : 0
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
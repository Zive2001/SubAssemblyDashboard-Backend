// services/productionService.js
const { connectToDatabase, sql } = require('../config/db');
const { mapTimeSlotToPosition } = require('../utils/timeSlotMapper');

class ProductionService {
  // Get current day production data
  async getCurrentProductionData() {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .query(`
          SELECT 
            productionDate,
            shift,
            timeSlot,
            workcenter,
            subOperationId,
            SUM(totalQty) as totalQuantity
          FROM 
            ProductionSummary
          WHERE 
            productionDate = CAST(GETDATE() AS DATE)
          GROUP BY
            productionDate,
            shift,
            timeSlot,
            subOperationId,
            workcenter
          ORDER BY 
            shift, timeSlot
        `);
      
      return this.formatProductionData(result.recordset);
    } catch (error) {
      console.error('Error fetching production data:', error);
      throw error;
    }
  }

  // Get production data for a specific date
  async getProductionDataByDate(date) {
    try {
      const pool = await connectToDatabase();
      
      const query = `
        SELECT 
          productionDate,
          shift,
          timeSlot,
          workcenter,
          subOperationId,
          SUM(totalQty) as totalQuantity
        FROM 
          ProductionSummary
        WHERE 
          productionDate = @date
        GROUP BY
          productionDate,
          shift,
          timeSlot,
          subOperationId,
          workcenter
        ORDER BY 
          shift, timeSlot
      `;
      
      const result = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(query);
      
      return this.formatProductionData(result.recordset);
    } catch (error) {
      console.error('Error fetching production data for date:', error);
      throw error;
    }
  }

  // Get available dates
  async getAvailableDates() {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .query(`
          SELECT DISTINCT productionDate
          FROM ProductionSummary
          ORDER BY productionDate DESC
        `);
      
      return result.recordset.map(record => record.productionDate);
    } catch (error) {
      console.error('Error fetching available dates:', error);
      throw error;
    }
  }

  // Get distinct workcenters
  async getDistinctWorkcenters() {
    try {
      const pool = await connectToDatabase();
      
      const result = await pool.request()
        .query(`
          SELECT DISTINCT workcenter
          FROM ProductionSummary
          ORDER BY workcenter
        `);
      
      return result.recordset.map(record => record.workcenter);
    } catch (error) {
      console.error('Error fetching distinct workcenters:', error);
      throw error;
    }
  }

  // Format the data for the dashboard
  formatProductionData(records) {
    // Get unique workcenters
    const workcenters = [...new Set(records.map(record => record.workcenter))].sort();
    
    // Initialize the data structure
    const formattedData = {
      Morning: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0]))),
      Evening: Array(8).fill(0).map(() => Object.fromEntries(workcenters.map(wc => [wc, 0])))
    };
    
    // Fill in the data
    records.forEach(record => {
      const { shift, timeSlot, workcenter, totalQuantity } = record;
      
      if (!shift || !timeSlot || !workcenter) return;
      
      // Get the position based on the time slot mapping
      const position = mapTimeSlotToPosition(timeSlot, shift);
      
      // Handle the special case for 'Other' time slots
      if (timeSlot === 'Other') {
        console.log(`Found 'Other' time slot data for ${workcenter} with quantity ${totalQuantity}`);
        // Assign to the last time slot (8) for visibility
        if (shift === 'Morning' || shift === 'Evening') {
          formattedData[shift][7][workcenter] = 
            (formattedData[shift][7][workcenter] || 0) + totalQuantity;
        }
      } 
      // Handle regular mapped positions
      else if (position > 0 && position <= 8) {
        // Add to existing quantity
        const index = position - 1;
        formattedData[shift][index][workcenter] = 
          (formattedData[shift][index][workcenter] || 0) + totalQuantity;
      } 
    });
    
    return {
      workcenters,
      data: formattedData
    };
  }

  // Set up polling to check for new data
  async pollForChanges(callback, interval = 60000) {
    let lastData = await this.getCurrentProductionData();
    callback(lastData);
    
    setInterval(async () => {
      try {
        const newData = await this.getCurrentProductionData();
        // Only emit if there are changes
        if (JSON.stringify(newData) !== JSON.stringify(lastData)) {
          lastData = newData;
          callback(newData);
        }
      } catch (error) {
        console.error('Error polling for changes:', error);
      }
    }, interval);
  }
}

module.exports = new ProductionService();
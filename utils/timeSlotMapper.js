//utils/timeSlotMapper.js
// Updated time slots based on new requirements
const morningTimeSlots = {
  '05:30-06:00': 1,
  '06:00-07:00': 2,
  '07:00-08:00': 3,
  '08:00-09:30': 4,
  '09:30-10:30': 5,
  '10:30-11:30': 6,
  '11:30-12:30': 7,
  '12:30-13:30': 8
};

const eveningTimeSlots = {
  '13:30-14:00': 1,
  '14:00-15:00': 2,
  '15:00-16:00': 3,
  '16:00-17:00': 4,
  '17:00-18:30': 5,
  '18:30-19:30': 6,
  '19:30-20:30': 7,
  '20:30-21:30': 8
};

const mapTimeSlotToPosition = (timeSlot, shift) => {
  if (shift === 'Morning') {
    return morningTimeSlots[timeSlot] || 0;
  } else if (shift === 'Evening') {
    return eveningTimeSlots[timeSlot] || 0;
  }
  return 0;
};

module.exports = { mapTimeSlotToPosition };
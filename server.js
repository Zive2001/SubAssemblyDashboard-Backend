const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const apiRoutes = require('./routes/api');
const productionService = require('./services/productionService');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

// Socket.IO connection
io.on('connection', (socket) => {
  
  console.log('Client connected');
  
  // Send initial data
  productionService.getCurrentProductionData()
    .then(data => socket.emit('productionData', data))
    .catch(err => console.error('Error getting initial data:', err));
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Set up polling for production data changes
productionService.pollForChanges((data) => {
  io.emit('productionData', data);
}, 30000); // Check every 30 seconds

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
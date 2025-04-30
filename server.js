const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '2mb' })); // Tăng giới hạn kích thước request
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection URI
const MONGODB_URI = "mongodb+srv://duchieufaryoung0:80E9gUahdOXmGKuy@cluster0.6nlv1cv.mongodb.net/telegram_bot_db?retryWrites=true&w=majority";
const DB_NAME = "telegram_bot_db";
const COLLECTION_NAME = "wheel_game_leaderboard";

// Game constants
const MAX_SPINS = 50;
const REFRESH_TIME_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

// MongoDB Client
let mongoClient;
let db;
let leaderboardCollection;
let isConnected = false;

// Enhanced connect to MongoDB with retry
async function connectToMongoDB(retry = 3, delay = 1000) {
  if (isConnected) return true;
  
  let retryCount = 0;
  while (retryCount < retry) {
    try {
      console.log(`Connecting to MongoDB (attempt ${retryCount + 1})...`);
      mongoClient = new MongoClient(MONGODB_URI, { 
        connectTimeoutMS: 5000, // Thêm timeout để tránh chờ quá lâu
        socketTimeoutMS: 45000, // Socket timeout
        serverSelectionTimeoutMS: 5000 // Server selection timeout
      });
      
      await mongoClient.connect();
      console.log('Connected to MongoDB Atlas');
      
      db = mongoClient.db(DB_NAME);
      leaderboardCollection = db.collection(COLLECTION_NAME);
      
      // Create index on userId for faster lookups
      await leaderboardCollection.createIndex({ userId: 1 }, { unique: true });
      
      isConnected = true;
      return true;
    } catch (err) {
      console.error(`Failed to connect to MongoDB (attempt ${retryCount + 1}):`, err);
      retryCount++;
      
      if (retryCount >= retry) {
        console.error('Maximum retry attempts reached');
        return false;
      }
      
      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, delay));
      // Exponential backoff
      delay *= 2;
    }
  }
  return false;
}

// Initialize MongoDB connection
connectToMongoDB();

// Ensure database connection middleware
async function ensureDbConnection(req, res, next) {
  if (!isConnected) {
    try {
      const connected = await connectToMongoDB();
      if (!connected) {
        return res.status(500).json({ error: 'Database connection failed' });
      }
    } catch (err) {
      console.error('Database connection check failed:', err);
      return res.status(500).json({ error: 'Database connection check failed' });
    }
  }
  next();
}

// Helper function to validate and update spins
function validateAndUpdateSpins(playerData) {
  if (!playerData) return false;
  
  const now = new Date().getTime();
  const lastSpinRefreshTime = playerData.lastSpinRefreshTime || 0;
  const timeSinceLastRefresh = now - lastSpinRefreshTime;
  
  // Check if it's time to refresh spins
  if (timeSinceLastRefresh >= REFRESH_TIME_MS) {
    playerData.spinsLeft = MAX_SPINS;
    playerData.lastSpinRefreshTime = now;
    playerData.nextRefreshTime = now + REFRESH_TIME_MS;
    return true; // Spins were refreshed
  }
  
  // Ensure spins don't exceed maximum
  if (playerData.spinsLeft > MAX_SPINS) {
    playerData.spinsLeft = MAX_SPINS;
    return true; // Spins were adjusted
  }
  
  // Ensure spins don't go below zero
  if (playerData.spinsLeft < 0) {
    playerData.spinsLeft = 0;
    return true; // Spins were adjusted
  }
  
  return false; // No changes needed
}

// API Routes with enhanced error handling
app.post('/api/saveScore', ensureDbConnection, async (req, res) => {
  try {
    console.log("Save score request received");
    
    const { userId, name, score, spinsLeft, lastSpinRefreshTime, nextSpinDouble } = req.body;
    
    if (!userId || !name || score === undefined) {
      console.error("Missing required fields:", { userId, name, score });
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: { userId: !!userId, name: !!name, score: score !== undefined }
      });
    }
    
    // Get existing player data or create default
    let playerData = await leaderboardCollection.findOne({ userId });
    
    if (!playerData) {
      console.log(`Creating new player: ${userId}, ${name}`);
      playerData = {
        userId,
        name,
        score: 0,
        spinsLeft: MAX_SPINS,
        lastSpinRefreshTime: 0,
        nextSpinDouble: false,
        createdAt: new Date().getTime()
      };
    } else {
      console.log(`Updating existing player: ${userId}, ${name}`);
    }
    
    // Log previous values for debugging
    console.log("Previous values:", {
      score: playerData.score,
      spinsLeft: playerData.spinsLeft,
      lastSpinRefreshTime: playerData.lastSpinRefreshTime
    });
    
    // Update player data with new values
    playerData.name = name;
    playerData.score = score;
    
    // Only update spins if provided
    if (spinsLeft !== undefined) {
      playerData.spinsLeft = spinsLeft;
    }
    
    // Only update lastSpinRefreshTime if provided and newer
    if (lastSpinRefreshTime && (!playerData.lastSpinRefreshTime || lastSpinRefreshTime > playerData.lastSpinRefreshTime)) {
      playerData.lastSpinRefreshTime = lastSpinRefreshTime;
    }
    
    // Set nextSpinDouble if provided
    if (nextSpinDouble !== undefined) {
      playerData.nextSpinDouble = nextSpinDouble;
    }
    
    // Validate and refresh spins if needed
    const refreshed = validateAndUpdateSpins(playerData);
    
    // Calculate next refresh time
    playerData.nextRefreshTime = playerData.lastSpinRefreshTime + REFRESH_TIME_MS;
    
    // Update last update timestamp
    playerData.lastUpdate = new Date().getTime();
    
    // Log new values for debugging
    console.log("New values:", {
      score: playerData.score,
      spinsLeft: playerData.spinsLeft,
      lastSpinRefreshTime: playerData.lastSpinRefreshTime,
      nextRefreshTime: playerData.nextRefreshTime
    });
    
    // Update in database
    const result = await leaderboardCollection.updateOne(
      { userId },
      { 
        $set: playerData,
        $setOnInsert: { createdAt: new Date().getTime() }
      },
      { upsert: true }
    );
    
    console.log("Database update result:", result);
    
    // Return updated player data and refresh status
    res.json({ 
      success: true, 
      refreshed, 
      player: playerData
    });
  } catch (err) {
    console.error('Error saving score:', err);
    res.status(500).json({ 
      error: 'Failed to save score',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Other API routes keep the same with the ensureDbConnection middleware added
app.get('/api/getScore', ensureDbConnection, async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    let player = await leaderboardCollection.findOne({ userId });
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Check if spins need to be refreshed
    const refreshed = validateAndUpdateSpins(player);
    
    // If spins were refreshed, update the database
    if (refreshed) {
      await leaderboardCollection.updateOne(
        { userId },
        { $set: player }
      );
    }
    
    res.json(player);
  } catch (err) {
    console.error('Error getting score:', err);
    res.status(500).json({ error: 'Failed to get score' });
  }
});

// Force refresh spins endpoint
app.post('/api/refreshSpins', ensureDbConnection, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    let player = await leaderboardCollection.findOne({ userId });
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Force refresh spins
    player.spinsLeft = MAX_SPINS;
    player.lastSpinRefreshTime = new Date().getTime();
    player.nextRefreshTime = player.lastSpinRefreshTime + REFRESH_TIME_MS;
    
    // Update in database
    await leaderboardCollection.updateOne(
      { userId },
      { $set: player }
    );
    
    res.json({
      success: true,
      refreshed: true,
      player
    });
  } catch (err) {
    console.error('Error refreshing spins:', err);
    res.status(500).json({ error: 'Failed to refresh spins' });
  }
});

// Check spins endpoint
app.post('/api/checkSpins', ensureDbConnection, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    let player = await leaderboardCollection.findOne({ userId });
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Check if spins need to be refreshed
    const refreshed = validateAndUpdateSpins(player);
    
    // If spins were refreshed, update the database
    if (refreshed) {
      await leaderboardCollection.updateOne(
        { userId },
        { $set: player }
      );
    }
    
    res.json({
      success: true,
      refreshed,
      player
    });
  } catch (err) {
    console.error('Error checking spins:', err);
    res.status(500).json({ error: 'Failed to check spins' });
  }
});

app.get('/api/getLeaderboard', ensureDbConnection, async (req, res) => {
  try {
    const leaderboard = await leaderboardCollection
      .find({})
      .sort({ score: -1 })
      .limit(10)
      .toArray();
    
    res.json(leaderboard);
  } catch (err) {
    console.error('Error getting leaderboard:', err);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConnected: isConnected,
    timestamp: new Date().toISOString()
  });
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  if (mongoClient) {
    await mongoClient.close();
    console.log('MongoDB connection closed');
  }
  process.exit(0);
});

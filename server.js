const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection URI
const MONGODB_URI = "mongodb+srv://duchieufaryoung0:80E9gUahdOXmGKuy@cluster0.6nlv1cv.mongodb.net/telegram_bot_db?retryWrites=true&w=majority";
const DB_NAME = "telegram_bot_db";
const COLLECTION_NAME = "wheel_game_leaderboard";

// MongoDB Client
let mongoClient;
let db;
let leaderboardCollection;

// Constants for game config
const MAX_SPINS = 50;
const REFRESH_TIME_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');
    
    db = mongoClient.db(DB_NAME);
    leaderboardCollection = db.collection(COLLECTION_NAME);
    
    // Create index on userId for faster lookups
    await leaderboardCollection.createIndex({ userId: 1 }, { unique: true });
    
    return true;
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    return false;
  }
}

// Initialize MongoDB connection
connectToMongoDB();

// Helper function to validate and update spins
function validateAndUpdateSpins(playerData) {
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
  
  return false; // No changes needed
}

// API Routes
app.post('/api/saveScore', async (req, res) => {
  try {
    const { userId, name, score, spinsLeft, lastSpinRefreshTime, nextSpinDouble } = req.body;
    
    if (!userId || !name || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get existing player data or create default
    let playerData = await leaderboardCollection.findOne({ userId }) || {
      userId,
      name,
      score: 0,
      spinsLeft: MAX_SPINS,
      lastSpinRefreshTime: 0,
      nextSpinDouble: false,
      createdAt: new Date()
    };
    
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
    
    // Update in database
    const result = await leaderboardCollection.updateOne(
      { userId },
      { 
        $set: playerData,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    
    // Return updated player data and refresh status
    res.json({ 
      success: true, 
      refreshed, 
      player: playerData
    });
  } catch (err) {
    console.error('Error saving score:', err);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.get('/api/getScore', async (req, res) => {
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

// New endpoint to check and refresh spins
app.post('/api/checkSpins', async (req, res) => {
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

app.get('/api/getLeaderboard', async (req, res) => {
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

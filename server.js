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

// API Routes
app.post('/api/saveScore', async (req, res) => {
  try {
    const { userId, name, score } = req.body;
    
    if (!userId || !name || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const result = await leaderboardCollection.updateOne(
      { userId },
      { 
        $set: { 
          userId,
          name,
          score,
          lastUpdate: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    
    res.json({ success: true, result });
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
    
    const player = await leaderboardCollection.findOne({ userId });
    
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    res.json(player);
  } catch (err) {
    console.error('Error getting score:', err);
    res.status(500).json({ error: 'Failed to get score' });
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

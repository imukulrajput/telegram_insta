const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Nayi line
require('dotenv').config();

const { Token, Agent, InstaUser, Video } = require('./models');
const bot = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

// --- JWT AUTHENTICATION MIDDLEWARE ---
// Ye function har admin API call se pehle check karega ki token valid hai ya nahi
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided!' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = verified;
        next(); // Token sahi hai, aage jane do
    } catch (error) {
        res.status(403).json({ message: 'Invalid or Expired Token!' });
    }
};

// --- 1. ADMIN LOGIN API (Public) ---
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        // Token generate karo jo 12 ghante baad expire ho jayega
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ message: "Login Successful", token });
    } else {
        res.status(401).json({ message: "Invalid Username or Password" });
    }
});

// --- SECURE ADMIN APIs (Yahan humne 'authenticateAdmin' guard laga diya) ---

// 2. Admin API: Generate Secret Token
app.post('/admin/generate-token', authenticateAdmin, async (req, res) => {
    try {
        const rawToken = crypto.randomBytes(4).toString('hex').toUpperCase(); 
        const newToken = await Token.create({ token: rawToken });
        res.json({ message: "Token generated successfully", token: newToken.token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Admin API: View Payments/Stats
app.get('/admin/payments', authenticateAdmin, async (req, res) => {
    try {
        const agents = await Agent.find();
        const agentPayments = agents.map(agent => ({
            name: agent.name,
            accountsAdded: agent.totalInstaAccountsAdded,
            earnings: Math.floor(agent.totalInstaAccountsAdded / 10) * 100
        }));

        const instaUsers = await InstaUser.find();
        const userPayments = instaUsers.map(user => ({
            username: user.instaUsername,
            totalViews: user.totalViews,
            earnings: Math.floor(user.totalViews / 1000000) * 500
        }));

        res.json({ agentPayments, userPayments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Admin API: Get all Pending Videos
app.get('/admin/videos/pending', authenticateAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: 'Pending' });
        res.json(videos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Admin API: Approve Video & Update Views
app.post('/admin/videos/:id/approve', authenticateAdmin, async (req, res) => {
    try {
        const { views } = req.body;
        const video = await Video.findById(req.params.id);
        
        if (!video) return res.status(404).json({ message: "Video not found" });

        video.status = 'Approved';
        video.views = Number(views) || 0;
        await video.save();

        await InstaUser.findOneAndUpdate(
            { instaUsername: video.instaUsername },
            { $inc: { totalViews: Number(views) || 0 } }
        );

        res.json({ message: "Video approved and views updated successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Admin API: Reject Video
app.post('/admin/videos/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        await Video.findByIdAndUpdate(req.params.id, { status: 'Rejected' });
        res.json({ message: "Video rejected" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server and Bot
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB Connected!");
        app.listen(PORT, () => console.log(`Admin Server running on port ${PORT} (SECURED)`));
        bot.launch();
        console.log("Telegram Bot is running!");
    })
    .catch(err => console.error("Database connection error:", err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
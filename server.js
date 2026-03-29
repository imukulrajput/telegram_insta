const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const axios = require('axios');

const { Token, Agent, InstaUser, Video } = require('./models');
const bot = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

// --- JWT AUTHENTICATION MIDDLEWARE ---
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided!' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = verified;
        next(); 
    } catch (error) {
        res.status(403).json({ message: 'Invalid or Expired Token!' });
    }
};

// ==========================================
// 1. AUTH & TOKEN APIs
// ==========================================
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ message: "Login Successful", token });
    } else {
        res.status(401).json({ message: "Invalid Username or Password" });
    }
});

app.post('/admin/generate-token', authenticateAdmin, async (req, res) => {
    try {
        const rawToken = crypto.randomBytes(4).toString('hex').toUpperCase(); 
        const newToken = await Token.create({ token: rawToken });
        res.json({ message: "Token generated successfully", token: newToken.token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. PAYMENT APIs
// ==========================================
app.get('/admin/payments', authenticateAdmin, async (req, res) => {
    try {
        const agents = await Agent.find();
        const agentPayments = agents.map(agent => {
            const totalEarned = agent.totalInstaAccountsAdded * 200;
            const paid = agent.paidAmount || 0;
            const pending = totalEarned - paid;
            return {
                id: agent._id, name: agent.name, bankDetails: agent.bankDetails,
                telegramId: agent.telegramId, // Mapping ke liye
                accountsAdded: agent.totalInstaAccountsAdded,
                totalEarned, paidAmount: paid, pendingAmount: pending > 0 ? pending : 0
            };
        });

        const instaUsers = await InstaUser.find();
        const userPayments = instaUsers.map(user => {
            const totalEarned = Math.floor((user.totalViews || 0) / 1000000) * 800;
            const paid = user.paidAmount || 0;
            const pending = totalEarned - paid;
            
            // SMART LINK: Kis agent ne isko add kiya tha (Search Filter ke liye)
            const parentAgent = agents.find(a => a.telegramId === user.addedByAgentTelegramId);
            const agentName = parentAgent ? parentAgent.name : "Unknown Agent";

            return {
                id: user._id, username: user.instaUsername, bankDetails: user.bankDetails,
                agentName: agentName, // UI me filter karne me kaam aayega
                totalViews: user.totalViews || 0,
                totalEarned, paidAmount: paid, pendingAmount: pending > 0 ? pending : 0
            };
        });
        res.json({ agentPayments, userPayments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/admin/agents/:id/pay', authenticateAdmin, async (req, res) => {
    try {
        const agent = await Agent.findById(req.params.id);
        const pending = (agent.totalInstaAccountsAdded * 200) - (agent.paidAmount || 0);
        if (pending > 0) {
            agent.paidAmount = (agent.paidAmount || 0) + pending;
            await agent.save();
        }
        res.json({ message: "Agent payment cleared" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/admin/users/:id/pay', authenticateAdmin, async (req, res) => {
    try {
        const user = await InstaUser.findById(req.params.id);
        const pending = (Math.floor((user.totalViews || 0) / 1000000) * 800) - (user.paidAmount || 0);
        if (pending > 0) {
            user.paidAmount = (user.paidAmount || 0) + pending;
            await user.save();
        }
        res.json({ message: "User payment cleared" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 3. WEEKLY VIDEO MANAGEMENT APIs
// ==========================================

// Get All Active Videos (Current Week)
app.get('/admin/videos/active', authenticateAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: { $ne: 'Archived' } });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NAYI API: Get All Archived (History) Videos
app.get('/admin/videos/archived', authenticateAdmin, async (req, res) => {
    try {
        // .sort({_id: -1}) se sabse latest purani video sabse upar aayegi
        const videos = await Video.find({ status: 'Archived' }).sort({ _id: -1 });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Views and User Earnings
app.post('/admin/videos/:id/update-views', authenticateAdmin, async (req, res) => {
    try {
        const { views } = req.body;
        const video = await Video.findById(req.params.id);
        
        const oldViews = video.views || 0;
        const newViews = parseInt(views) || 0;
        const viewDifference = newViews - oldViews;

        video.views = newViews;
        await video.save();

        await InstaUser.updateOne(
            { instaUsername: video.instaUsername },
            { $inc: { totalViews: viewDifference } }
        );

        res.json({ message: "Views and Earnings updated!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Smart Reject Video (Deletes it & Deducts Views)
app.post('/admin/videos/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        const video = await Video.findById(req.params.id);
        if (!video) return res.status(404).json({ message: "Video not found" });

        if (video.views > 0) {
            await InstaUser.updateOne(
                { instaUsername: video.instaUsername },
                { $inc: { totalViews: -video.views } }
            );
        }

        await Video.findByIdAndDelete(req.params.id);
        res.json({ message: "Video rejected and views deducted from earnings." });
    } catch (error) { res.status(500).json({ error: error.message }); }
}); 

// Weekly Reset (Archive All Active Videos)
app.post('/admin/videos/archive-all', authenticateAdmin, async (req, res) => {
    try {
        await Video.updateMany({ status: { $ne: 'Archived' } }, { status: 'Archived' });
        res.json({ message: "Dashboard cleared for the new week!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// RapidAPI: Auto-Fetch Views
app.post('/admin/videos/fetch-views', authenticateAdmin, async (req, res) => {
    const { url } = req.body;
    try {
        const options = {
            method: 'GET',
            url: 'https://instagram-looter2.p.rapidapi.com/post', 
            params: { url: url },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY,
                'x-rapidapi-host': process.env.RAPIDAPI_HOST
            }
        };

        const response = await axios.request(options);
        const views = response.data?.view_count || response.data?.video_view_count || response.data?.play_count;

        if (views !== undefined && views !== null) {
            res.json({ success: true, views: views });
        } else {
            res.status(400).json({ success: false, message: "Views count not found in API response." });
        }
    } catch (error) {
        console.error("RapidAPI Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: "RapidAPI fetch failed." });
    }
});

// ==========================================
// 4. SERVER STARTUP
// ==========================================
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
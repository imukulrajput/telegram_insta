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
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 2. PAYMENT APIs (With History)
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
                telegramId: agent.telegramId,
                accountsAdded: agent.totalInstaAccountsAdded,
                totalEarned, paidAmount: paid, pendingAmount: pending > 0 ? pending : 0
            };
        });

        const instaUsers = await InstaUser.find();
        const userPayments = instaUsers.map(user => {
            const totalEarned = Math.floor((user.totalViews || 0) / 1000000) * 800;
            const paid = user.paidAmount || 0;
            const pending = totalEarned - paid;
            
            const parentAgent = agents.find(a => a.telegramId === user.addedByAgentTelegramId);
            const agentName = parentAgent ? parentAgent.name : "Unknown Agent";

            return {
                id: user._id, username: user.instaUsername, bankDetails: user.bankDetails,
                agentName: agentName, totalViews: user.totalViews || 0,
                totalEarned, paidAmount: paid, pendingAmount: pending > 0 ? pending : 0,
                paymentHistory: user.paymentHistory || [] // Added History for UI
            };
        });
        res.json({ agentPayments, userPayments });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

// Enhanced Pay API: Adds to history & notifies user
app.post('/admin/users/:id/pay', authenticateAdmin, async (req, res) => {
    try {
        const user = await InstaUser.findById(req.params.id);
        const totalEarned = Math.floor((user.totalViews || 0) / 1000000) * 800;
        const pending = totalEarned - (user.paidAmount || 0);
        
        if (pending > 0) {
            user.paidAmount = (user.paidAmount || 0) + pending;
            user.paymentHistory.push({ amount: pending, date: new Date() });
            await user.save();
            
            // Telegram Notification
            if (user.telegramId) {
                const msg = `✅ *Payment Processed!*\n\nAmount: ₹${pending}\nStatus: Cleared to your linked bank account.\n\nKeep growing! 🚀`;
                bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' }).catch(e => console.log("TG Notify Error", e.message));
            }
        }
        res.json({ message: "User payment cleared and history updated" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 3. WEEKLY VIDEO MANAGEMENT APIs
// ==========================================
app.get('/admin/videos/active', authenticateAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: { $ne: 'Archived' } });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/videos/archived', authenticateAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: 'Archived' }).sort({ _id: -1 });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual View Update
app.post('/admin/videos/:id/update-views', authenticateAdmin, async (req, res) => {
    try {
        const { views } = req.body;
        const video = await Video.findById(req.params.id);
        
        const oldViews = video.views || 0;
        const newViews = parseInt(views) || 0;
        const viewDifference = newViews - oldViews;

        video.views = newViews;
        await video.save();

        await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: viewDifference } });
        res.json({ message: "Views and Earnings updated manually!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Smart Reject: Asks for Reason & Sends Telegram Alert
app.post('/admin/videos/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        const video = await Video.findById(req.params.id);
        if (!video) return res.status(404).json({ message: "Video not found" });

        const user = await InstaUser.findOne({ instaUsername: video.instaUsername });

        // Deduct views if already added
        if (video.views > 0) {
            await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: -video.views } });
        }

        // Notify User
        if (user && user.telegramId) {
            const msg = `❌ *Video Rejected!*\n\nYour video link:\n${video.videoLink}\n\n*Reason given by Admin:*\n_${reason || 'Not specified'}_\n\nPlease ensure your videos meet our guidelines.`;
            bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' }).catch(e => console.log("TG Notify Error", e.message));
        }

        await Video.findByIdAndDelete(req.params.id);
        res.json({ message: "Video rejected, views deducted, and user notified." });
    } catch (error) { res.status(500).json({ error: error.message }); }
}); 

app.post('/admin/videos/archive-all', authenticateAdmin, async (req, res) => {
    try {
        await Video.updateMany({ status: { $ne: 'Archived' } }, { status: 'Archived' });
        res.json({ message: "Dashboard cleared for the new week!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// RapidAPI: Auto-Fetch & Auto-Save
app.post('/admin/videos/fetch-views', authenticateAdmin, async (req, res) => {
    const { url, videoId } = req.body;
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
        const newViews = response.data?.view_count || response.data?.video_view_count || response.data?.play_count;

        if (newViews !== undefined && newViews !== null) {
            // AUTO SAVE LOGIC
            const video = await Video.findById(videoId);
            if(video) {
                const oldViews = video.views || 0;
                const diff = parseInt(newViews) - oldViews;
                video.views = parseInt(newViews);
                await video.save();
                await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: diff } });
            }
            res.json({ success: true, views: newViews });
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
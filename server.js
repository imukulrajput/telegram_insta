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

// --- 1. NORMAL AUTH MIDDLEWARE (For Both Admin & Staff) ---
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided!' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = verified; // Contains username and role
        next(); 
    } catch (error) {
        res.status(403).json({ message: 'Invalid or Expired Token!' });
    }
};

// --- 2. SUPER ADMIN ONLY MIDDLEWARE (Strict Lock 🔒) ---
const authorizeSuperAdmin = (req, res, next) => {
    if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ message: "Access Denied: Only Super Admin can perform this action!" });
    }
    next();
};

// ==========================================
// 1. AUTH & TOKEN APIs
// ==========================================
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    // Check for Super Admin
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ username, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
        return res.json({ message: "Login Successful", token, role: 'superadmin' });
    } 
    // Check for Staff / Moderator
    else if (username === process.env.MOD_USERNAME && password === process.env.MOD_PASSWORD) {
        const token = jwt.sign({ username, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '12h' });
        return res.json({ message: "Staff Login Successful", token, role: 'moderator' });
    } 
    else {
        return res.status(401).json({ message: "Invalid Username or Password" });
    }
});

// STAFF BLOCKED: Only Super Admin can generate tokens
app.post('/admin/generate-token', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
    try {
        const rawToken = crypto.randomBytes(4).toString('hex').toUpperCase(); 
        const newToken = await Token.create({ token: rawToken });
        res.json({ message: "Token generated successfully", token: newToken.token });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 2. PAYMENT APIs (Super Admin Only 🔒)
// ==========================================
app.get('/admin/payments', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
    try {
        const agents = await Agent.find();
        const agentPayments = agents.map(agent => {
            const totalEarned = agent.totalInstaAccountsAdded * 200;
            const paid = agent.paidAmount || 0;
            const pending = totalEarned - paid;
            return {
                id: agent._id, name: agent.name, bankDetails: agent.bankDetails,
                telegramId: agent.telegramId, accountsAdded: agent.totalInstaAccountsAdded,
                totalEarned, paidAmount: paid, pendingAmount: pending > 0 ? pending : 0
            };
        });

        const instaUsers = await InstaUser.find();
        const userPayments = instaUsers.map(user => {
            const totalEarned = ((user.totalViews || 0) / 1000000) * 800;
            const paid = user.paidAmount || 0;
            const pending = totalEarned - paid;
            const parentAgent = agents.find(a => a.telegramId === user.addedByAgentTelegramId);
            
            return {
                id: user._id, username: user.instaUsername, bankDetails: user.bankDetails,
                agentName: parentAgent ? parentAgent.name : "Unknown Agent",
                totalViews: user.totalViews || 0,
                totalEarned: totalEarned.toFixed(4), 
                paidAmount: paid.toFixed(4), 
                pendingAmount: pending > 0 ? pending.toFixed(4) : "0.0000",
                paymentHistory: user.paymentHistory || []
            };
        });
        res.json({ agentPayments, userPayments });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/admin/agents/:id/pay', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
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

app.post('/admin/users/:id/pay', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
    try {
        const user = await InstaUser.findById(req.params.id);
        const totalEarned = ((user.totalViews || 0) / 1000000) * 800;
        const pending = totalEarned - (user.paidAmount || 0);
        
        if (pending > 0.0001) {
            user.paidAmount = (user.paidAmount || 0) + pending;
            user.paymentHistory.push({ amount: pending.toFixed(4), date: new Date() });
            await user.save();
            
            if (user.telegramId) {
                const msg = `✅ *Payment Processed!*\n\nAmount: ₹${pending.toFixed(2)}\nStatus: Cleared to your linked bank account.\n\nKeep growing! 🚀`;
                bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' }).catch(e => console.log("TG Notify Error", e.message));
            }
        }
        res.json({ message: "User payment cleared" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// 3. VIDEO MANAGEMENT APIs (Both can access)
// ==========================================
app.get('/admin/videos/active', authenticateAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: { $nin: ['Archived', 'Rejected'] } });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Only Super Admin needs to see History
app.get('/admin/videos/archived', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
    try {
        const videos = await Video.find({ status: { $in: ['Archived', 'Rejected'] } }).sort({ _id: -1 });
        res.json(videos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/videos/:id/update-views', authenticateAdmin, async (req, res) => {
    try {
        const { views } = req.body;
        const video = await Video.findById(req.params.id);
        const oldViews = video.views || 0;
        const newViews = parseInt(views) || 0;
        video.views = newViews;
        await video.save();
        await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: (newViews - oldViews) } });
        res.json({ message: "Views and Earnings updated manually!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/videos/:id/reject', authenticateAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        const video = await Video.findById(req.params.id);
        if (!video) return res.status(404).json({ message: "Video not found" });

        const user = await InstaUser.findOne({ instaUsername: video.instaUsername });
        if (video.views > 0) {
            await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: -video.views } });
        }
        if (user && user.telegramId) {
            const msg = `❌ *Video Rejected!*\n\nYour video link:\n${video.videoLink}\n\n*Reason:*\n_${reason || 'Not specified'}_\n\nPlease ensure your videos meet guidelines.`;
            bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'Markdown' }).catch(e => console.log("TG Error:", e.message));
        }
        
        video.status = 'Rejected';
        video.rejectionReason = reason;
        video.views = 0; 
        await video.save();
        res.json({ message: "Video rejected." });
    } catch (error) { res.status(500).json({ error: error.message }); }
}); 

// STAFF BLOCKED: Only Super Admin can clear the week
app.post('/admin/videos/archive-all', authenticateAdmin, authorizeSuperAdmin, async (req, res) => {
    try {
        await Video.updateMany({ status: { $nin: ['Archived', 'Rejected'] } }, { status: 'Archived' });
        res.json({ message: "Dashboard cleared for the new week!" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/admin/videos/fetch-views', authenticateAdmin, async (req, res) => {
    const { url, videoId } = req.body;
    try {
        const options = {
            method: 'GET', url: 'https://instagram-looter2.p.rapidapi.com/post', 
            params: { url: url },
            headers: { 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': process.env.RAPIDAPI_HOST }
        };
        const response = await axios.request(options);
        const newViews = response.data?.view_count || response.data?.video_view_count || response.data?.play_count;

        if (newViews !== undefined && newViews !== null) {
            const video = await Video.findById(videoId);
            if(video) {
                const oldViews = video.views || 0;
                video.views = parseInt(newViews);
                await video.save();
                await InstaUser.updateOne({ instaUsername: video.instaUsername }, { $inc: { totalViews: (parseInt(newViews) - oldViews) } });
            }
            res.json({ success: true, views: newViews });
        } else {
            res.status(400).json({ success: false, message: "Views count not found." });
        }
    } catch (error) {
        console.error("RapidAPI Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: "RapidAPI fetch failed." });
    }
});

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI).then(() => {
    app.listen(PORT, () => console.log(`Admin Server running on port ${PORT}`));
    bot.launch();
    console.log("Telegram Bot is running!");
}).catch(err => console.error("Database error:", err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
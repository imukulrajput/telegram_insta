// models.js
const mongoose = require('mongoose');

const TokenSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false }
});

const AgentSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    bankDetails: { type: String, required: true },
    tokenUsed: { type: String, required: true },
    totalInstaAccountsAdded: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 }
});

const InstaUserSchema = new mongoose.Schema({
    instaUsername: { type: String, required: true, unique: true },
    bankDetails: { type: String, required: true, unique: true },
    addedByAgentTelegramId: { type: Number, required: true },
    totalViews: { type: Number, default: 0 },
    telegramId: { type: Number, default: null },  // <-- Ye nayi line add karni hai
    paidAmount: { type: Number, default: 0 },
    paymentHistory: [{ // NAYA FIELD
        amount: Number,
        date: { type: Date, default: Date.now }
    }]
});

const VideoSchema = new mongoose.Schema({
    instaUsername: { type: String, required: true },
    videoLink: { type: String, required: true, unique: true }, // Added unique: true
    views: { type: Number, default: 0 },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' }, // Nayi line
    uploadDate: { type: Date, default: Date.now },
    rejectionReason: { type: String, default: null } 
    
});

module.exports = {
    Token: mongoose.model('Token', TokenSchema),
    Agent: mongoose.model('Agent', AgentSchema),
    InstaUser: mongoose.model('InstaUser', InstaUserSchema),
    Video: mongoose.model('Video', VideoSchema)
};
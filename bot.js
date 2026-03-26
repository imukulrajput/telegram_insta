const { Telegraf, session, Markup } = require('telegraf');
const { Token, Agent, InstaUser, Video } = require('./models');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const cleanUsername = (username) => username.replace('@', '').trim().toLowerCase();

// --- SMART DYNAMIC MENU ---
const getMenu = async (telegramId) => {
    const isAgent = await Agent.findOne({ telegramId });
    const isInstaUser = await InstaUser.findOne({ telegramId });

    let buttons = [];

    // Row 1: Agent Roles
    if (!isAgent) {
        buttons.push(['🔑 Register as Agent']);
    } else {
        buttons.push(['➕ Add Insta User', '📊 My Agent Profile']);
    }

    // Row 2 & 3: Insta User Roles
    if (!isInstaUser) {
        buttons.push(['🔗 Link Insta Account']); 
    } else {
        buttons.push(['🎥 Submit My Videos', '💰 My Earnings']);
        buttons.push(['🔌 Unlink / Logout']); // NAYA BUTTON ADD KIYA
    }

    // Row 4: Cancel
    buttons.push(['❌ Cancel / Main Menu']);
    
    return Markup.keyboard(buttons).resize();
};

// --- START COMMAND ---
bot.start(async (ctx) => {
    ctx.session = null;
    const menu = await getMenu(ctx.from.id);
    ctx.reply("🤖 Welcome to the Management Bot!\n\nPlease choose an option from the menu below:", menu);
});

// --- BUTTON HANDLERS ---

bot.hears('❌ Cancel / Main Menu', async (ctx) => {
    ctx.session = null;
    const menu = await getMenu(ctx.from.id);
    ctx.reply("Action cancelled. You are back at the main menu. 🏠", menu);
});

bot.hears('🔑 Register as Agent', async (ctx) => {
    const isAgent = await Agent.findOne({ telegramId: ctx.from.id });
    if (isAgent) return ctx.reply("You are already a registered Agent!", await getMenu(ctx.from.id));
    ctx.session = { step: 'AWAITING_TOKEN' };
    ctx.reply("Please enter the **Secret Registration Token** provided by the Admin:");
});

bot.hears('🔗 Link Insta Account', async (ctx) => {
    const isInstaUser = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (isInstaUser) return ctx.reply("Your account is already linked. You can directly submit your videos.", await getMenu(ctx.from.id));
    ctx.session = { step: 'AWAITING_LINK_USERNAME' };
    ctx.reply("Please enter your **Instagram Username** (The one added to the system):");
});

bot.hears('➕ Add Insta User', async (ctx) => {
    const isAgent = await Agent.findOne({ telegramId: ctx.from.id });
    if (!isAgent) return ctx.reply("This option is only for Agents.", await getMenu(ctx.from.id));
    ctx.session = { step: 'AWAITING_INSTA_ID' };
    ctx.reply("Enter the new Instagram User's **Username** (without @):");
});

bot.hears('🎥 Submit My Videos', async (ctx) => {
    const user = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Your account is not linked. Please click '🔗 Link Insta Account' first.");
    ctx.session = { step: 'AWAITING_MY_VIDEO_LINKS' };
    ctx.reply(`Welcome @${user.instaUsername}! ✅\n\nNow, send your video **Links**.\nYou can send multiple links in a single message.`);
});

bot.hears('💰 My Earnings', async (ctx) => {
    const user = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Your account is not linked.");
    const earnings = Math.floor(user.totalViews / 1000000) * 500; 
    ctx.reply(
        `👤 **Creator Stats (@${user.instaUsername})**\n\n` +
        `**Total Approved Views:** ${user.totalViews.toLocaleString()}\n` +
        `**Total Earnings:** ₹${earnings}\n\n` +
        `Keep uploading and earning! 🚀`
    );
});

// --- NAYA FUNCTION: UNLINK / LOGOUT ---
bot.hears('🔌 Unlink / Logout', async (ctx) => {
    const user = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Aapka koi account linked nahi hai.");

    // Is telegram ID se jude saare Insta accounts ko unlink kar do (telegramId = null)
    await InstaUser.updateMany({ telegramId: ctx.from.id }, { $set: { telegramId: null } });

    ctx.session = null;
    const menu = await getMenu(ctx.from.id);
    ctx.reply("🔌 Aapka account successfully unlink (logout) ho gaya hai.\nAb aap '🔗 Link Insta Account' button use karke dusra account add kar sakte hain.", menu);
});

bot.hears('📊 My Agent Profile', async (ctx) => {
    const agent = await Agent.findOne({ telegramId: ctx.from.id });
    if (!agent) return;

    const earnings = Math.floor(agent.totalInstaAccountsAdded / 10) * 100; 
    const addedUsers = await InstaUser.find({ addedByAgentTelegramId: ctx.from.id });

    let profileMessage = `👤 **Agent Profile (${agent.name})**\n`;
    profileMessage += `**Accounts Added:** ${agent.totalInstaAccountsAdded}\n`;
    profileMessage += `**Earnings:** ₹${earnings}\n\n`;

    if (addedUsers.length > 0) {
        profileMessage += `👥 **Your Added Instagram Accounts:**\n(Click on any username below to update their bank details)\n`;
        const inlineButtons = [];
        addedUsers.slice(0, 90).forEach((user) => {
            const isLinked = user.telegramId ? '✅' : '⏳';
            inlineButtons.push([
                Markup.button.callback(`✏️ Edit @${user.instaUsername} ${isLinked}`, `editbank_${user.instaUsername}`)
            ]);
        });
        return ctx.reply(profileMessage, Markup.inlineKeyboard(inlineButtons));
    } else {
        profileMessage += `🤷‍♂️ You haven't added any Instagram accounts yet.`;
        return ctx.reply(profileMessage);
    }
});

// --- INLINE BUTTON CLICK HANDLER ---
bot.action(/^editbank_(.+)$/, async (ctx) => {
    try {
        const instaUsername = ctx.match[1];
        const user = await InstaUser.findOne({ instaUsername, addedByAgentTelegramId: ctx.from.id });
        if (!user) {
            await ctx.answerCbQuery("❌ You are not authorized to edit this user.", { show_alert: true }).catch(()=>{});
            return;
        }
        ctx.session = { step: 'AWAITING_NEW_BANK', editInstaId: instaUsername };
        await ctx.answerCbQuery().catch(()=>{}); 
        await ctx.reply(`✏️ You are updating the bank details for **@${instaUsername}**.\n\nPlease enter the **New Bank Details**:`);
    } catch (error) {
        console.error("Button Action Error: ", error);
    }
});

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (ctx) => {
    const state = ctx.session?.step;
    if (!state || !ctx.message.text) return;

    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;

    // IgnoreList me NAYA BUTTON bhi add kar diya
    const ignoreList = ['🔑 Register as Agent', '🔗 Link Insta Account', '➕ Add Insta User', '🎥 Submit My Videos', '💰 My Earnings', '📊 My Agent Profile', '🔌 Unlink / Logout', '❌ Cancel / Main Menu'];
    if (ignoreList.includes(text)) return;

    try {
        if (state === 'AWAITING_TOKEN') {
            const tokenRecord = await Token.findOne({ token: text, isUsed: false });
            if (!tokenRecord) return ctx.reply("❌ Invalid or already used token. Please enter a valid token or press Cancel.");
            ctx.session.tempToken = text;
            ctx.session.step = 'AWAITING_AGENT_NAME';
            return ctx.reply("Token verified! ✅\nNow, enter your **Full Name**:");
        }
        if (state === 'AWAITING_AGENT_NAME') {
            ctx.session.tempName = text;
            ctx.session.step = 'AWAITING_AGENT_BANK';
            return ctx.reply(`Welcome ${text}! 🎉\nPlease enter your **Bank Details** (A/c No, IFSC):`);
        }
        if (state === 'AWAITING_AGENT_BANK') {
            await Token.updateOne({ token: ctx.session.tempToken }, { isUsed: true });
            await Agent.create({ telegramId, name: ctx.session.tempName, bankDetails: text, tokenUsed: ctx.session.tempToken });
            ctx.session = null; 
            return ctx.reply("🎉 Registration successful! You are now an Agent.", await getMenu(telegramId));
        }

        if (state === 'AWAITING_INSTA_ID') {
            const cleanId = cleanUsername(text);
            const exists = await InstaUser.findOne({ instaUsername: cleanId });
            if (exists) return ctx.reply(`❌ The username '@${cleanId}' is already in the system.`);
            ctx.session.tempInstaId = cleanId;
            ctx.session.step = 'AWAITING_INSTA_BANK';
            return ctx.reply(`ID @${cleanId} saved! ✅\nNow enter their unique **Bank Details**:`);
        }
        if (state === 'AWAITING_INSTA_BANK') {
            const bankExists = await InstaUser.findOne({ bankDetails: text });
            if (bankExists) return ctx.reply("❌ These bank details are already linked to another Instagram account. Please enter unique details:");
            const savedInstaId = ctx.session.tempInstaId;
            await InstaUser.create({ instaUsername: savedInstaId, bankDetails: text, addedByAgentTelegramId: telegramId });
            await Agent.updateOne({ telegramId }, { $inc: { totalInstaAccountsAdded: 1 } });
            ctx.session = null;
            return ctx.reply(`✅ Instagram user '@${savedInstaId}' has been successfully added!`, await getMenu(telegramId));
        }

        if (state === 'AWAITING_LINK_USERNAME') {
            const cleanId = cleanUsername(text);
            const user = await InstaUser.findOne({ instaUsername: cleanId });
            if (!user) return ctx.reply("❌ This username was not found in the database.");
            if (user.telegramId) return ctx.reply("❌ This account is already linked to another Telegram profile.");
            ctx.session.linkInstaId = cleanId;
            ctx.session.step = 'AWAITING_LINK_BANK';
            return ctx.reply("For verification: Enter the **exact Bank Details** that were provided when this account was added:");
        }
        if (state === 'AWAITING_LINK_BANK') {
            const user = await InstaUser.findOne({ instaUsername: ctx.session.linkInstaId });
            if (user.bankDetails !== text) {
                return ctx.reply("❌ Bank details did not match. Please enter the correct details or press Cancel.");
            }
            user.telegramId = telegramId;
            await user.save();
            ctx.session = null;
            return ctx.reply("🎉 Account successfully linked! You can now submit your videos directly.", await getMenu(telegramId));
        }

        // --- SUBMIT MY VIDEOS FLOW (FIXED GLUED LINKS) ---
        if (state === 'AWAITING_MY_VIDEO_LINKS') {
            // FIX: "https://link1https://link2" ko split karke space daal dega
            const formattedText = text.replace(/(https?:\/\/)/gi, ' $1');
            
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const rawLinks = formattedText.match(urlRegex) || [];
            
            const uniquePastedLinks = [...new Set(rawLinks)];

            if (uniquePastedLinks.length === 0) {
                return ctx.reply("❌ No valid link (http/https) found. Please send again:");
            }

            const existingVideos = await Video.find({ videoLink: { $in: uniquePastedLinks } });
            const existingLinks = existingVideos.map(v => v.videoLink);
            const newLinks = uniquePastedLinks.filter(link => !existingLinks.includes(link));

            if (newLinks.length === 0) {
                return ctx.reply("❌ All the links you sent have already been submitted. Please send new, unique links.", await getMenu(telegramId));
            }

            const user = await InstaUser.findOne({ telegramId });
            const videoDocs = newLinks.map(link => ({
                instaUsername: user.instaUsername,
                videoLink: link,
                status: 'Pending'
            }));

            await Video.insertMany(videoDocs);
            ctx.session = null;

            let replyMsg = `🎉 Success! **${newLinks.length}** new video link(s) have been submitted for Admin approval.`;
            if (existingLinks.length > 0) {
                replyMsg += `\n\n⚠️ Note: **${existingLinks.length}** link(s) were ignored because they were already in the system.`;
            }
            return ctx.reply(replyMsg, await getMenu(telegramId));
        }

        if (state === 'AWAITING_NEW_BANK') {
            const targetUsername = ctx.session.editInstaId;
            const bankExists = await InstaUser.findOne({ bankDetails: text, instaUsername: { $ne: targetUsername } });
            if (bankExists) {
                return ctx.reply("❌ These bank details are already linked to another account. Please enter unique details:");
            }
            await InstaUser.updateOne({ instaUsername: targetUsername }, { bankDetails: text });
            ctx.session = null;
            return ctx.reply(`✅ Bank details for **@${targetUsername}** have been successfully updated!`, await getMenu(telegramId));
        }

    } catch (error) {
        console.error("Bot Error: ", error);
        ctx.reply("❌ A server error occurred. Please press 'Cancel / Main Menu' and try again.");
    }
});

// --- GLOBAL ERROR HANDLER ---
bot.catch((err, ctx) => {
    console.error(`[Bot Error] Type: ${ctx.updateType} | Message: ${err.message}`);
});

module.exports = bot;
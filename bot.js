const { Telegraf, session, Markup } = require('telegraf');
const { Token, Agent, InstaUser, Video } = require('./models');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const cleanUsername = (username) => username.replace('@', '').trim().toLowerCase();

// --- SMART WEEKEND CHECKER (IST Timezone) ---
const isWeekendIST = () => {
    const currentUtc = new Date();
    const istTime = new Date(currentUtc.getTime() + (5.5 * 60 * 60 * 1000));
    const day = istTime.getUTCDay(); // 0 = Sunday, 6 = Saturday
    return day === 0 || day === 6;
};

const weekendErrorMessage = "🚫 **Submission Closed for the Weekend!**\n\nVideo submission is only allowed from **Monday to Friday**.\nWe are currently auditing views and processing payments! 💸\n\nPlease submit your new videos starting Monday morning.";

const getMenu = async (telegramId) => {
    const isAgent = await Agent.findOne({ telegramId });
    const isInstaUser = await InstaUser.findOne({ telegramId });

    let buttons = [];
    if (!isAgent) buttons.push(['🔑 Register as Agent']);
    else buttons.push(['➕ Add Insta User', '📊 My Agent Profile']);

    if (!isInstaUser) buttons.push(['🔗 Link Insta Account']); 
    else {
        buttons.push(['🎥 Submit My Videos', '💰 My Earnings']);
        buttons.push(['🔌 Unlink / Logout']);
    }

    buttons.push(['❌ Cancel / Main Menu']);
    return Markup.keyboard(buttons).resize();
};

bot.start(async (ctx) => {
    ctx.session = null;
    ctx.reply("🤖 Welcome to the Management Bot!\n\nPlease choose an option from the menu below:", await getMenu(ctx.from.id));
});

bot.hears('❌ Cancel / Main Menu', async (ctx) => {
    ctx.session = null;
    ctx.reply("Action cancelled. You are back at the main menu. 🏠", await getMenu(ctx.from.id));
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

    // CHECK 1: Button click karne par block karo
    if (isWeekendIST()) {
        ctx.session = null; // Session clear karo taaki link ka wait na kare
        return ctx.reply(weekendErrorMessage);
    }

    ctx.session = { step: 'AWAITING_MY_VIDEO_LINKS' };
    ctx.reply(`Welcome @${user.instaUsername}! ✅\n\nNow, send your video **Links**.\nYou can send multiple links in a single message.`);
});

bot.hears('💰 My Earnings', async (ctx) => {
    const user = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Your account is not linked.");
    
    const totalEarned = Math.floor((user.totalViews || 0) / 1000000) * 800;
    const paid = user.paidAmount || 0;
    const pending = totalEarned - paid;

    ctx.reply(
        `👤 **Creator Stats (@${user.instaUsername})**\n\n` +
        `👀 **Total Approved Views:** ${user.totalViews.toLocaleString()}\n\n` +
        `💰 **Total Earned:** ₹${totalEarned}\n` +
        `✅ **Amount Received:** ₹${paid}\n` +
        `⏳ **Pending Payment:** ₹${pending > 0 ? pending : 0}\n\n` +
        `Keep uploading and earning! 🚀`
    );
});

bot.hears('🔌 Unlink / Logout', async (ctx) => {
    const user = await InstaUser.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("You don't have a linked account.");
    await InstaUser.updateMany({ telegramId: ctx.from.id }, { $set: { telegramId: null } });
    ctx.session = null;
    ctx.reply("🔌 Your account has been successfully unlinked (logged out).", await getMenu(ctx.from.id));
});

const getProfileMessageAndKeyboard = async (telegramId, page = 0) => {
    const agent = await Agent.findOne({ telegramId });
    const addedUsers = await InstaUser.find({ addedByAgentTelegramId: telegramId });
    
    const totalEarned = agent.totalInstaAccountsAdded * 200;
    const paid = agent.paidAmount || 0;
    const pending = totalEarned - paid;

    let profileMessage = `👤 **Agent Profile (${agent.name})**\n`;
    profileMessage += `**Accounts Added:** ${agent.totalInstaAccountsAdded}\n\n`;
    profileMessage += `💰 **Total Earned:** ₹${totalEarned}\n`;
    profileMessage += `✅ **Amount Received:** ₹${paid}\n`;
    profileMessage += `⏳ **Pending Payment:** ₹${pending > 0 ? pending : 0}\n\n`;

    const inlineButtons = [];
    inlineButtons.push([Markup.button.callback(`🏦 Edit MY Agent Bank Details`, `editbank_self`)]);

    if (addedUsers.length > 0) {
        const limit = 10;
        const totalPages = Math.ceil(addedUsers.length / limit);
        const start = page * limit;
        const pageUsers = addedUsers.slice(start, start + limit);

        profileMessage += `👥 **Your Added Accounts (Page ${page + 1}/${totalPages}):**\n`;
        pageUsers.forEach((user) => {
            const isLinked = user.telegramId ? '✅' : '⏳';
            inlineButtons.push([Markup.button.callback(`✏️ Edit @${user.instaUsername} ${isLinked}`, `editbank_${user.instaUsername}`)]);
        });
        const navButtons = [];
        if (page > 0) navButtons.push(Markup.button.callback(`⬅️ Prev`, `page_${page - 1}`));
        if (page < totalPages - 1) navButtons.push(Markup.button.callback(`Next ➡️`, `page_${page + 1}`));
        if (navButtons.length > 0) inlineButtons.push(navButtons);
    } else {
        profileMessage += `🤷‍♂️ You haven't added any Instagram accounts yet.`;
    }

    return { profileMessage, keyboard: Markup.inlineKeyboard(inlineButtons) };
};

bot.hears('📊 My Agent Profile', async (ctx) => {
    const agent = await Agent.findOne({ telegramId: ctx.from.id });
    if (!agent) return;
    const { profileMessage, keyboard } = await getProfileMessageAndKeyboard(ctx.from.id, 0);
    ctx.reply(profileMessage, keyboard);
});

bot.action(/^page_(\d+)$/, async (ctx) => {
    try {
        const page = parseInt(ctx.match[1]);
        const { profileMessage, keyboard } = await getProfileMessageAndKeyboard(ctx.from.id, page);
        await ctx.editMessageText(profileMessage, keyboard);
        await ctx.answerCbQuery().catch(()=>{});
    } catch (e) { console.error(e); }
});

bot.action(/^editbank_(.+)$/, async (ctx) => {
    try {
        const target = ctx.match[1];
        if (target === 'self') {
            ctx.session = { step: 'AWAITING_AGENT_NEW_BANK' };
            await ctx.answerCbQuery().catch(()=>{}); 
            return ctx.reply(`🏦 You are updating **YOUR OWN** Agent Bank Details.\n\nPlease enter the **New Bank Details**:`);
        }
        const user = await InstaUser.findOne({ instaUsername: target, addedByAgentTelegramId: ctx.from.id });
        if (!user) {
            await ctx.answerCbQuery("❌ You are not authorized to edit this user.", { show_alert: true }).catch(()=>{});
            return;
        }
        ctx.session = { step: 'AWAITING_NEW_BANK', editInstaId: target };
        await ctx.answerCbQuery().catch(()=>{}); 
        await ctx.reply(`✏️ You are updating the bank details for **@${target}**.\n\nPlease enter the **New Bank Details**:`);
    } catch (error) { console.error("Button Action Error: ", error); }
});

bot.on('message', async (ctx) => {
    const state = ctx.session?.step;
    if (!state || !ctx.message.text) return;

    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;

    const ignoreList = ['🔑 Register as Agent', '🔗 Link Insta Account', '➕ Add Insta User', '🎥 Submit My Videos', '💰 My Earnings', '📊 My Agent Profile', '🔌 Unlink / Logout', '❌ Cancel / Main Menu'];
    if (ignoreList.includes(text)) return;

    try {
        if (state === 'AWAITING_TOKEN') {
            const tokenRecord = await Token.findOne({ token: text, isUsed: false });
            if (!tokenRecord) return ctx.reply("❌ Invalid token.");
            ctx.session.tempToken = text; ctx.session.step = 'AWAITING_AGENT_NAME';
            return ctx.reply("Token verified! ✅\nNow, enter your **Full Name**:");
        }
        if (state === 'AWAITING_AGENT_NAME') {
            ctx.session.tempName = text; ctx.session.step = 'AWAITING_AGENT_BANK';
            return ctx.reply(`Welcome ${text}! 🎉\nPlease enter your **Bank Details**:`);
        }
        if (state === 'AWAITING_AGENT_BANK') {
            await Token.updateOne({ token: ctx.session.tempToken }, { isUsed: true });
            await Agent.create({ telegramId, name: ctx.session.tempName, bankDetails: text, tokenUsed: ctx.session.tempToken });
            ctx.session = null; return ctx.reply("🎉 Registration successful!", await getMenu(telegramId));
        }
        if (state === 'AWAITING_INSTA_ID') {
            const cleanId = cleanUsername(text);
            if (await InstaUser.findOne({ instaUsername: cleanId })) return ctx.reply(`❌ Username already exists.`);
            ctx.session.tempInstaId = cleanId; ctx.session.step = 'AWAITING_INSTA_BANK';
            return ctx.reply(`ID @${cleanId} saved! ✅\nNow enter their **Bank Details**:`);
        }
        if (state === 'AWAITING_INSTA_BANK') {
            if (await InstaUser.findOne({ bankDetails: text })) return ctx.reply("❌ Bank details already linked to another user.");
            const savedInstaId = ctx.session.tempInstaId;
            await InstaUser.create({ instaUsername: savedInstaId, bankDetails: text, addedByAgentTelegramId: telegramId });
            await Agent.updateOne({ telegramId }, { $inc: { totalInstaAccountsAdded: 1 } });
            ctx.session = null; return ctx.reply(`✅ User '@${savedInstaId}' added!`, await getMenu(telegramId));
        }
        if (state === 'AWAITING_LINK_USERNAME') {
            const cleanId = cleanUsername(text);
            const user = await InstaUser.findOne({ instaUsername: cleanId });
            if (!user) return ctx.reply("❌ Username not found.");
            if (user.telegramId) return ctx.reply("❌ Account already linked.");
            ctx.session.linkInstaId = cleanId; ctx.session.step = 'AWAITING_LINK_BANK';
            return ctx.reply("Enter the **exact Bank Details** provided when adding this account:");
        }
        if (state === 'AWAITING_LINK_BANK') {
            const user = await InstaUser.findOne({ instaUsername: ctx.session.linkInstaId });
            if (user.bankDetails !== text) return ctx.reply("❌ Bank details did not match.");
            user.telegramId = telegramId; await user.save();
            ctx.session = null; return ctx.reply("🎉 Account successfully linked!", await getMenu(telegramId));
        }

        if (state === 'AWAITING_MY_VIDEO_LINKS') {
            // CHECK 2: Link paste karte waqt wapas check karo ki weekend toh nahi hai!
            if (isWeekendIST()) {
                ctx.session = null; // Session destroy kar do
                return ctx.reply(weekendErrorMessage);
            }

            const formattedText = text.replace(/(https?:\/\/)/gi, ' $1');
            const instaRegex = /(https?:\/\/(?:www\.)?instagram\.com[^\s]+)/gi;
            const rawLinks = formattedText.match(instaRegex) || [];
            const uniquePastedLinks = [...new Set(rawLinks)];

            if (uniquePastedLinks.length === 0) {
                return ctx.reply("❌ No valid Instagram link found. Please ensure the link contains 'instagram.com':");
            }

            const existingVideos = await Video.find({ videoLink: { $in: uniquePastedLinks } });
            const existingLinks = existingVideos.map(v => v.videoLink);
            const newLinks = uniquePastedLinks.filter(link => !existingLinks.includes(link));

            if (newLinks.length === 0) {
                return ctx.reply("❌ All the links you sent have already been submitted.", await getMenu(telegramId));
            }

            const user = await InstaUser.findOne({ telegramId });
            const videoDocs = newLinks.map(link => ({
                instaUsername: user.instaUsername,
                videoLink: link,
                status: 'Pending'
            }));

            await Video.insertMany(videoDocs);
            ctx.session = null;

            let replyMsg = `🎉 Success! **${newLinks.length}** new Instagram link(s) submitted for this week.`;
            if (existingLinks.length > 0) replyMsg += `\n⚠️ **${existingLinks.length}** link(s) were ignored (already in system).`;
            if (uniquePastedLinks.length < formattedText.match(/(https?:\/\/[^\s]+)/g)?.length) {
                replyMsg += `\n🚮 Note: Non-Instagram links were automatically ignored.`;
            }
            return ctx.reply(replyMsg, await getMenu(telegramId));
        }

        if (state === 'AWAITING_AGENT_NEW_BANK') {
            await Agent.updateOne({ telegramId }, { bankDetails: text });
            ctx.session = null; return ctx.reply(`✅ Your Agent bank details have been successfully updated!`, await getMenu(telegramId));
        }

        if (state === 'AWAITING_NEW_BANK') {
            const targetUsername = ctx.session.editInstaId;
            if (await InstaUser.findOne({ bankDetails: text, instaUsername: { $ne: targetUsername } })) {
                return ctx.reply("❌ Bank details are used by another account. Enter unique details:");
            }
            await InstaUser.updateOne({ instaUsername: targetUsername }, { bankDetails: text });
            ctx.session = null; return ctx.reply(`✅ Bank details for **@${targetUsername}** successfully updated!`, await getMenu(telegramId));
        }

    } catch (error) {
        console.error("Bot Error: ", error);
        ctx.reply("❌ A server error occurred. Please press 'Cancel' and try again.");
    }
});

bot.catch((err, ctx) => console.error(`[Bot Error] ${err.message}`));
module.exports = bot;
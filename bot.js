const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const UNIVERSE_ID = process.env.UNIVERSE_ID;
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;

const commands = [
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Permanently ban a player from the game')
        .addStringOption(opt => opt.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Ban reason').setRequired(true)),

    new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Temporarily ban a player from the game')
        .addStringOption(opt => opt.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addNumberOption(opt => opt.setName('duration').setDescription('Duration in minutes').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Ban reason').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a player from the game')
        .addStringOption(opt => opt.setName('userid').setDescription('Roblox User ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a player from the game')
        .addStringOption(opt => opt.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Kick reason').setRequired(true)),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send a global announcement to all players in the game')
        .addStringOption(opt => opt.setName('message').setDescription('The announcement message').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Announcement type').setRequired(false)
            .addChoices(
                { name: '📢 Info (Blue)', value: 'info' },
                { name: '⚠️ Warning (Yellow)', value: 'warning' },
                { name: '🚨 Alert (Red)', value: 'alert' },
                { name: '✅ Success (Green)', value: 'success' },
            )),
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
            body: commands.map(c => c.toJSON())
        });
        console.log('✅ Slash commands registered!');
    } catch (err) {
        console.error('❌ Failed to register commands:', err.message);
    }
}

async function getRobloxUsername(userId) {
    try {
        const res = await axios.get(`https://users.roblox.com/v1/users/${userId}`, { timeout: 5000 });
        return res.data.name || 'Unknown';
    } catch {
        return null;
    }
}

async function sendToRoblox(topic, data) {
    try {
        await axios.post(
            `https://apis.roblox.com/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${topic}`,
            { message: JSON.stringify(data) },
            {
                headers: { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': 'application/json' },
                timeout: 8000
            }
        );
        return true;
    } catch (err) {
        console.error('Failed to send to Roblox:', err.response?.data || err.message);
        return false;
    }
}

function hasPermission(member) {
    if (!ALLOWED_ROLE_ID) return true;
    return member.roles.cache.has(ALLOWED_ROLE_ID);
}

// =============================================
// HANDLE SLASH COMMANDS
// =============================================
client.on('interactionCreate', (interaction) => {
    // Fire and forget — handle async inside without blocking event loop
    if (!interaction.isChatInputCommand()) return;
    handleCommand(interaction).catch(err => {
        console.error('Command handler error:', err.message);
    });
});

async function handleCommand(interaction) {
    // Defer FIRST before anything else
    try {
        await interaction.deferReply();
    } catch (err) {
        console.error('Defer failed:', err.message);
        return;
    }

    if (!hasPermission(interaction.member)) {
        return interaction.editReply('❌ You do not have permission to use this command!');
    }

    const { commandName } = interaction;

    try {
        // /ban
        if (commandName === 'ban') {
            const userId = parseInt(interaction.options.getString('userid'));
            const reason = interaction.options.getString('reason');
            if (isNaN(userId)) return interaction.editReply('❌ Invalid User ID! Must be a number.');
            const username = await getRobloxUsername(userId);
            if (!username) return interaction.editReply(`❌ No Roblox account found with ID **${userId}**!`);
            const success = await sendToRoblox('BanPlayer', { userId, username, reason, duration: -1, moderator: interaction.user.tag });
            const embed = new EmbedBuilder().setTitle('🔨 Player Banned').setColor(0xFF0000)
                .addFields({ name: 'Username', value: username, inline: true }, { name: 'User ID', value: `${userId}`, inline: true }, { name: 'Duration', value: 'Permanent', inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: interaction.user.tag }).setTimestamp();
            return interaction.editReply({ content: success ? '✅ Ban sent!' : '⚠️ Ban saved but player may be offline.', embeds: [embed] });
        }

        // /tempban
        if (commandName === 'tempban') {
            const userId = parseInt(interaction.options.getString('userid'));
            const duration = interaction.options.getNumber('duration');
            const reason = interaction.options.getString('reason');
            if (isNaN(userId)) return interaction.editReply('❌ Invalid User ID! Must be a number.');
            const username = await getRobloxUsername(userId);
            if (!username) return interaction.editReply(`❌ No Roblox account found with ID **${userId}**!`);
            const success = await sendToRoblox('BanPlayer', { userId, username, reason, duration, moderator: interaction.user.tag });
            let durationText = duration < 60 ? `${duration} minute(s)` : duration < 1440 ? `${(duration/60).toFixed(1)} hour(s)` : `${(duration/1440).toFixed(1)} day(s)`;
            const embed = new EmbedBuilder().setTitle('⏱️ Player Temp Banned').setColor(0xFF8C00)
                .addFields({ name: 'Username', value: username, inline: true }, { name: 'User ID', value: `${userId}`, inline: true }, { name: 'Duration', value: durationText, inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: interaction.user.tag }).setTimestamp();
            return interaction.editReply({ content: success ? '✅ Temp ban sent!' : '⚠️ Ban saved but player may be offline.', embeds: [embed] });
        }

        // /unban
        if (commandName === 'unban') {
            const userId = parseInt(interaction.options.getString('userid'));
            if (isNaN(userId)) return interaction.editReply('❌ Invalid User ID! Must be a number.');
            const username = await getRobloxUsername(userId) || 'Unknown';
            await sendToRoblox('UnbanPlayer', { userId, username, moderator: interaction.user.tag });
            const embed = new EmbedBuilder().setTitle('✅ Player Unbanned').setColor(0x00FF00)
                .addFields({ name: 'Username', value: username, inline: true }, { name: 'User ID', value: `${userId}`, inline: true }, { name: 'Moderator', value: interaction.user.tag }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /kick
        if (commandName === 'kick') {
            const userId = parseInt(interaction.options.getString('userid'));
            const reason = interaction.options.getString('reason');
            if (isNaN(userId)) return interaction.editReply('❌ Invalid User ID! Must be a number.');
            const username = await getRobloxUsername(userId);
            if (!username) return interaction.editReply(`❌ No Roblox account found with ID **${userId}**!`);
            const success = await sendToRoblox('KickPlayer', { userId, username, reason, moderator: interaction.user.tag });
            const embed = new EmbedBuilder().setTitle('👢 Player Kicked').setColor(0xFFFF00)
                .addFields({ name: 'Username', value: username, inline: true }, { name: 'User ID', value: `${userId}`, inline: true }, { name: 'Reason', value: reason }, { name: 'Moderator', value: interaction.user.tag }).setTimestamp();
            return interaction.editReply({ content: success ? '✅ Kick sent!' : '❌ Failed to kick.', embeds: [embed] });
        }

        // /announce
        if (commandName === 'announce') {
            const message = interaction.options.getString('message');
            const type = interaction.options.getString('type') || 'info';
            const success = await sendToRoblox('Announce', { message, type, moderator: interaction.user.tag });
            const colors = { info: 0x3498DB, warning: 0xF1C40F, alert: 0xFF0000, success: 0x2ECC71 };
            const typeLabels = { info: '📢 Info', warning: '⚠️ Warning', alert: '🚨 Alert', success: '✅ Success' };
            const embed = new EmbedBuilder().setTitle('📣 Announcement Sent').setColor(colors[type])
                .addFields({ name: 'Type', value: typeLabels[type], inline: true }, { name: 'Sent by', value: interaction.user.tag, inline: true }, { name: 'Message', value: message }).setTimestamp();
            return interaction.editReply({ content: success ? '✅ Announcement sent to all players!' : '❌ Failed to send.', embeds: [embed] });
        }

    } catch (err) {
        console.error(`❌ Error handling ${commandName}:`, err.message);
        try { await interaction.editReply('❌ An error occurred. Please try again.'); } catch {}
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    await registerCommands();
});

client.login(BOT_TOKEN);

// Keep-alive HTTP server
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running! ✅');
}).listen(PORT, () => {
    console.log(`✅ Keep-alive server running on port ${PORT}`);
});

// Crash prevention
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err.message));
process.on('uncaughtException', err => console.error('Uncaught exception:', err.message));
client.on('error', err => console.error('Client error:', err.message));

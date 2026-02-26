const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits, Collection } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const spamTracker = new Collection();
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 3000;
const MUTE_DURATION = 3600;
const welcomeConfig = new Collection();
const lockdownState = new Collection();
const antispamEnabled = new Collection();
let scheduleCounter = 1;

// =============================================
// SUPABASE HELPERS — SCHEDULES
// =============================================
async function saveSchedule(schedule) {
    const { error } = await supabase.from('schedules').insert([{
        id: schedule.id,
        guild_id: schedule.guildId,
        guild_name: schedule.guildName,
        channel_id: schedule.channelId,
        title: schedule.title,
        theme: schedule.theme,
        ping_str: schedule.pingStr,
        unix_timestamp: schedule.unixTimestamp,
        scheduled_time: schedule.time.toISOString(),
        created_by: schedule.createdBy
    }]);
    if (error) console.error('Supabase save error:', error.message);
}

async function deleteSchedule(id) {
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) console.error('Supabase delete error:', error.message);
}

async function loadSchedules() {
    const { data, error } = await supabase.from('schedules').select('*');
    if (error) { console.error('Supabase load error:', error.message); return []; }
    return data || [];
}

async function getSchedulesByGuild(guildId) {
    const { data, error } = await supabase.from('schedules').select('*').eq('guild_id', guildId);
    if (error) { console.error('Supabase query error:', error.message); return []; }
    return data || [];
}

async function getAllSchedules() {
    const { data, error } = await supabase.from('schedules').select('*');
    if (error) { console.error('Supabase query error:', error.message); return []; }
    return data || [];
}

// =============================================
// SUPABASE HELPERS — GAME (tokens, luck)
// =============================================

// Get or create player profile
async function getPlayer(userId, username) {
    const { data, error } = await supabase.from('players').select('*').eq('user_id', userId).single();
    if (error && error.code === 'PGRST116') {
        // Not found, create new
        const newPlayer = {
            user_id: userId,
            username: username,
            tokens: 0,
            luck_points: 0,
            last_daily: null,
            last_pray: null,
            total_wins: 0,
            total_losses: 0
        };
        const { data: created, error: createErr } = await supabase.from('players').insert([newPlayer]).select().single();
        if (createErr) { console.error('Create player error:', createErr.message); return null; }
        return created;
    }
    if (error) { console.error('Get player error:', error.message); return null; }
    return data;
}

async function updatePlayer(userId, updates) {
    const { error } = await supabase.from('players').update(updates).eq('user_id', userId);
    if (error) console.error('Update player error:', error.message);
}

async function getLeaderboard() {
    const { data, error } = await supabase.from('players').select('*').order('tokens', { ascending: false }).limit(10);
    if (error) { console.error('Leaderboard error:', error.message); return []; }
    return data || [];
}

// =============================================
// SLASH COMMANDS
// =============================================
const commands = [
    // ROLE
    new SlashCommandBuilder()
        .setName('giverole').setDescription('Give a role to a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Role to give').setRequired(true)),

    new SlashCommandBuilder()
        .setName('removerole').setDescription('Remove a role from a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The member').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true)),

    // WELCOME
    new SlashCommandBuilder()
        .setName('setwelcome').setDescription('Set the welcome channel and message')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Welcome channel').setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('Welcome message (use {user} for mention)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('welcometest').setDescription('Test the welcome message')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // LOCKDOWN
    new SlashCommandBuilder()
        .setName('lockdown').setDescription('Lock all TEXT channels only (voice stays open)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for lockdown').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlock').setDescription('Unlock all text channels')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // VOICE LOCK
    new SlashCommandBuilder()
        .setName('lockvc').setDescription('Lock a specific voice channel for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to lock').setRequired(true))
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unlockvc').setDescription('Unlock a specific voice channel for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to unlock').setRequired(true))
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lockallvc').setDescription('Lock all voice channels for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unlockallvc').setDescription('Unlock all voice channels for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas').setRequired(true)),

    // ANTI-SPAM
    new SlashCommandBuilder()
        .setName('antispam').setDescription('Enable or disable anti-spam')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('status').setDescription('Enable or disable').setRequired(true)
            .addChoices({ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' })),

    // SCHEDULE
    new SlashCommandBuilder()
        .setName('schedule_msg').setDescription('Schedule a message to be sent at a specific time')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send the message in').setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Title e.g. COLLAB WITH FTU CLAN').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date and time e.g. 2026-02-28 20:30 (PHT)').setRequired(true))
        .addStringOption(opt => opt.setName('theme').setDescription('Theme e.g. VALENTINES THEME').setRequired(false))
        .addStringOption(opt => opt.setName('ping').setDescription('Roles to ping e.g. everyone, Member').setRequired(false)),

    new SlashCommandBuilder()
        .setName('list_schedules').setDescription('List scheduled messages in this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('list_all_schedules').setDescription('List ALL scheduled messages across all servers')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('cancel_schedule').setDescription('Cancel a scheduled message by ID')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('id').setDescription('Schedule ID to cancel').setRequired(true)),

    // INFO
    new SlashCommandBuilder()
        .setName('serverinfo').setDescription('Show server information')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('userinfo').setDescription('Show info about a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user').setRequired(false)),

    // ==================
    // GAME COMMANDS
    // ==================

    // Daily reward
    new SlashCommandBuilder()
        .setName('daily').setDescription('Claim your daily 100 tokens reward 🎁'),

    // Wallet / profile
    new SlashCommandBuilder()
        .setName('wallet').setDescription('Check your tokens and luck points 👛')
        .addUserOption(opt => opt.setName('user').setDescription('Check another player').setRequired(false)),

    // Coin flip
    new SlashCommandBuilder()
        .setName('coinflip').setDescription('Flip a coin and bet your tokens! 🪙')
        .addStringOption(opt => opt.setName('side').setDescription('Heads or Tails?').setRequired(true)
            .addChoices({ name: '🔵 Heads', value: 'heads' }, { name: '🔴 Tails', value: 'tails' }))
        .addIntegerOption(opt => opt.setName('bet').setDescription('How many tokens to bet').setRequired(true).setMinValue(1)),

    // Transfer tokens
    new SlashCommandBuilder()
        .setName('transfer').setDescription('Send tokens to another player 💸')
        .addUserOption(opt => opt.setName('user').setDescription('Player to send tokens to').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('How many tokens to send').setRequired(true).setMinValue(1)),

    // Pray for luck
    new SlashCommandBuilder()
        .setName('pray').setDescription('Pray to the gods for luck points 🙏 (once every 4 hours)'),

    // Leaderboard
    new SlashCommandBuilder()
        .setName('leaderboard').setDescription('Top 10 richest players 🏆'),

    // HELP
    new SlashCommandBuilder()
        .setName('help').setDescription('Show all available commands'),
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
        console.log('✅ Global slash commands registered!');
    } catch (err) {
        console.error('❌ Failed to register commands:', err.message);
    }
}

// =============================================
// ANTI-SPAM + PREFIX COMMANDS
// =============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;

    if (message.content.toLowerCase() === '!lockdown') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
            return message.reply('❌ You need Administrator permission!');
        message.channel.send('⏳ Locking all text channels...');
        const textChannels = message.guild.channels.cache.filter(c => c.type === 0);
        let locked = 0;
        for (const [, channel] of textChannels) {
            try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); locked++; } catch {}
        }
        const embed = new EmbedBuilder().setTitle('🔒 Server Text Lockdown').setColor(0xFF0000)
            .setDescription(`All **${locked}** text channels locked. 🔊 Voice channels are **NOT** affected.`)
            .addFields({ name: 'By', value: `${message.author}` }).setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (message.content.toLowerCase() === '!unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
            return message.reply('❌ You need Administrator permission!');
        message.channel.send('⏳ Unlocking all text channels...');
        const textChannels = message.guild.channels.cache.filter(c => c.type === 0);
        let unlocked = 0;
        for (const [, channel] of textChannels) {
            try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }); unlocked++; } catch {}
        }
        const embed = new EmbedBuilder().setTitle('🔓 Server Text Unlocked').setColor(0x2ECC71)
            .setDescription(`All **${unlocked}** text channels unlocked.`)
            .addFields({ name: 'By', value: `${message.author}` }).setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    // Anti-spam
    if (!antispamEnabled.get(guildId)) return;
    const userId = message.author.id;
    const now = Date.now();
    if (!spamTracker.has(userId)) { spamTracker.set(userId, { count: 1, firstMessage: now }); return; }
    const data = spamTracker.get(userId);
    if (now - data.firstMessage > SPAM_WINDOW) { spamTracker.set(userId, { count: 1, firstMessage: now }); return; }
    data.count++;
    spamTracker.set(userId, data);
    if (data.count >= SPAM_LIMIT) {
        spamTracker.delete(userId);
        try {
            const member = await message.guild.members.fetch(userId);
            await member.timeout(MUTE_DURATION * 1000, 'Anti-spam');
            const embed = new EmbedBuilder().setTitle('🚫 Anti-Spam Triggered').setColor(0xFF0000)
                .setDescription(`${message.author} timed out for **${MUTE_DURATION} seconds** for spamming.`).setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) { console.error('Timeout failed:', err.message); }
    }
});

// =============================================
// WELCOME
// =============================================
client.on('guildMemberAdd', async (member) => {
    const config = welcomeConfig.get(member.guild.id);
    if (!config) return;
    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle('👋 Welcome!').setColor(0x2ECC71)
        .setDescription(config.message.replace('{user}', member.toString()))
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: `Member #${member.guild.memberCount}` }).setTimestamp();
    channel.send({ embeds: [embed] });
});

// =============================================
// SLASH COMMAND HANDLER
// =============================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try { await interaction.deferReply(); } catch { return; }
    const { commandName, guild } = interaction;

    try {

        // /help
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📋 Yagami-Bot Commands')
                .setColor(0x3498DB)
                .addFields(
                    { name: '👥 Role Management', value: '`/giverole` — Give a role\n`/removerole` — Remove a role' },
                    { name: '👋 Welcome', value: '`/setwelcome` — Set welcome\n`/welcometest` — Test welcome' },
                    { name: '🔒 Text Lockdown', value: '`/lockdown` or `!lockdown` — Lock text channels\n`/unlock` or `!unlock` — Unlock text channels' },
                    { name: '🔊 Voice Lock', value: '`/lockvc` — Lock specific VC\n`/unlockvc` — Unlock specific VC\n`/lockallvc` — Lock all VCs\n`/unlockallvc` — Unlock all VCs' },
                    { name: '🚫 Anti-Spam', value: '`/antispam` — Enable/disable anti-spam' },
                    { name: '📅 Scheduled Messages', value: '`/schedule_msg` — Schedule a message\n`/list_schedules` — List this server schedules\n`/list_all_schedules` — List all schedules\n`/cancel_schedule` — Cancel a schedule' },
                    { name: '📊 Info', value: '`/serverinfo` — Server info\n`/userinfo` — User info' },
                    { name: '🎮 Games & Economy', value: '`/daily` — Claim 100 tokens daily\n`/wallet` — Check tokens & luck\n`/coinflip` — Bet tokens on a coin flip\n`/transfer` — Send tokens to a player\n`/pray` — Pray for luck points (every 4h)\n`/leaderboard` — Top 10 richest players' }
                )
                .setFooter({ text: 'Admin commands require Administrator permission' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /giverole
        if (commandName === 'giverole') {
            const user = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');
            const member = await guild.members.fetch(user.id);
            await member.roles.add(role);
            const embed = new EmbedBuilder().setTitle('✅ Role Given').setColor(0x2ECC71)
                .addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Role', value: `${role}`, inline: true }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /removerole
        if (commandName === 'removerole') {
            const user = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');
            const member = await guild.members.fetch(user.id);
            await member.roles.remove(role);
            const embed = new EmbedBuilder().setTitle('✅ Role Removed').setColor(0xFF8C00)
                .addFields({ name: 'User', value: `${user}`, inline: true }, { name: 'Role', value: `${role}`, inline: true }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /setwelcome
        if (commandName === 'setwelcome') {
            const channel = interaction.options.getChannel('channel');
            const message = interaction.options.getString('message');
            welcomeConfig.set(guild.id, { channelId: channel.id, message });
            const embed = new EmbedBuilder().setTitle('✅ Welcome Setup').setColor(0x2ECC71)
                .addFields({ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Message', value: message }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /welcometest
        if (commandName === 'welcometest') {
            const config = welcomeConfig.get(guild.id);
            if (!config) return interaction.editReply('❌ Welcome not set up! Use `/setwelcome` first.');
            const channel = guild.channels.cache.get(config.channelId);
            if (!channel) return interaction.editReply('❌ Welcome channel not found!');
            const embed = new EmbedBuilder().setTitle('👋 Welcome!').setColor(0x2ECC71)
                .setDescription(config.message.replace('{user}', interaction.user.toString()))
                .setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({ text: `Member #${guild.memberCount}` }).setTimestamp();
            channel.send({ embeds: [embed] });
            return interaction.editReply('✅ Test welcome message sent!');
        }

        // /lockdown
        if (commandName === 'lockdown') {
            const reason = interaction.options.getString('reason') || 'No reason provided';
            lockdownState.set(guild.id, true);
            await interaction.editReply('⏳ Locking all text channels...');
            const textChannels = guild.channels.cache.filter(c => c.type === 0);
            let lockedText = 0;
            for (const [, channel] of textChannels) {
                try { await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }); lockedText++; } catch {}
            }
            const embed = new EmbedBuilder().setTitle('🔒 Server Text Lockdown').setColor(0xFF0000)
                .setDescription('All text channels locked. 🔊 Voice channels are NOT affected.')
                .addFields({ name: 'Reason', value: reason }, { name: 'Text Locked', value: `${lockedText}`, inline: true }, { name: 'By', value: `${interaction.user}`, inline: true }).setTimestamp();
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // /unlock
        if (commandName === 'unlock') {
            lockdownState.set(guild.id, false);
            await interaction.editReply('⏳ Unlocking all text channels...');
            const textChannels = guild.channels.cache.filter(c => c.type === 0);
            let unlockedText = 0;
            for (const [, channel] of textChannels) {
                try { await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }); unlockedText++; } catch {}
            }
            const embed = new EmbedBuilder().setTitle('🔓 Server Text Unlocked').setColor(0x2ECC71)
                .setDescription('All text channels are now unlocked.')
                .addFields({ name: 'Text Unlocked', value: `${unlockedText}`, inline: true }, { name: 'By', value: `${interaction.user}`, inline: true }).setTimestamp();
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // /lockvc
        if (commandName === 'lockvc') {
            const channel = interaction.options.getChannel('channel');
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            if (channel.type !== 2) return interaction.editReply('❌ Please select a voice channel!');
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            for (const role of resolvedRoles) await channel.permissionOverwrites.edit(role, { Connect: false });
            const embed = new EmbedBuilder().setTitle('🔒 Voice Channel Locked').setColor(0xFF0000)
                .addFields({ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Roles', value: roleNames.join(', ') }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /unlockvc
        if (commandName === 'unlockvc') {
            const channel = interaction.options.getChannel('channel');
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            if (channel.type !== 2) return interaction.editReply('❌ Please select a voice channel!');
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            for (const role of resolvedRoles) await channel.permissionOverwrites.edit(role, { Connect: true });
            const embed = new EmbedBuilder().setTitle('🔓 Voice Channel Unlocked').setColor(0x2ECC71)
                .addFields({ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Roles', value: roleNames.join(', ') }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /lockallvc
        if (commandName === 'lockallvc') {
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            await interaction.editReply('⏳ Locking all voice channels...');
            const voiceChannels = guild.channels.cache.filter(c => c.type === 2);
            let count = 0;
            for (const [, channel] of voiceChannels) {
                for (const role of resolvedRoles) { try { await channel.permissionOverwrites.edit(role, { Connect: false }); } catch {} }
                count++;
            }
            const embed = new EmbedBuilder().setTitle('🔒 All Voice Channels Locked').setColor(0xFF0000)
                .addFields({ name: 'Channels Locked', value: `${count}`, inline: true }, { name: 'Roles', value: roleNames.join(', ') }).setTimestamp();
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // /unlockallvc
        if (commandName === 'unlockallvc') {
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            await interaction.editReply('⏳ Unlocking all voice channels...');
            const voiceChannels = guild.channels.cache.filter(c => c.type === 2);
            let count = 0;
            for (const [, channel] of voiceChannels) {
                for (const role of resolvedRoles) { try { await channel.permissionOverwrites.edit(role, { Connect: true }); } catch {} }
                count++;
            }
            const embed = new EmbedBuilder().setTitle('🔓 All Voice Channels Unlocked').setColor(0x2ECC71)
                .addFields({ name: 'Channels Unlocked', value: `${count}`, inline: true }, { name: 'Roles', value: roleNames.join(', ') }).setTimestamp();
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // /antispam
        if (commandName === 'antispam') {
            const status = interaction.options.getString('status');
            antispamEnabled.set(guild.id, status === 'enable');
            const embed = new EmbedBuilder()
                .setTitle(status === 'enable' ? '✅ Anti-Spam Enabled' : '❌ Anti-Spam Disabled')
                .setColor(status === 'enable' ? 0x2ECC71 : 0xFF0000)
                .setDescription(status === 'enable'
                    ? `Members sending more than **${SPAM_LIMIT} messages** in **${SPAM_WINDOW/1000}s** will be timed out for **${MUTE_DURATION}s**.`
                    : 'Anti-spam is now disabled.')
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /schedule_msg
        if (commandName === 'schedule_msg') {
            const channel = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title');
            const dateStr = interaction.options.getString('date');
            const theme = interaction.options.getString('theme') || null;
            const pingStr = interaction.options.getString('ping') || null;

            // PHT = UTC+8
            const scheduledTime = new Date(dateStr + '+08:00');
            if (isNaN(scheduledTime.getTime()))
                return interaction.editReply('❌ Invalid date! Use format: `YYYY-MM-DD HH:MM` e.g. `2026-02-28 20:30`');
            if (scheduledTime <= new Date())
                return interaction.editReply('❌ Scheduled time must be in the future!');

            const unixTimestamp = Math.floor(scheduledTime.getTime() / 1000);
            const id = `SCH-${scheduleCounter++}`;

            const schedule = { id, channelId: channel.id, guildId: guild.id, guildName: guild.name, title, theme, pingStr, time: scheduledTime, unixTimestamp, createdBy: interaction.user.tag };

            await saveSchedule(schedule);

            const embed = new EmbedBuilder()
                .setTitle('📅 Message Scheduled! (PHT)')
                .setColor(0x2ECC71)
                .addFields(
                    { name: 'ID', value: id, inline: true },
                    { name: 'Channel', value: `${channel}`, inline: true },
                    { name: 'Title', value: title },
                    { name: 'Send Time', value: `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)` },
                    { name: 'Theme', value: theme || 'None', inline: true },
                    { name: 'Ping', value: pingStr || 'None', inline: true }
                )
                .setFooter({ text: `Use /cancel_schedule id:${id} to cancel` })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /list_schedules
        if (commandName === 'list_schedules') {
            const rows = await getSchedulesByGuild(guild.id);
            if (rows.length === 0) return interaction.editReply('📭 No scheduled messages for this server.');
            const embed = new EmbedBuilder().setTitle(`📅 Scheduled Messages — ${guild.name}`).setColor(0x3498DB).setTimestamp();
            for (const s of rows) {
                embed.addFields({ name: `${s.id} — ${s.title}`, value: `Channel: <#${s.channel_id}>\nTime: <t:${s.unix_timestamp}:F> (<t:${s.unix_timestamp}:R>)\nTheme: ${s.theme || 'None'}` });
            }
            return interaction.editReply({ embeds: [embed] });
        }

        // /list_all_schedules
        if (commandName === 'list_all_schedules') {
            const rows = await getAllSchedules();
            if (rows.length === 0) return interaction.editReply('📭 No scheduled messages anywhere.');
            const embed = new EmbedBuilder().setTitle('📅 All Scheduled Messages').setColor(0x9B59B6).setTimestamp();
            for (const s of rows) {
                embed.addFields({ name: `${s.id} — ${s.title}`, value: `Server: ${s.guild_name}\nChannel: <#${s.channel_id}>\nTime: <t:${s.unix_timestamp}:F> (<t:${s.unix_timestamp}:R>)` });
            }
            return interaction.editReply({ embeds: [embed] });
        }

        // /cancel_schedule
        if (commandName === 'cancel_schedule') {
            const id = interaction.options.getString('id');
            const { data } = await supabase.from('schedules').select('*').eq('id', id).single();
            if (!data) return interaction.editReply(`❌ Schedule \`${id}\` not found!`);
            await deleteSchedule(id);
            return interaction.editReply(`✅ Cancelled schedule **${id}** — "${data.title}"`);
        }

        // /serverinfo
        if (commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(`📊 ${guild.name}`).setColor(0x3498DB).setThumbnail(guild.iconURL())
                .addFields(
                    { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                    { name: 'Members', value: `${guild.memberCount}`, inline: true },
                    { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                    { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true }
                ).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /userinfo
        if (commandName === 'userinfo') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = await guild.members.fetch(user.id).catch(() => null);
            const embed = new EmbedBuilder().setTitle(`👤 ${user.tag}`).setColor(0x3498DB).setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'ID', value: user.id, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
                    { name: 'Roles', value: member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => `${r}`).join(', ') || 'None' : 'N/A' }
                ).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // ==========================================
        // GAME COMMANDS
        // ==========================================

        // /daily — claim 100 tokens once per day (resets midnight PHT)
        if (commandName === 'daily') {
            const userId = interaction.user.id;
            const player = await getPlayer(userId, interaction.user.username);
            if (!player) return interaction.editReply('❌ Could not load your profile!');

            const now = new Date();
            // Midnight PHT = UTC+8
            const phtOffset = 8 * 60 * 60 * 1000;
            const phtNow = new Date(now.getTime() + phtOffset);
            const phtMidnight = new Date(Date.UTC(phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate()) - phtOffset);

            if (player.last_daily && new Date(player.last_daily) >= phtMidnight) {
                // Calculate next midnight PHT
                const nextMidnight = new Date(phtMidnight.getTime() + 24 * 60 * 60 * 1000);
                const unixNext = Math.floor(nextMidnight.getTime() / 1000);
                return interaction.editReply(`⏳ You already claimed your daily reward! Come back <t:${unixNext}:R>.`);
            }

            const reward = Math.floor(Math.random() * 4001) + 1000; // Random 1000–5000
            await updatePlayer(userId, {
                tokens: player.tokens + reward,
                last_daily: now.toISOString(),
                username: interaction.user.username
            });

            const embed = new EmbedBuilder()
                .setTitle('🎁 Daily Reward Claimed!')
                .setColor(0xF1C40F)
                .setDescription(`You received **${reward} 🪙 tokens**!`)
                .addFields(
                    { name: '💰 New Balance', value: `${player.tokens + reward} tokens`, inline: true },
                    { name: '🍀 Luck Points', value: `${player.luck_points}`, inline: true }
                )
                .setFooter({ text: 'Come back tomorrow for more!' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /wallet — check tokens and stats
        if (commandName === 'wallet') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const player = await getPlayer(targetUser.id, targetUser.username);
            if (!player) return interaction.editReply('❌ Could not load profile!');

            const winRate = (player.total_wins + player.total_losses) > 0
                ? ((player.total_wins / (player.total_wins + player.total_losses)) * 100).toFixed(1)
                : '0.0';

            const embed = new EmbedBuilder()
                .setTitle(`👛 ${targetUser.username}'s Wallet`)
                .setColor(0xF1C40F)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '🪙 Tokens', value: `${player.tokens}`, inline: true },
                    { name: '🍀 Luck Points', value: `${player.luck_points}`, inline: true },
                    { name: '🏆 Wins', value: `${player.total_wins}`, inline: true },
                    { name: '💀 Losses', value: `${player.total_losses}`, inline: true },
                    { name: '📊 Win Rate', value: `${winRate}%`, inline: true }
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /coinflip — bet tokens on heads or tails
        if (commandName === 'coinflip') {
            const userId = interaction.user.id;
            const side = interaction.options.getString('side');
            const bet = interaction.options.getInteger('bet');

            const player = await getPlayer(userId, interaction.user.username);
            if (!player) return interaction.editReply('❌ Could not load your profile!');

            if (player.tokens < bet)
                return interaction.editReply(`❌ You don't have enough tokens! You only have **${player.tokens} 🪙**.`);

            // Luck points give a small boost to win chance (max +10%)
            const luckBonus = Math.min(player.luck_points * 0.5, 10); // each luck point = +0.5%, max 10%
            const winChance = 50 + luckBonus;
            const roll = Math.random() * 100;
            const flipResult = roll < 50 ? 'heads' : 'tails';
            const won = flipResult === side;

            let newTokens = won ? player.tokens + bet : player.tokens - bet;
            // Consume 1 luck point per flip if they have any
            let newLuck = Math.max(0, player.luck_points - 1);

            await updatePlayer(userId, {
                tokens: newTokens,
                luck_points: newLuck,
                total_wins: won ? player.total_wins + 1 : player.total_wins,
                total_losses: won ? player.total_losses : player.total_losses + 1,
                username: interaction.user.username
            });

            const embed = new EmbedBuilder()
                .setTitle(won ? '🎉 You Won!' : '💀 You Lost!')
                .setColor(won ? 0x2ECC71 : 0xFF0000)
                .setDescription(
                    `The coin landed on **${flipResult === 'heads' ? '🔵 Heads' : '🔴 Tails'}**!\n` +
                    `You picked **${side === 'heads' ? '🔵 Heads' : '🔴 Tails'}**`
                )
                .addFields(
                    { name: won ? '💰 Winnings' : '💸 Lost', value: `${bet} 🪙 tokens`, inline: true },
                    { name: '🏦 Balance', value: `${newTokens} 🪙`, inline: true },
                    { name: '🍀 Luck Points', value: `${newLuck}`, inline: true }
                )
                .setFooter({ text: luckBonus > 0 ? `🍀 Luck gave you +${luckBonus.toFixed(1)}% win chance!` : 'Pray for luck to boost your odds!' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /transfer — send tokens to another player
        if (commandName === 'transfer') {
            const userId = interaction.user.id;
            const targetUser = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');

            if (targetUser.id === userId)
                return interaction.editReply('❌ You cannot transfer tokens to yourself!');
            if (targetUser.bot)
                return interaction.editReply('❌ You cannot transfer tokens to a bot!');

            const sender = await getPlayer(userId, interaction.user.username);
            if (!sender) return interaction.editReply('❌ Could not load your profile!');

            if (sender.tokens < amount)
                return interaction.editReply(`❌ Not enough tokens! You only have **${sender.tokens} 🪙**.`);

            const receiver = await getPlayer(targetUser.id, targetUser.username);
            if (!receiver) return interaction.editReply('❌ Could not load target profile!');

            await updatePlayer(userId, { tokens: sender.tokens - amount });
            await updatePlayer(targetUser.id, { tokens: receiver.tokens + amount, username: targetUser.username });

            const embed = new EmbedBuilder()
                .setTitle('💸 Token Transfer Complete!')
                .setColor(0x3498DB)
                .addFields(
                    { name: '📤 Sent By', value: `${interaction.user}`, inline: true },
                    { name: '📥 Received By', value: `${targetUser}`, inline: true },
                    { name: '🪙 Amount', value: `${amount} tokens`, inline: true },
                    { name: '💰 Your New Balance', value: `${sender.tokens - amount} tokens`, inline: true }
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /pray — gain luck points every 4 hours
        if (commandName === 'pray') {
            const userId = interaction.user.id;
            const player = await getPlayer(userId, interaction.user.username);
            if (!player) return interaction.editReply('❌ Could not load your profile!');

            const now = new Date();
            const cooldown = (Math.random() < 0.5 ? 1 : 2) * 60 * 60 * 1000; // Random 1 or 2 hours

            if (player.last_pray && (now - new Date(player.last_pray)) < cooldown) {
                const nextPray = Math.floor((new Date(player.last_pray).getTime() + cooldown) / 1000);
                return interaction.editReply(`🙏 The gods need time to listen... Pray again <t:${nextPray}:R>.`);
            }

            // Random luck points 1–5
            const luckGained = Math.floor(Math.random() * 10) + 1; // Random 1–10
            const newLuck = player.luck_points + luckGained;

            await updatePlayer(userId, { luck_points: newLuck, last_pray: now.toISOString() });

            let feelMsg;
            if (luckGained <= 2) feelMsg = 'You feel a little lucky...';
            else if (luckGained <= 4) feelMsg = 'You feel slightly lucky.';
            else if (luckGained <= 6) feelMsg = 'You feel lucky!';
            else if (luckGained <= 8) feelMsg = 'You feel very lucky!';
            else if (luckGained === 9) feelMsg = 'You feel extremely lucky!!';
            else feelMsg = 'You feel INCREDIBLY lucky!!!';

            const embed = new EmbedBuilder()
                .setTitle('🙏 Prayer')
                .setColor(0x9B59B6)
                .setDescription(`${interaction.user} prays... ${feelMsg}\nYou have **${newLuck} luck point(s)**!`)
                .setFooter({ text: 'Pray again in 1–2 hours!' })
                .setFooter({ text: 'Pray again in 1–2 hours!' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /leaderboard
        if (commandName === 'leaderboard') {
            const top = await getLeaderboard();
            if (top.length === 0) return interaction.editReply('📭 No players found yet!');

            const medals = ['🥇', '🥈', '🥉'];
            const desc = top.map((p, i) => {
                const medal = medals[i] || `**#${i + 1}**`;
                return `${medal} **${p.username}** — ${p.tokens} 🪙 tokens | 🍀 ${p.luck_points} luck`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🏆 Token Leaderboard')
                .setColor(0xF1C40F)
                .setDescription(desc)
                .setFooter({ text: 'Use /daily, /coinflip, and /pray to earn more!' })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

    } catch (err) {
        console.error(`❌ Error in ${commandName}:`, err.message);
        try { await interaction.editReply('❌ An error occurred. Make sure the bot has proper permissions!'); } catch {}
    }
});

// =============================================
// SCHEDULE POLLER (every 30 seconds)
// =============================================
async function runSchedulePoller() {
    const rows = await loadSchedules();
    const now = new Date();

    for (const s of rows) {
        const scheduledTime = new Date(s.scheduled_time);
        if (scheduledTime <= now) {
            try {
                const guild = client.guilds.cache.get(s.guild_id);
                if (!guild) { await deleteSchedule(s.id); continue; }
                const channel = guild.channels.cache.get(s.channel_id);
                if (!channel) { await deleteSchedule(s.id); continue; }

                let pingText = '';
                if (s.ping_str) {
                    const pingParts = s.ping_str.split(',').map(r => r.trim());
                    for (const p of pingParts) {
                        if (p.toLowerCase() === 'everyone') pingText += '@everyone ';
                        else if (p.toLowerCase() === 'here') pingText += '@here ';
                        else {
                            const role = guild.roles.cache.find(r => r.name.toLowerCase() === p.toLowerCase());
                            if (role) pingText += `<@&${role.id}> `;
                        }
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor(0x2C2F33)
                    .setDescription(
                        `**${s.title}**\n\n` +
                        `**<t:${s.unix_timestamp}:F> CALL TIME**` +
                        (s.theme ? `\n\n**${s.theme}**` : '')
                    );

                await channel.send({ content: pingText.trim() || null, embeds: [embed] });
                console.log(`[SCHEDULE] ✅ Sent: ${s.id} - ${s.title}`);
                await deleteSchedule(s.id);
            } catch (err) {
                console.error(`[SCHEDULE] ❌ Failed ${s.id}:`, err.message);
            }
        }
    }
}

// =============================================
// BOT READY
// =============================================
client.once('ready', async () => {
    console.log(`✅ Yagami-Bot logged in as ${client.user.tag}`);
    console.log(`✅ Serving ${client.guilds.cache.size} servers`);
    await registerCommands();
    client.user.setActivity('🪙 Coin Flip | /help', { type: 3 });

    setInterval(runSchedulePoller, 30000);
    console.log('✅ Schedule poller started!');
});

client.login(BOT_TOKEN);

// Keep-alive
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Yagami-Bot running ✅'); })
    .listen(PORT, () => console.log(`✅ Keep-alive on port ${PORT}`));

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err.message));
process.on('uncaughtException', err => console.error('Uncaught exception:', err.message));
client.on('error', err => console.error('Client error:', err.message));

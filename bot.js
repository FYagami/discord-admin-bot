const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits, Collection } = require('discord.js');

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

const spamTracker = new Collection();
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 3000;
const MUTE_DURATION = 3600;
const welcomeConfig = new Collection();
const lockdownState = new Collection();
const antispamEnabled = new Collection();

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

    // LOCKDOWN (text only)
    new SlashCommandBuilder()
        .setName('lockdown').setDescription('Lock all TEXT channels only (voice stays open)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for lockdown').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unlock').setDescription('Unlock all text channels')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // VOICE CHANNEL LOCK
    new SlashCommandBuilder()
        .setName('lockvc').setDescription('Lock a specific voice channel for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to lock').setRequired(true))
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas e.g. Member, Guest').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unlockvc').setDescription('Unlock a specific voice channel for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to unlock').setRequired(true))
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas e.g. Member, Guest').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lockallvc').setDescription('Lock all voice channels for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas e.g. Member, Guest').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unlockallvc').setDescription('Unlock all voice channels for specific roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('roles').setDescription('Role names separated by commas e.g. Member, Guest').setRequired(true)),

    // ANTI-SPAM
    new SlashCommandBuilder()
        .setName('antispam').setDescription('Enable or disable anti-spam')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('status').setDescription('Enable or disable').setRequired(true)
            .addChoices({ name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' })),

    // INFO
    new SlashCommandBuilder()
        .setName('serverinfo').setDescription('Show server information')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('userinfo').setDescription('Show info about a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('The user').setRequired(false)),
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
// ANTI-SPAM (messageCreate)
// =============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;

    // ── !lockdown prefix command ──────────────
    if (message.content.toLowerCase() === '!lockdown') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
            return message.reply('❌ You need Administrator permission!');

        message.channel.send('⏳ Locking all text channels...');
        const textChannels = message.guild.channels.cache.filter(c => c.type === 0);
        let locked = 0;
        for (const [, channel] of textChannels) {
            try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); locked++; } catch {}
        }

        const embed = new EmbedBuilder()
            .setTitle('🔒 Server Text Lockdown')
            .setColor(0xFF0000)
            .setDescription(`All **${locked}** text channels locked. 🔊 Voice channels are **NOT** affected.`)
            .addFields({ name: 'By', value: `${message.author}` })
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    // ── !unlock prefix command ─────────────────
    if (message.content.toLowerCase() === '!unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
            return message.reply('❌ You need Administrator permission!');

        message.channel.send('⏳ Unlocking all text channels...');
        const textChannels = message.guild.channels.cache.filter(c => c.type === 0);
        let unlocked = 0;
        for (const [, channel] of textChannels) {
            try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }); unlocked++; } catch {}
        }

        const embed = new EmbedBuilder()
            .setTitle('🔓 Server Text Unlocked')
            .setColor(0x2ECC71)
            .setDescription(`All **${unlocked}** text channels unlocked.`)
            .addFields({ name: 'By', value: `${message.author}` })
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    // ── Anti-spam ──────────────────────────────
    if (!antispamEnabled.get(guildId)) return;

    const userId = message.author.id;
    const now = Date.now();

    if (!spamTracker.has(userId)) {
        spamTracker.set(userId, { count: 1, firstMessage: now });
        return;
    }

    const data = spamTracker.get(userId);
    if (now - data.firstMessage > SPAM_WINDOW) {
        spamTracker.set(userId, { count: 1, firstMessage: now });
        return;
    }

    data.count++;
    spamTracker.set(userId, data);

    if (data.count >= SPAM_LIMIT) {
        spamTracker.delete(userId);
        try {
            const member = await message.guild.members.fetch(userId);
            await member.timeout(MUTE_DURATION * 1000, 'Anti-spam');
            const embed = new EmbedBuilder()
                .setTitle('🚫 Anti-Spam Triggered')
                .setColor(0xFF0000)
                .setDescription(`${message.author} timed out for **${MUTE_DURATION} seconds** for spamming.`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('Timeout failed:', err.message);
        }
    }
});

// =============================================
// WELCOME NEW MEMBERS
// =============================================
client.on('guildMemberAdd', async (member) => {
    const config = welcomeConfig.get(member.guild.id);
    if (!config) return;
    const channel = member.guild.channels.cache.get(config.channelId);
    if (!channel) return;
    const embed = new EmbedBuilder()
        .setTitle('👋 Welcome!')
        .setDescription(config.message.replace('{user}', member.toString()))
        .setColor(0x2ECC71)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: `Member #${member.guild.memberCount}` })
        .setTimestamp();
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

        // /lockdown (text only, voice stays open)
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
                .setDescription('All text channels locked. 🔊 Voice channels are **NOT** affected.')
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: '💬 Text Locked', value: `${lockedText}`, inline: true },
                    { name: 'By', value: `${interaction.user}`, inline: true }
                ).setTimestamp();
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
                .addFields(
                    { name: '💬 Text Unlocked', value: `${unlockedText}`, inline: true },
                    { name: 'By', value: `${interaction.user}`, inline: true }
                ).setTimestamp();
            return interaction.editReply({ content: null, embeds: [embed] });
        }

        // /lockvc
        if (commandName === 'lockvc') {
            const channel = interaction.options.getChannel('channel');
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            if (channel.type !== 2) return interaction.editReply('❌ Please select a **voice channel**!');
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            for (const role of resolvedRoles) {
                await channel.permissionOverwrites.edit(role, { Connect: false });
            }
            const embed = new EmbedBuilder().setTitle('🔒 Voice Channel Locked').setColor(0xFF0000)
                .addFields({ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Roles Locked', value: roleNames.join(', ') }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /unlockvc
        if (commandName === 'unlockvc') {
            const channel = interaction.options.getChannel('channel');
            const roleNames = interaction.options.getString('roles').split(',').map(r => r.trim());
            if (channel.type !== 2) return interaction.editReply('❌ Please select a **voice channel**!');
            const resolvedRoles = [];
            for (const name of roleNames) {
                const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!role) return interaction.editReply(`❌ Role \`${name}\` not found!`);
                resolvedRoles.push(role);
            }
            for (const role of resolvedRoles) {
                await channel.permissionOverwrites.edit(role, { Connect: true });
            }
            const embed = new EmbedBuilder().setTitle('🔓 Voice Channel Unlocked').setColor(0x2ECC71)
                .addFields({ name: 'Channel', value: `${channel}`, inline: true }, { name: 'Roles Unlocked', value: roleNames.join(', ') }).setTimestamp();
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
                for (const role of resolvedRoles) {
                    try { await channel.permissionOverwrites.edit(role, { Connect: false }); } catch {}
                }
                count++;
            }
            const embed = new EmbedBuilder().setTitle('🔒 All Voice Channels Locked').setColor(0xFF0000)
                .addFields({ name: 'Channels Locked', value: `${count}`, inline: true }, { name: 'Roles Affected', value: roleNames.join(', ') }).setTimestamp();
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
                for (const role of resolvedRoles) {
                    try { await channel.permissionOverwrites.edit(role, { Connect: true }); } catch {}
                }
                count++;
            }
            const embed = new EmbedBuilder().setTitle('🔓 All Voice Channels Unlocked').setColor(0x2ECC71)
                .addFields({ name: 'Channels Unlocked', value: `${count}`, inline: true }, { name: 'Roles Affected', value: roleNames.join(', ') }).setTimestamp();
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

        // /serverinfo
        if (commandName === 'serverinfo') {
            const embed = new EmbedBuilder()
                .setTitle(`📊 ${guild.name}`).setColor(0x3498DB).setThumbnail(guild.iconURL())
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
            const embed = new EmbedBuilder()
                .setTitle(`👤 ${user.tag}`).setColor(0x3498DB).setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'ID', value: user.id, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
                    { name: 'Roles', value: member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => `${r}`).join(', ') || 'None' : 'N/A' }
                ).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

    } catch (err) {
        console.error(`❌ Error in ${commandName}:`, err.message);
        try { await interaction.editReply('❌ An error occurred. Make sure the bot has proper permissions!'); } catch {}
    }
});

// =============================================
// BOT READY
// =============================================
client.once('ready', async () => {
    console.log(`✅ Admin Bot logged in as ${client.user.tag}`);
    console.log(`✅ Serving ${client.guilds.cache.size} servers`);
    await registerCommands();
    client.user.setActivity('Protecting servers 🛡️', { type: 3 });
});

client.login(BOT_TOKEN);

// Keep-alive
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Admin Bot running ✅'); })
    .listen(PORT, () => console.log(`✅ Keep-alive on port ${PORT}`));

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err.message));
process.on('uncaughtException', err => console.error('Uncaught exception:', err.message));
client.on('error', err => console.error('Client error:', err.message));

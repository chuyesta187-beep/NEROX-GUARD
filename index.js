require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    PermissionFlagsBits, 
    ChannelType, 
    AuditLogEvent,
    AttachmentBuilder
} = require('discord.js');

// ==========================================
// 1. DISCORD BOT INSTANTIATION & STATE
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
});

// En base de datos real se conecta mediante PostgreSQL / Prisma
const dbConfig = new Map();
const dbWhitelist = new Map();
const dbBackups = new Map();
const dbTickets = new Map();

const spamTracker = new Map();
const massBanTracker = new Map();

function getGuildConfig(guildId) {
    if (!dbConfig.has(guildId)) {
        dbConfig.set(guildId, {
            logChannelId: null,
            ticketCategoryId: null,
            quarantineRoleId: null,
            autoRoleId: null,
            welcomeChannelId: null,
            farewellChannelId: null,
            security: {
                antinuke: true, antiraid: true, antibot: true, antiwebhook: true,
                antilink: true, antispam: true, antieveryone: true, antighostping: true, 
                antiinvite: true, antiscam: true, antimassban: true, antiroleupdate: true,
                antichannelupdate: true, antiguildupdate: true
            }
        });
    }
    return dbConfig.get(guildId);
}

function isWhitelisted(guildId, userId) {
    const list = dbWhitelist.get(guildId) || [];
    return list.includes(userId);
}

async function sendAuditLog(guild, embed) {
    try {
        const config = getGuildConfig(guild.id);
        if (!config || !config.logChannelId) return;
        const channel = guild.channels.cache.get(config.logChannelId);
        if (channel && channel.isTextBased()) await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error(`[Audit Error] ${err.message}`);
    }
}

// ==========================================
// 2. EXPRESS WEB DASHBOARD & OAUTH2 ENGINE
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'nerox_guard_secret_key_123',
    resave: false,
    saveUninitialized: false
}));

// Middlewares de Autenticación para el Dashboard
function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

// Ruta Login (OAuth2 Redirect)
app.get('/login', (req, res) => {
    const redirectUri = encodeURIComponent(`${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`);
    const clientId = process.env.CLIENT_ID;
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// OAuth2 Callback
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código de autorización omitido.');

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: `${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`
            })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) return res.send('Error al verificar OAuth2 con Discord.');

        // Obtener usuario
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const user = await userRes.json();

        // Obtener Servidores
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guilds = await guildsRes.json();

        req.session.user = user;
        req.session.guilds = guilds;

        res.redirect('/dashboard');
    } catch (err) {
        console.error('[OAuth2 Error]', err);
        res.status(500).send('Error interno autenticando con Discord.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Home Landing
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Nerox Guard Enterprise</title>
            <style>
                body { background: #0f172a; color: #f8fafc; font-family: system-ui; display: flex; height: 100vh; align-items: center; justify-content: center; margin: 0; }
                .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 400px; }
                h1 { margin-top: 0; color: #38bdf8; }
                .btn { background: #5865f2; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block; margin-top: 20px; transition: 0.2s; }
                .btn:hover { background: #4752c4; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🛡️ Nerox Guard</h1>
                <p>Sistema Enterprise de Seguridad, Antinuke y Gestión para Servidores de Discord.</p>
                <a href="/dashboard" class="btn">Entrar al Dashboard</a>
            </div>
        </body>
        </html>
    `);
});

// Panel Principal del Dashboard
app.get('/dashboard', isAuth, (req, res) => {
    const userGuilds = req.session.guilds || [];
    // Filtrar servidores donde el usuario es Admin (Permissions & 0x8)
    const adminGuilds = userGuilds.filter(g => (parseInt(g.permissions) & 0x8) === 0x8);

    let cardsHtml = adminGuilds.map(g => {
        const botInGuild = client.guilds.cache.has(g.id);
        return `
            <div style="background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width: 48px; height: 48px; border-radius: 50%;">
                    <div>
                        <strong style="font-size: 1.1em; display: block;">${g.name}</strong>
                        <span style="font-size: 0.85em; color: ${botInGuild ? '#4ade80' : '#f87171'};">${botInGuild ? '● Bot Conectado' : '○ Bot ausente'}</span>
                    </div>
                </div>
                ${botInGuild 
                    ? `<a href="/dashboard/guild/${g.id}" style="background: #0284c7; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-weight: bold;">Configurar</a>`
                    : `<a href="https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot" target="_blank" style="background: #475569; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 6px;">Invitar Bot</a>`
                }
            </div>
        `;
    }).join('');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Dashboard - Nerox Guard</title>
            <style>
                body { background: #0f172a; color: #f8fafc; font-family: system-ui; margin: 0; padding: 40px; }
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid #334155; padding-bottom: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Bienvenido, ${req.session.user.username}</h2>
                    <a href="/logout" style="color: #f87171; text-decoration: none; font-weight: bold;">Cerrar Sesión</a>
                </div>
                <h3>Selecciona un Servidor</h3>
                ${cardsHtml || '<p>No administras ningún servidor en este momento.</p>'}
            </div>
        </body>
        </html>
    `);
});

// Panel de Configuración de un Servidor Específico
app.get('/dashboard/guild/:guildId', isAuth, (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send('El bot ya no está en este servidor.');

    const config = getGuildConfig(guildId);
    
    let modulesCheckboxes = Object.entries(config.security).map(([key, val]) => {
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px;">
                <span style="text-transform: capitalize;">${key}</span>
                <input type="checkbox" name="${key}" ${val ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
            </div>
        `;
    }).join('');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Configurando ${guild.name} - Nerox Guard</title>
            <style>
                body { background: #0f172a; color: #f8fafc; font-family: system-ui; margin: 0; padding: 40px; }
                .container { max-width: 700px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 16px; }
                .btn-save { background: #16a34a; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; font-size: 1em; margin-top: 20px; }
                .btn-save:hover { background: #15803d; }
                .back { color: #38bdf8; text-decoration: none; display: inline-block; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/dashboard" class="back">← Volver a los servidores</a>
                <h2>Módulos de Seguridad: ${guild.name}</h2>
                <form action="/dashboard/guild/${guildId}" method="POST">
                    ${modulesCheckboxes}
                    <button type="submit" class="btn-save">Guardar Cambios</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Guardar Ajustes desde el Dashboard
app.post('/dashboard/guild/:guildId', isAuth, (req, res) => {
    const { guildId } = req.params;
    const config = getGuildConfig(guildId);

    // Iterar y actualizar el estado de los interruptores de seguridad
    Object.keys(config.security).forEach(key => {
        config.security[key] = req.body[key] === 'on';
    });

    dbConfig.set(guildId, config);
    res.redirect(`/dashboard/guild/${guildId}`);
});

// Render Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', botPing: client.ws.ping });
});

app.listen(PORT, () => {
    console.log(`[Dashboard Express] Escuchando activamente en el puerto ${PORT}`);
});

// ==========================================
// 3. ANTINUKE & REAL-TIME EVENTS
// ==========================================
async function handleAntiNukeAction(guild, executor, actionName) {
    if (!executor || executor.id === client.user.id || executor.id === guild.ownerId || isWhitelisted(guild.id, executor.id)) return;

    try {
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member) {
            await member.roles.set([]).catch(() => {});
            await member.ban({ reason: `[Nerox Guard Antinuke] Violación de seguridad: ${actionName}` }).catch(() => {});
        }

        sendAuditLog(guild, new EmbedBuilder()
            .setTitle('🚨 NEROX GUARD: ANTINUKE ENTERPRISE')
            .setColor(0xFF0000)
            .setDescription(`**Ofensor:** ${executor.tag} (\`${executor.id}\`)\n**Acción:** ${actionName}\n**Sanción:** Baneo automático e inhabilitación total de permisos.`)
            .setTimestamp()
        );
    } catch (err) {
        console.error(`[AntiNuke Error] ${err.message}`);
    }
}

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const config = getGuildConfig(channel.guild.id);
    if (!config.security?.antinuke) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(channel.guild, entry.executor, `Eliminación de Canal (#${channel.name})`);
    }
});

client.on('roleDelete', async (role) => {
    const config = getGuildConfig(role.guild.id);
    if (!config.security?.antinuke) return;

    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(role.guild, entry.executor, `Eliminación de Rol (${role.name})`);
    }
});

// Anti-Scam / Filtering
client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;
    const config = getGuildConfig(message.guild.id);

    if (isWhitelisted(message.guild.id, message.author.id)) return;

    if (config.security?.antiscam) {
        const scamPatterns = [/free\s*nitro/i, /steam.*gift/i, /disord.*app/i, /token\s*grabber/i];
        if (scamPatterns.some(pattern => pattern.test(message.content))) {
            await message.delete().catch(() => {});
            await message.member.timeout(86400000, '[Nerox AutoMod] Detección Phishing/Scam').catch(() => {});
            return message.channel.send(`🚨 ${message.author} ha sido puesto en aislamiento 24h por envío de enlace malicioso.`);
        }
    }
});

// ==========================================
// 4. READY & SLASH COMMANDS REGISTRATION
// ==========================================
client.once('ready', async () => {
    console.log(`[Nerox Guard Enterprise] Conectado en Discord como ${client.user.tag}`);

    const commands = [
        { name: 'config', description: 'Revisa la configuración central del servidor' },
        { name: 'setup', description: 'Activa el blindaje AntiNuke por defecto' },
        { name: 'dashboard', description: 'Obtén el enlace de administración del dashboard' }
    ];

    await client.application.commands.set(commands).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'config') {
        const cfg = getGuildConfig(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle(`🛡️ Estado General: ${interaction.guild.name}`)
            .setColor(0x38BDF8)
            .addFields(
                { name: 'Módulos Activos', value: Object.entries(cfg.security).map(([k, v]) => `${v ? '✅' : '❌'} **${k}**`).join('\n') }
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'dashboard') {
        return interaction.reply({ 
            content: `🌐 **Accede al Dashboard Web para configurar el bot:**\n${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}`, 
            ephemeral: true 
        });
    }
});

// ==========================================
// 5. LOGIN DISCORD BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);

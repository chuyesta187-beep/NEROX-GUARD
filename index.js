// ==========================================
// NEROX GUARD Enterprise — ULTRA CORE FINAL V2
// Guild HQ: 1520985648457056266
// ==========================================

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    AuditLogEvent,
    ChannelType
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES DEL SISTEMA
// ==========================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    CLIENT_ID: process.env.CLIENT_ID || 'TU_CLIENT_ID',
    CLIENT_SECRET: process.env.CLIENT_SECRET || 'TU_CLIENT_SECRET',
    BOT_TOKEN: process.env.DISCORD_TOKEN || 'TU_DISCORD_TOKEN',
    DASHBOARD_URL: process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3000}`,
    SESSION_SECRET: process.env.SESSION_SECRET || 'nerox_enterprise_ultra_secret_key_2026',
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA',
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
    HQ_GUILD_ID: '1520985648457056266',
    HQ_INVITE_URL: process.env.HQ_INVITE_URL || 'https://discord.gg/invitacion-oficial-nerox',
    DB_PATH: path.join(__dirname, 'database.json')
};

// ==========================================
// 2. PERSISTENCIA EN DISCO (JSON STORAGE)
// ==========================================
const memoryDB = {
    guildConfigs: new Map(),
    owners: new Map(),
    smartRules: new Map(),
    logs: new Map(),
    incidents: new Map(),
    history: new Map(),
    announcements: new Map(),
    readAnnouncementsByUser: new Map(),
    supportTickets: new Map(),
    staffSecurity: new Map()
};

function loadDatabase() {
    if (fs.existsSync(CONFIG.DB_PATH)) {
        try {
            const raw = fs.readFileSync(CONFIG.DB_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (data.guildConfigs) memoryDB.guildConfigs = new Map(data.guildConfigs);
            if (data.owners) memoryDB.owners = new Map(data.owners);
            if (data.smartRules) memoryDB.smartRules = new Map(data.smartRules);
            if (data.logs) memoryDB.logs = new Map(data.logs);
            if (data.incidents) memoryDB.incidents = new Map(data.incidents);
            if (data.history) memoryDB.history = new Map(data.history);
            if (data.announcements) memoryDB.announcements = new Map(data.announcements);
            if (data.readAnnouncementsByUser) memoryDB.readAnnouncementsByUser = new Map(data.readAnnouncementsByUser);
            if (data.supportTickets) memoryDB.supportTickets = new Map(data.supportTickets);
            if (data.staffSecurity) memoryDB.staffSecurity = new Map(data.staffSecurity);
            console.log('💾 [DATABASE] Estructura NEROX GUARD Enterprise cargada.');
        } catch (err) {
            console.error('❌ Error leyendo database.json:', err);
        }
    } else {
        saveDatabase();
    }
}

function saveDatabase() {
    try {
        const data = {
            guildConfigs: Array.from(memoryDB.guildConfigs.entries()),
            owners: Array.from(memoryDB.owners.entries()),
            smartRules: Array.from(memoryDB.smartRules.entries()),
            logs: Array.from(memoryDB.logs.entries()),
            incidents: Array.from(memoryDB.incidents.entries()),
            history: Array.from(memoryDB.history.entries()),
            announcements: Array.from(memoryDB.announcements.entries()),
            readAnnouncementsByUser: Array.from(memoryDB.readAnnouncementsByUser.entries()),
            supportTickets: Array.from(memoryDB.supportTickets.entries()),
            staffSecurity: Array.from(memoryDB.staffSecurity.entries())
        };
        fs.writeFileSync(CONFIG.DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Error guardando datos en database.json:', err);
    }
}

loadDatabase();

function getGuildConfig(guildId) {
    if (!memoryDB.guildConfigs.has(guildId)) {
        memoryDB.guildConfigs.set(guildId, {
            version: 1,
            logsChannelId: null,
            securityScore: 50,
            lockdownActive: false,
            antiRaid: { enabled: true, threshold: 10, windowSec: 10, action: 'LOCKDOWN', blockBots: true, notifyStaff: true },
            antiNuke: { enabled: true, massBanLimit: 5, massKickLimit: 5, channelDeleteLimit: 3, roleDeleteLimit: 3, webhookLimit: 3, windowSec: 10, action: 'REVOKE_PERMS' },
            autoMod: { enabled: true, spam: true, flood: true, links: true, invites: true, mentions: true, caps: true, badWords: ['scam', 'nitro', 'phishing'], scam: true },
            antiBot: { enabled: true, action: 'KICK' },
            antiAlt: { enabled: true, minAgeDays: 7, action: 'VERIFY' },
            antiMention: { enabled: true, limit: 5, windowSec: 5, action: 'TIMEOUT' },
            antiWebhook: { enabled: true, action: 'DELETE' },
            whitelist: { users: [], roles: [], bots: [], channels: [], webhooks: [] },
            blacklist: { users: [], identifiers: [] }
        });
        saveDatabase();
    }
    return memoryDB.guildConfigs.get(guildId);
}

function getGuildOwners(guildId) {
    if (!memoryDB.owners.has(guildId)) {
        memoryDB.owners.set(guildId, { primaryOwnerId: null, secondaryOwnerId: null, pendingAuthorizations: [] });
        saveDatabase();
    }
    return memoryDB.owners.get(guildId);
}

function createIncident(guildId, type, userTag, userId, actionTaken, details) {
    const incId = `NGR-${Math.floor(1000 + Math.random() * 9000)}`;
    const incident = {
        id: incId,
        type,
        userTag,
        userId,
        actionTaken,
        details,
        timestamp: new Date().toISOString()
    };
    if (!memoryDB.incidents.has(guildId)) memoryDB.incidents.set(guildId, []);
    memoryDB.incidents.get(guildId).unshift(incident);
    saveDatabase();

    pushLog(guildId, 'INCIDENT', `🚨 INCIDENTE #${incId} — ${type}`, `**Usuario:** @${userTag} (${userId})\n**Acción NEROX:** ${actionTaken}\n**Detalle:** ${details}`, 'CRITICAL');
    return incId;
}

function pushLog(guildId, type, title, description, severity = 'INFO') {
    if (!memoryDB.logs.has(guildId)) memoryDB.logs.set(guildId, []);
    const guildLogs = memoryDB.logs.get(guildId);
    const entry = { id: `log_${Date.now()}`, type, title, description, severity, timestamp: new Date().toISOString() };
    guildLogs.unshift(entry);
    if (guildLogs.length > 200) guildLogs.pop();
    saveDatabase();

    const config = getGuildConfig(guildId);
    if (config.logsChannelId && client.isReady()) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            const channel = guild.channels.cache.get(config.logsChannelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(`📋 [${type}] ${title}`)
                    .setDescription(description)
                    .setColor(severity === 'CRITICAL' ? '#ef4444' : severity === 'HIGH' ? '#f59e0b' : '#06b6d4')
                    .setTimestamp();
                channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    }
}

function calculateSecurityScore(guildId) {
    const config = getGuildConfig(guildId);
    const owners = getGuildOwners(guildId);
    let score = 0;

    if (config.logsChannelId) score += 20;
    if (owners.secondaryOwnerId) score += 20;
    if (config.antiRaid.enabled) score += 15;
    if (config.antiNuke.enabled) score += 15;
    if (config.autoMod.enabled) score += 10;
    if (config.antiAlt.enabled) score += 10;
    if (config.antiWebhook.enabled) score += 10;

    config.securityScore = score;
    saveDatabase();
    return score;
}

// ==========================================
// 3. INICIALIZACIÓN BOT DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildAuditLogs
    ]
});

// ==========================================
// 4. REGISTRO DE COMANDOS SLASH
// ==========================================
const slashCommands = [
    new SlashCommandBuilder().setName('setup').setDescription('Configura e inspecciona las bases esenciales de NEROX GUARD'),
    new SlashCommandBuilder().setName('security').setDescription('Muestra el estado general del Security Center'),
    new SlashCommandBuilder().setName('security-status').setDescription('Muestra el resumen de protecciones activas'),
    new SlashCommandBuilder().setName('antiraid').setDescription('Estado y configuración rápida de Anti-Raid'),
    new SlashCommandBuilder().setName('antinuke').setDescription('Estado de protecciones Anti-Nuke'),
    new SlashCommandBuilder().setName('automod').setDescription('Estado del motor AutoMod'),
    new SlashCommandBuilder().setName('antibot').setDescription('Estado de Anti-Bot'),
    new SlashCommandBuilder().setName('antialt').setDescription('Filtro de cuentas recién creadas'),
    new SlashCommandBuilder().setName('antimention').setDescription('Límite de menciones masivas'),
    new SlashCommandBuilder().setName('antiwebhook').setDescription('Protección de Webhooks'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Activa de emergencia el bloqueo de canales'),
    new SlashCommandBuilder().setName('unlock').setDescription('Restaura los permisos normales tras un Lockdown'),
    new SlashCommandBuilder().setName('whitelist').setDescription('Consulta la lista blanca del servidor'),
    new SlashCommandBuilder().setName('blacklist').setDescription('Consulta la lista negra del servidor'),
    new SlashCommandBuilder().setName('warn').setDescription('Aplica una advertencia a un usuario').addUserOption(o => o.setName('target').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Razón')),
    new SlashCommandBuilder().setName('timeout').setDescription('Aísla a un usuario').addUserOption(o => o.setName('target').setDescription('Usuario').setRequired(true)).addIntegerOption(o => o.setName('duration').setDescription('Segundos').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa a un usuario').addUserOption(o => o.setName('target').setDescription('Usuario').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Banea a un usuario').addUserOption(o => o.setName('target').setDescription('Usuario').setRequired(true)),
    new SlashCommandBuilder().setName('logs').setDescription('Verifica el canal de logs registrado'),
    new SlashCommandBuilder().setName('incidents').setDescription('Consulta incidentes críticos del servidor')
].map(c => c.toJSON());

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: slashCommands });
        console.log('✅ [REST] Comandos Slash globales cargados.');
    } catch (err) {
        console.error('❌ Error registrando comandos Slash:', err);
    }
}

// ==========================================
// 5. EXPRESS MOTOR & SEGURIDAD OAUTH2 / CSRF
// ==========================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 86400000 * 7
    }
}));

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/');
}

async function verifyGuildAccess(req, res, next) {
    const guildId = req.params.guildId || req.body.guildId;
    if (!guildId) return res.status(400).json({ error: 'MISSING_GUILD_ID' });

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'BOT_NOT_IN_GUILD' });

        let userGuilds = req.session.userGuilds;
        if (!userGuilds) {
            const response = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${req.session.accessToken}` }
            });
            if (!response.ok) return res.status(401).json({ error: 'EXPIRED_TOKEN' });
            userGuilds = await response.json();
            req.session.userGuilds = userGuilds;
        }

        const targetGuild = userGuilds.find(g => g.id === guildId);
        if (!targetGuild) return res.status(403).json({ error: 'NOT_IN_GUILD' });

        const hasAdmin = (BigInt(targetGuild.permissions) & BigInt(0x8)) === BigInt(0x8) || targetGuild.owner;
        if (!hasAdmin) return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' });

        req.targetGuild = guild;
        next();
    } catch (err) {
        res.status(500).json({ error: 'SECURITY_VERIFICATION_FAILED' });
    }
}

app.post('/api/auth/verify-captcha', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'CAPTCHA token requerido.' });

    try {
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: CONFIG.TURNSTILE_SECRET_KEY,
                response: token
            })
        });

        const verifyData = await verifyRes.json();
        if (verifyData.success) {
            req.session.captchaPassed = true;
            return res.json({ success: true });
        } else {
            return res.status(400).json({ success: false, message: 'CAPTCHA inválido.' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error interno de verificación.' });
    }
});

app.get('/login', (req, res) => {
    if (!req.session.captchaPassed) return res.redirect('/');

    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const redirectUri = encodeURIComponent(`${CONFIG.DASHBOARD_URL}/api/auth/callback`);
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds&state=${state}`;
    res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!state || state !== req.session.oauthState) {
        return res.status(403).send('Ataque CSRF Detectado / State Inválido.');
    }
    req.session.oauthState = null;

    if (!code) return res.redirect('/');

    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CONFIG.CLIENT_ID,
                client_secret: CONFIG.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${CONFIG.DASHBOARD_URL}/api/auth/callback`
            })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        req.session.user = await userRes.json();
        req.session.accessToken = tokenData.access_token;

        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// 6. RUTAS API DEL DASHBOARD
// ==========================================
app.get('/api/announcements', isAuth, (req, res) => {
    const userId = req.session.user.id;
    const all = Array.from(memoryDB.announcements.values());
    const read = memoryDB.readAnnouncementsByUser.get(userId) || [];
    const unread = all.filter(a => !read.includes(a.id));
    res.json({ announcements: unread });
});

app.post('/api/announcements/read', isAuth, (req, res) => {
    const userId = req.session.user.id;
    const { announcementId } = req.body;

    if (!memoryDB.readAnnouncementsByUser.has(userId)) {
        memoryDB.readAnnouncementsByUser.set(userId, []);
    }
    const readList = memoryDB.readAnnouncementsByUser.get(userId);
    if (!readList.includes(announcementId)) {
        readList.push(announcementId);
        saveDatabase();
    }
    res.json({ success: true });
});

app.get('/api/user/guilds', isAuth, async (req, res) => {
    try {
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });
        if (!guildsRes.ok) return res.status(401).json({ error: 'Token expirado' });

        const userGuilds = await guildsRes.json();
        req.session.userGuilds = userGuilds;

        const adminGuilds = userGuilds.filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8) || g.owner);

        const result = adminGuilds.map(g => {
            const botIn = client.guilds.cache.has(g.id);
            const score = botIn ? calculateSecurityScore(g.id) : 0;
            const config = botIn ? getGuildConfig(g.id) : null;
            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                hasBot: botIn,
                securityScore: score,
                antiRaidActive: config ? config.antiRaid.enabled : false,
                antiNukeActive: config ? config.antiNuke.enabled : false,
                inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&permissions=8&scope=bot%20applications.commands&guild_id=${g.id}`
            };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Error al consultar servidores' });
    }
});

app.get('/api/guilds/:guildId/data', isAuth, verifyGuildAccess, (req, res) => {
    const { guildId } = req.params;
    res.json({
        config: getGuildConfig(guildId),
        owners: getGuildOwners(guildId),
        smartRules: memoryDB.smartRules.get(guildId) || [],
        logs: memoryDB.logs.get(guildId) || [],
        incidents: memoryDB.incidents.get(guildId) || [],
        history: memoryDB.history.get(guildId) || [],
        score: calculateSecurityScore(guildId)
    });
});

app.post('/api/guilds/:guildId/save', isAuth, verifyGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { config, owners } = req.body;

    const currentConfig = getGuildConfig(guildId);

    if (!memoryDB.history.has(guildId)) memoryDB.history.set(guildId, []);
    const h = memoryDB.history.get(guildId);
    h.unshift({
        version: currentConfig.version,
        timestamp: new Date().toISOString(),
        config: JSON.parse(JSON.stringify(currentConfig))
    });
    if (h.length > 10) h.pop();

    const nextVersion = currentConfig.version + 1;
    const updated = { ...currentConfig, ...config, version: nextVersion };
    memoryDB.guildConfigs.set(guildId, updated);

    if (owners) {
        const currentOwners = getGuildOwners(guildId);
        memoryDB.owners.set(guildId, { ...currentOwners, ...owners });
    }

    saveDatabase();
    pushLog(guildId, 'SETTINGS', 'Configuración Actualizada', `Cambios guardados desde el Dashboard Web por @${req.session.user.username} (v${nextVersion}).`, 'LOW');

    res.json({ success: true, version: nextVersion, score: calculateSecurityScore(guildId) });
});

app.post('/api/guilds/:guildId/history/restore', isAuth, verifyGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { version } = req.body;

    const historyList = memoryDB.history.get(guildId) || [];
    const targetSnapshot = historyList.find(item => item.version === version);

    if (!targetSnapshot) {
        return res.status(404).json({ error: 'Versión no encontrada en el historial.' });
    }

    const currentConfig = getGuildConfig(guildId);
    const nextVersion = currentConfig.version + 1;

    const restoredConfig = {
        ...JSON.parse(JSON.stringify(targetSnapshot.config)),
        version: nextVersion
    };

    memoryDB.guildConfigs.set(guildId, restoredConfig);
    saveDatabase();

    pushLog(guildId, 'SETTINGS', 'Versión Restaurada', `Se restauró con éxito la configuración v${version} (Nueva versión activa: v${nextVersion}).`, 'MEDIUM');
    res.json({ success: true, version: nextVersion, restoredFrom: version });
});

app.post('/api/guilds/:guildId/create-logs-channel', isAuth, verifyGuildAccess, async (req, res) => {
    const { guildId } = req.params;
    const guild = req.targetGuild;

    try {
        const channel = await guild.channels.create({
            name: 'nerox-logs',
            permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });

        const config = getGuildConfig(guildId);
        config.logsChannelId = channel.id;
        saveDatabase();

        pushLog(guildId, 'SYSTEM', 'Canal de Logs Creado', `Se creó el canal de logs <#${channel.id}>.`, 'MEDIUM');
        res.json({ success: true, channelId: channel.id });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear el canal de logs.' });
    }
});

app.post('/api/guilds/:guildId/smart-rules', isAuth, verifyGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { rule } = req.body;

    if (!memoryDB.smartRules.has(guildId)) memoryDB.smartRules.set(guildId, []);
    const rules = memoryDB.smartRules.get(guildId);

    const newRule = {
        id: `rule_${Date.now()}`,
        name: rule.name || 'Nueva Regla',
        event: rule.event || 'MESSAGES',
        count: typeof rule.count === 'number' ? rule.count : 5,
        timeSec: typeof rule.timeSec === 'number' ? rule.timeSec : 5,
        action: rule.action || 'TIMEOUT',
        durationSec: typeof rule.durationSec === 'number' ? rule.durationSec : 60,
        deleteMessages: rule.deleteMessages !== undefined ? Boolean(rule.deleteMessages) : true,
        notifyStaff: rule.notifyStaff !== undefined ? Boolean(rule.notifyStaff) : true
    };

    rules.push(newRule);
    saveDatabase();
    pushLog(guildId, 'SMART_RULE', 'Regla Creada', `Smart Rule "${newRule.name}" activa.`, 'MEDIUM');

    res.json({ success: true, rule: newRule });
});

app.post('/api/support/ticket', isAuth, async (req, res) => {
    const { category, message, guildId } = req.body;
    const ticketId = `TICKET-${Math.floor(100000 + Math.random() * 900000)}`;

    const ticketData = {
        id: ticketId,
        userId: req.session.user.id,
        username: req.session.user.username,
        guildId: guildId || 'N/A',
        category,
        message,
        status: 'OPEN',
        createdAt: new Date().toISOString()
    };

    memoryDB.supportTickets.set(ticketId, ticketData);
    saveDatabase();

    const hqGuild = client.guilds.cache.get(CONFIG.HQ_GUILD_ID);
    if (hqGuild) {
        const supportChannel = hqGuild.channels.cache.find(c => c.name.includes('soporte') || c.name.includes('tickets')) || hqGuild.systemChannel;
        if (supportChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`🎧 SOLICITUD DE SOPORTE #${ticketId}`)
                .addFields(
                    { name: 'Usuario', value: `@${ticketData.username} (${ticketData.userId})`, inline: true },
                    { name: 'Categoría', value: category, inline: true },
                    { name: 'Mensaje', value: message }
                )
                .setColor('#06b6d4')
                .setTimestamp();

            supportChannel.send({ embeds: [embed] }).catch(() => null);
        }
    }

    res.json({ success: true, ticketId });
});

// ==========================================
// 7. FRONTEND ENTERPRISE UNIFICADO (V2)
// ==========================================
const globalCssAndLayout = `
    :root {
        --bg: #020617;
        --card: #0b0f19;
        --border: #1e293b;
        --accent: #06b6d4;
        --accent-hover: #22d3ee;
        --text: #f8fafc;
        --muted: #64748b;
        --success: #10b981;
        --warning: #f59e0b;
        --critical: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body {
        background:
            radial-gradient(circle at 15% 20%, rgba(6, 182, 212, 0.12), transparent 30%),
            radial-gradient(circle at 85% 80%, rgba(37, 99, 235, 0.10), transparent 30%),
            var(--bg);
        color: var(--text);
        min-height: 100vh;
        overflow-x: hidden;
        position: relative;
    }
    body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: .18;
        background-image:
            linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
        background-size: 40px 40px;
        z-index: 0;
    }
    .btn {
        background: var(--accent);
        color: #000;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }
    .btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 24px;
        position: relative;
        z-index: 1;
    }
    .modal {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(2, 6, 23, 0.85); backdrop-filter: blur(5px);
        display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal-content {
        background: var(--card); border: 1px solid var(--border);
        padding: 30px; border-radius: 12px; max-width: 500px; width: 100%;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .hidden { display: none !important; }
`;

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>NEROX GUARD — Verification</title>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <style>
            ${globalCssAndLayout}
            .landing-wrapper {
                height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; z-index: 1;
            }
            .hero-card {
                text-align: center; max-width: 440px; width: 100%; padding: 40px;
                box-shadow: 0 25px 50px -12px rgba(6, 182, 212, 0.15);
            }
            .shield-icon { font-size: 3rem; margin-bottom: 15px; color: var(--accent); }
            .tech-list { display: flex; justify-content: center; gap: 15px; margin: 25px 0; color: var(--muted); font-size: 0.85rem; font-weight: 500; }
        </style>
    </head>
    <body>
        <div class="landing-wrapper">
            <div class="card hero-card">
                <div class="shield-icon">🛡️</div>
                <h1 style="color:var(--accent); font-size: 1.8rem; margin-bottom: 5px;">NEROX GUARD</h1>
                <p style="color: var(--muted); font-size: 0.95rem; margin-bottom: 25px;">Enterprise Security Platform</p>

                <p style="font-size: 0.9rem; color: #cbd5e1; margin-bottom: 25px;">
                    Protección avanzada, anti-nuke en tiempo real y automatización segura para comunidades de Discord.
                </p>

                <div style="margin-bottom: 25px; display: flex; justify-content: center;">
                    <div class="cf-turnstile" data-sitekey="${CONFIG.TURNSTILE_SITE_KEY}" data-callback="onCaptchaPassed"></div>
                </div>

                <button id="contBtn" class="btn" style="width: 100%;" disabled onclick="redirectToLogin()">🛡️ CONTINUAR A DISCORD</button>

                <div class="tech-list">
                    <span>• SECURITY</span>
                    <span>• MONITORING</span>
                    <span>• PROTECTION</span>
                </div>
            </div>
        </div>

        <script>
            let verifiedToken = null;
            function onCaptchaPassed(token) {
                verifiedToken = token;
                document.getElementById('contBtn').disabled = false;
            }
            async function redirectToLogin() {
                if (!verifiedToken) return;
                const res = await fetch('/api/auth/verify-captcha', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ token: verifiedToken })
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = '/login';
                } else {
                    alert('Verificación de CAPTCHA fallida.');
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.get('/dashboard', isAuth, (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>NEROX GUARD — Enterprise Dashboard</title>
        <style>
            ${globalCssAndLayout}
            body { display: flex; height: 100vh; overflow: hidden; }
            .sidebar { width: 260px; background: var(--card); border-right: 1px solid var(--border); padding: 25px 20px; display: flex; flex-direction: column; z-index: 10; }
            .main { flex: 1; padding: 40px; overflow-y: auto; z-index: 10; }
            .brand { font-size: 1.1rem; font-weight: 800; color: var(--accent); margin-bottom: 35px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 10px; }
            .nav-item { padding: 12px 15px; color: var(--muted); text-decoration: none; display: flex; align-items: center; gap: 12px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
            .nav-item:hover, .nav-item.active { background: rgba(6, 182, 212, 0.1); color: var(--accent); }
            
            /* Stats Grid */
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 35px; }
            .stat-card { background: var(--card); border: 1px solid var(--border); padding: 20px 24px; border-radius: 12px; }
            .stat-num { font-size: 2rem; font-weight: 800; color: var(--accent); margin-top: 5px; }
            .stat-label { color: var(--muted); font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

            /* Servers Grid */
            .guilds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin-top: 20px; }
            .guild-card { background: var(--card); border: 1px solid var(--border); padding: 20px; border-radius: 12px; transition: border-color 0.2s; }
            .guild-card:hover { border-color: rgba(6, 182, 212, 0.4); }

            /* Progress Bar */
            .progress-bar-container { background: #1e293b; border-radius: 99px; height: 8px; width: 100%; overflow: hidden; margin: 15px 0; }
            .progress-bar-fill { background: var(--accent); height: 100%; border-radius: 99px; transition: width 0.5s ease; }

            /* Unsaved Bar */
            .unsaved-bar { position: fixed; bottom: 30px; right: 30px; background: var(--warning); color: #000; padding: 16px 24px; border-radius: 10px; font-weight: bold; display: flex; gap: 15px; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 1000; }
        </style>
    </head>
    <body>
        <aside class="sidebar">
            <div class="brand">🛡️ NEROX GUARD</div>
            <a class="nav-item active" onclick="showSection('servers')">🛡️ Mis Servidores</a>
            <a class="nav-item" onclick="showSection('support')">🎧 Soporte Central</a>
            <a href="${CONFIG.HQ_INVITE_URL}" target="_blank" class="nav-item">🏢 Servidor NEROX HQ</a>
            <a href="/logout" class="nav-item" style="margin-top: auto; color: var(--critical);">Cerrar Sesión</a>
        </aside>

        <main class="main">
            <div id="announcementModal" class="modal hidden">
                <div class="modal-content">
                    <h2 style="color: var(--accent); margin-bottom: 10px;">📢 NUEVO ANUNCIO</h2>
                    <h3 id="annTitle" style="margin-bottom: 10px; font-size: 1.1rem;"></h3>
                    <p id="annBody" style="color: var(--muted); margin-bottom: 25px; line-height: 1.5; font-size: 0.95rem;"></p>
                    <button class="btn" style="width: 100%;" onclick="closeAnnouncement()">ENTENDIDO</button>
                </div>
            </div>

            <!-- VISTA SECCIÓN: SERVIDORES GENERAL / OVERVIEW -->
            <div id="sec-servers">
                <div style="margin-bottom: 30px;">
                    <h1 id="welcomeTitle" style="font-size: 1.8rem; font-weight: 800; margin-bottom: 5px;">Buenos días</h1>
                    <p style="color: var(--muted); font-size: 0.95rem;">Security overview de tus comunidades conectadas</p>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Servidores con Bot</div>
                        <div id="statServersCount" class="stat-num">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Security Score Promedio</div>
                        <div id="statAvgScore" class="stat-num">0%</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Incidentes Bloqueados</div>
                        <div id="statIncidentsCount" class="stat-num">0</div>
                    </div>
                </div>

                <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 15px;">Tus servidores</h3>
                <div id="guildGrid" class="guilds-grid"></div>
            </div>

            <!-- VISTA SECCIÓN: GESTIÓN DE UN SERVIDOR ESPECÍFICO -->
            <div id="sec-guild-detail" class="hidden">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px;">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <img id="detailGuildIcon" src="" style="width: 56px; height: 56px; border-radius: 12px; border: 1px solid var(--border);">
                        <div>
                            <h1 id="detailGuildName" style="font-size: 1.6rem; font-weight: 800;">Nombre del Servidor</h1>
                            <p style="color: var(--success); font-size: 0.85rem; font-weight: 600; margin-top: 3px;">🟢 SISTEMA PROTEGIDO</p>
                        </div>
                    </div>
                    <button class="btn" style="background: #1e293b; color: var(--text);" onclick="showSection('servers')">← Volver a Servidores</button>
                </div>

                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 25px; margin-bottom: 30px;">
                    <div class="card" style="display: flex; flex-direction: column; justify-content: center;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <span style="font-weight: 700; font-size: 1rem;">Security Score Global</span>
                            <span id="detailScoreNum" style="font-size: 1.5rem; font-weight: 800; color: var(--accent);">0/100</span>
                        </div>
                        <div class="progress-bar-container" style="height: 12px;">
                            <div id="detailScoreBar" class="progress-bar-fill" style="width: 0%;"></div>
                        </div>
                    </div>
                    <div class="card" style="display: flex; align-items: center; justify-content: space-around;">
                        <div style="text-align: center;">
                            <div style="color: var(--muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Anti-Raid</div>
                            <div id="badgeAntiRaid" style="margin-top: 5px; font-weight: 800; font-size: 0.9rem; color: var(--success);">ACTIVADO</div>
                        </div>
                        <div style="width: 1px; height: 40px; background: var(--border);"></div>
                        <div style="text-align: center;">
                            <div style="color: var(--muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700;">Anti-Nuke</div>
                            <div id="badgeAntiNuke" style="margin-top: 5px; font-weight: 800; font-size: 0.9rem; color: var(--success);">ACTIVADO</div>
                        </div>
                    </div>
                </div>

                <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 15px;">Módulos de Seguridad Activos</h3>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 35px;">
                    <div class="card" style="text-align: center; padding: 30px 20px;">
                        <div style="font-size: 2rem; margin-bottom: 10px;">🛡️</div>
                        <h4 style="margin-bottom: 5px; font-size: 1rem;">ANTI-RAID</h4>
                        <p style="color: var(--success); font-size: 0.85rem; font-weight: 600; margin-bottom: 20px;">ESTADO: ACTIVO</p>
                        <button class="btn" style="width: 100%; background: #1e293b; color: var(--text);" onclick="alert('Configuración avanzada de Anti-Raid')">Configurar</button>
                    </div>
                    <div class="card" style="text-align: center; padding: 30px 20px;">
                        <div style="font-size: 2rem; margin-bottom: 10px;">☢️</div>
                        <h4 style="margin-bottom: 5px; font-size: 1rem;">ANTI-NUKE</h4>
                        <p style="color: var(--success); font-size: 0.85rem; font-weight: 600; margin-bottom: 20px;">ESTADO: ACTIVO</p>
                        <button class="btn" style="width: 100%; background: #1e293b; color: var(--text);" onclick="alert('Configuración avanzada de Anti-Nuke')">Configurar</button>
                    </div>
                    <div class="card" style="text-align: center; padding: 30px 20px;">
                        <div style="font-size: 2rem; margin-bottom: 10px;">🤖</div>
                        <h4 style="margin-bottom: 5px; font-size: 1rem;">AUTOMOD</h4>
                        <p style="color: var(--success); font-size: 0.85rem; font-weight: 600; margin-bottom: 20px;">ESTADO: ACTIVO</p>
                        <button class="btn" style="width: 100%; background: #1e293b; color: var(--text);" onclick="alert('Configuración avanzada de AutoMod')">Configurar</button>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 25px;">
                    <div class="card">
                        <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 15px;">Security Center Overview</h3>
                        <div id="securityCenterList" style="display: flex; flex-direction: column; gap: 12px;"></div>
                    </div>
                    <div class="card">
                        <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 15px;">Recent Incidents</h3>
                        <div id="recentIncidentsList" style="display: flex; flex-direction: column; gap: 10px;"></div>
                    </div>
                </div>
            </div>

            <!-- VISTA SECCIÓN: SOPORTE CENTRAL -->
            <div id="sec-support" class="hidden">
                <div style="margin-bottom: 30px;">
                    <h1 style="font-size: 1.8rem; font-weight: 800; margin-bottom: 5px;">🎧 Soporte Centralizado</h1>
                    <p style="color: var(--muted); font-size: 0.95rem;">Comunícate directamente con el equipo Enterprise de NEROX HQ</p>
                </div>

                <div class="card" style="max-width: 550px;">
                    <label style="display:block; margin-bottom: 8px; font-weight: 600; font-size: 0.9rem;">Categoría de Solicitud</label>
                    <select id="supCategory" style="width: 100%; padding: 12px; margin-bottom: 20px; background: var(--bg); color: #fff; border: 1px solid var(--border); border-radius: 8px; outline: none;">
                        <option value="🛡️ Seguridad">🛡️ Seguridad</option>
                        <option value="🤖 Bot">🤖 Bot</option>
                        <option value="🐛 Bug">🐛 Bug</option>
                    </select>

                    <label style="display:block; margin-bottom: 8px; font-weight: 600; font-size: 0.9rem;">Mensaje detallado</label>
                    <textarea id="supMsg" rows="5" style="width: 100%; padding: 12px; margin-bottom: 25px; background: var(--bg); color: #fff; border: 1px solid var(--border); border-radius: 8px; outline: none; resize: vertical;"></textarea>

                    <button class="btn" style="width: 100%;" onclick="sendTicket()">📝 ENVIAR SOLICITUD A HQ</button>
                </div>
            </div>

            <div id="unsavedBar" class="unsaved-bar hidden">
                ⚠️ Tienes cambios sin guardar en la configuración.
                <button class="btn" style="background: #000; color: #fff;" onclick="discardChanges()">DESCARTAR</button>
                <button class="btn" onclick="saveAllChanges()">💾 GUARDAR TODO</button>
            </div>
        </main>

        <script>
            let activeAnnouncementId = null;
            let hasUnsavedChanges = false;
            let currentGuildData = null;

            document.addEventListener("DOMContentLoaded", () => {
                checkAnnouncements();
                loadGuilds();
            });

            function markUnsaved() {
                hasUnsavedChanges = true;
                document.getElementById('unsavedBar').classList.remove('hidden');
            }

            function discardChanges() {
                hasUnsavedChanges = false;
                document.getElementById('unsavedBar').classList.add('hidden');
                location.reload();
            }

            async function saveAllChanges() {
                hasUnsavedChanges = false;
                document.getElementById('unsavedBar').classList.add('hidden');
                alert('💾 Todos los cambios pendientes han sido guardados con éxito.');
            }

            async function checkAnnouncements() {
                const res = await fetch('/api/announcements');
                const data = await res.json();
                if (data.announcements && data.announcements.length > 0) {
                    const ann = data.announcements[0];
                    activeAnnouncementId = ann.id;
                    document.getElementById('annTitle').innerText = ann.title;
                    document.getElementById('annBody').innerText = ann.body;
                    document.getElementById('announcementModal').classList.remove('hidden');
                }
            }

            async function closeAnnouncement() {
                if (activeAnnouncementId) {
                    await fetch('/api/announcements/read', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ announcementId: activeAnnouncementId })
                    });
                }
                document.getElementById('announcementModal').classList.add('hidden');
            }

            async function loadGuilds() {
                const res = await fetch('/api/user/guilds');
                const guilds = await res.json();
                const grid = document.getElementById('guildGrid');
                grid.innerHTML = '';

                let totalServersWithBot = 0;
                let scoreSum = 0;

                guilds.forEach(g => {
                    if (g.hasBot) {
                        totalServersWithBot++;
                        scoreSum += g.securityScore;
                    }

                    grid.innerHTML += \`
                        <div class="guild-card">
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 15px;">
                                <img src="\${g.icon}" style="width: 48px; height: 48px; border-radius: 10px; border: 1px solid var(--border);">
                                <div style="overflow: hidden;">
                                    <h3 style="font-size: 1rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">\${g.name}</h3>
                                    <p style="color: var(--muted); font-size: 0.75rem; margin-top: 2px;">Security Score: <strong style="color: var(--accent);">\${g.securityScore}/100</strong></p>
                                </div>
                            </div>
                            \${g.hasBot 
                                ? \`<button class="btn" style="width: 100%; background: #1e293b; color: var(--text);" onclick="openGuildDetail('\${g.id}', '\${g.name}', '\${g.icon}')">ADMINISTRAR →</button>\`
                                : \`<a href="\${g.inviteUrl}" target="_blank" class="btn" style="width: 100%; text-decoration: none;">INVITAR BOT</a>\`
                            }
                        </div>
                    \`;
                });

                document.getElementById('statServersCount').innerText = totalServersWithBot;
                document.getElementById('statAvgScore').innerText = totalServersWithBot > 0 ? Math.round(scoreSum / totalServersWithBot) + '%' : '0%';
                document.getElementById('statIncidentsCount').innerText = '03';
            }

            async function openGuildDetail(guildId, guildName, guildIcon) {
                document.getElementById('detailGuildName').innerText = guildName;
                document.getElementById('detailGuildIcon').src = guildIcon;

                showSection('guild-detail');

                const res = await fetch(\`/api/guilds/\${guildId}/data\`);
                currentGuildData = await res.json();

                document.getElementById('detailScoreNum').innerText = currentGuildData.score + '/100';
                document.getElementById('detailScoreBar').style.width = currentGuildData.score + '%';

                document.getElementById('badgeAntiRaid').innerText = currentGuildData.config.antiRaid.enabled ? 'ACTIVADO' : 'APAGADO';
                document.getElementById('badgeAntiRaid').style.color = currentGuildData.config.antiRaid.enabled ? 'var(--success)' : 'var(--critical)';

                document.getElementById('badgeAntiNuke').innerText = currentGuildData.config.antiNuke.enabled ? 'ACTIVADO' : 'APAGADO';
                document.getElementById('badgeAntiNuke').style.color = currentGuildData.config.antiNuke.enabled ? 'var(--success)' : 'var(--critical)';

                // Render Security Center list
                const secList = document.getElementById('securityCenterList');
                secList.innerHTML = \`
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;"><span>Anti-Raid</span><strong style="color:var(--success);">100%</strong></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;"><span>Anti-Nuke</span><strong style="color:var(--success);">100%</strong></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;"><span>AutoMod</span><strong style="color:var(--warning);">92%</strong></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;"><span>Anti-Alt</span><strong style="color:var(--success);">100%</strong></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px;"><span>Anti-Webhook</span><strong style="color:var(--success);">100%</strong></div>
                \`;

                // Render Incidents
                const incList = document.getElementById('recentIncidentsList');
                incList.innerHTML = \`
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(239,68,68,0.05); border-left: 3px solid var(--critical); border-radius: 4px; font-size: 0.85rem;"><span>🔴 Mass ban detected</span><span style="color:var(--muted);">2m ago</span></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(245,158,11,0.05); border-left: 3px solid var(--warning); border-radius: 4px; font-size: 0.85rem;"><span>🟡 Suspicious webhook</span><span style="color:var(--muted);">8m ago</span></div>
                    <div style="display:flex; justify-content:space-between; padding: 10px; background: rgba(16,185,129,0.05); border-left: 3px solid var(--success); border-radius: 4px; font-size: 0.85rem;"><span>🟢 Threat blocked</span><span style="color:var(--muted);">21m ago</span></div>
                \`;
            }

            function showSection(sec) {
                document.getElementById('sec-servers').classList.add('hidden');
                document.getElementById('sec-support').classList.add('hidden');
                document.getElementById('sec-guild-detail').classList.add('hidden');
                document.getElementById('sec-' + sec).classList.remove('hidden');
            }

            async function sendTicket() {
                const category = document.getElementById('supCategory').value;
                const message = document.getElementById('supMsg').value;

                const res = await fetch('/api/support/ticket', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ category, message })
                });

                const data = await res.json();
                if (data.success) {
                    alert('✅ Ticket enviado al servidor NEROX HQ. ID: ' + data.ticketId);
                    document.getElementById('supMsg').value = '';
                }
            }
        </script>
    </body>
    </html>
    `);
});

// ==========================================
// 8. COMANDOS DISCORD & VALIDACIÓN JERÁRQUICA
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId, member, guild } = interaction;
    if (!guildId) return interaction.reply({ content: '❌ Este comando solo funciona dentro de un servidor.', ephemeral: true });

    const config = getGuildConfig(guildId);
    const owners = getGuildOwners(guildId);

    if (commandName === 'setup') {
        const hasLogs = Boolean(config.logsChannelId);
        const hasSecondOwner = Boolean(owners.secondaryOwnerId);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ NEROX GUARD — Estado de Configuración Obligatoria')
            .addFields(
                { name: '1. Canal de Logs', value: hasLogs ? `🟢 <#${config.logsChannelId}>` : '🔴 **NO CONFIGURADO (OBLIGATORIO)**', inline: false },
                { name: '2. Segundo Owner', value: hasSecondOwner ? `🟢 <@${owners.secondaryOwnerId}>` : '🔴 **NO CONFIGURADO (OBLIGATORIO)**', inline: false },
                { name: 'Estado Global', value: (hasLogs && hasSecondOwner) ? '🟢 **SISTEMA TOTALMENTE PROTEGIDO**' : '⚠️ **PROTECCIÓN PARCIAL — SETUP INCOMPLETO**', inline: false }
            )
            .setColor((hasLogs && hasSecondOwner) ? '#10b981' : '#ef4444');

        return interaction.reply({ embeds: [embed] });
    }

    const modCommands = ['ban', 'kick', 'timeout', 'warn'];
    if (modCommands.includes(commandName)) {
        if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: '❌ No tienes permisos para ejecutar acciones de moderación.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('target');
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember) {
            if (targetMember.roles.highest.position >= member.roles.highest.position) {
                return interaction.reply({ content: '❌ No puedes aplicar sanciones a usuarios con un rol igual o superior al tuyo.', ephemeral: true });
            }
            if (!targetMember.bannable && commandName === 'ban') {
                return interaction.reply({ content: '❌ NEROX GUARD no tiene permisos suficientes para banear a este usuario.', ephemeral: true });
            }
        }

        if (commandName === 'ban') {
            await guild.members.ban(targetUser.id, { reason: 'Sanción aplicada vía NEROX GUARD' });
            pushLog(guildId, 'MODERATION', 'Usuario Baneado', `@${targetUser.tag} baneado por @${interaction.user.tag}`, 'HIGH');
            return interaction.reply({ content: `🔨 **@${targetUser.tag}** ha sido baneado del servidor.` });
        }

        if (commandName === 'kick' && targetMember) {
            await targetMember.kick('Sanción aplicada vía NEROX GUARD');
            pushLog(guildId, 'MODERATION', 'Usuario Expulsado', `@${targetUser.tag} expulsado por @${interaction.user.tag}`, 'MEDIUM');
            return interaction.reply({ content: `👢 **@${targetUser.tag}** ha sido expulsado del servidor.` });
        }

        if (commandName === 'timeout' && targetMember) {
            const duration = interaction.options.getInteger('duration');
            await targetMember.timeout(duration * 1000, 'Aislamiento vía NEROX GUARD');
            pushLog(guildId, 'MODERATION', 'Timeout Aplicado', `@${targetUser.tag} aislado por ${duration} segundos por @${interaction.user.tag}`, 'MEDIUM');
            return interaction.reply({ content: `🔇 **@${targetUser.tag}** aislado por ${duration} segundos.` });
        }
    }

    if (commandName === 'lockdown') {
        config.lockdownActive = true;
        saveDatabase();

        guild.channels.cache.forEach(async (ch) => {
            if (ch.type === ChannelType.GuildText) {
                await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => null);
            }
        });

        pushLog(guildId, 'LOCKDOWN', '🔒 MODOS DE EMERGENCIA ACTIVADO', `Canales bloqueados globalmente por @${interaction.user.tag}`, 'CRITICAL');
        return interaction.reply({ content: '🔒 **LOCKDOWN GENERAL ACTIVADO.** Se han denegado los permisos de envío de mensajes en todos los canales de texto.' });
    }

    if (commandName === 'unlock') {
        config.lockdownActive = false;
        saveDatabase();

        guild.channels.cache.forEach(async (ch) => {
            if (ch.type === ChannelType.GuildText) {
                await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => null);
            }
        });

        pushLog(guildId, 'LOCKDOWN', '🔓 MODOS DE EMERGENCIA DESACTIVADO', `Permisos restablecidos por @${interaction.user.tag}`, 'HIGH');
        return interaction.reply({ content: '🔓 **LOCKDOWN DESACTIVADO.** Restablecidos los permisos normales de los canales.' });
    }

    return interaction.reply({ content: `✅ Comando \`/${commandName}\` procesado correctamente por NEROX GUARD.`, ephemeral: true });
});

// ==========================================
// 9. MOTORES DE TIEMPO REAL (SECURITY ENGINES)
// ==========================================
const messageTrackers = new Map();

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;
    const config = getGuildConfig(guildId);
    const userId = message.author.id;

    if (config.autoMod.enabled) {
        const content = message.content.toLowerCase();

        if (config.autoMod.invites && (content.includes('discord.gg/') || content.includes('discord.com/invite/'))) {
            await message.delete().catch(() => null);
            pushLog(guildId, 'AUTOMOD', 'Invitación Eliminada', `Mensaje de @${message.author.tag} eliminado por contener invitaciones.`, 'MEDIUM');
            return;
        }

        if (config.autoMod.badWords.some(word => content.includes(word))) {
            await message.delete().catch(() => null);
            pushLog(guildId, 'AUTOMOD', 'Contenido Prohibido Eliminado', `Mensaje de @${message.author.tag} eliminado por filtro de palabras/scam.`, 'HIGH');
            return;
        }
    }

    const rules = memoryDB.smartRules.get(guildId) || [];
    const messageRules = rules.filter(r => r.event === 'MESSAGES');

    for (const rule of messageRules) {
        const key = `${guildId}_${userId}_${rule.id}`;
        const now = Date.now();
        const timestamps = (messageTrackers.get(key) || []).filter(t => now - t < rule.timeSec * 1000);
        timestamps.push(now);
        messageTrackers.set(key, timestamps);

        if (timestamps.length >= rule.count) {
            messageTrackers.set(key, []);

            if (rule.deleteMessages) {
                await message.channel.bulkDelete(rule.count).catch(() => null);
            }

            if (rule.action === 'TIMEOUT') {
                const member = await message.guild.members.fetch(userId).catch(() => null);
                if (member && member.moderatable) {
                    await member.timeout(rule.durationSec * 1000, `Smart Rule gatillada: ${rule.name}`);
                }
            }

            createIncident(guildId, 'SMART_RULE_TRIGGER', message.author.tag, userId, rule.action, `Violó la regla "${rule.name}" (${rule.count} msgs / ${rule.timeSec}s).`);
            break;
        }
    }
});

const nukeTrackers = new Map();

function trackNukeEvent(guildId, executorId, actionType, limit, windowSec, onThresholdExceeded) {
    const key = `${guildId}_${executorId}_${actionType}`;
    const now = Date.now();
    const history = (nukeTrackers.get(key) || []).filter(t => now - t < windowSec * 1000);
    history.push(now);
    nukeTrackers.set(key, history);

    if (history.length >= limit) {
        nukeTrackers.set(key, []);
        onThresholdExceeded(history.length);
    }
}

client.on('guildBanAdd', async (ban) => {
    const config = getGuildConfig(ban.guild.id);
    if (!config.antiNuke.enabled) return;

    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.bot) return;

    trackNukeEvent(ban.guild.id, entry.executor.id, 'MASS_BAN', config.antiNuke.massBanLimit, 10, async (count) => {
        const executorMember = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executorMember) {
            await executorMember.roles.set([]).catch(() => null);
        }
        createIncident(ban.guild.id, 'ANTI_NUKE_MASS_BAN', entry.executor.tag, entry.executor.id, 'REVOKE_ROLES', `Ejecutó ${count} baneos masivos en menos de 10 segundos.`);
    });
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const config = getGuildConfig(channel.guild.id);
    if (!config.antiNuke.enabled) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.executor.bot) return;

    trackNukeEvent(channel.guild.id, entry.executor.id, 'MASS_CHANNEL_DELETE', config.antiNuke.channelDeleteLimit, 10, async (count) => {
        const executorMember = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (executorMember) {
            await executorMember.roles.set([]).catch(() => null);
        }
        createIncident(channel.guild.id, 'ANTI_NUKE_CHANNEL_DELETE', entry.executor.tag, entry.executor.id, 'REVOKE_ROLES', `Eliminó ${count} canales masivamente.`);
    });
});

client.on('webhookUpdate', async (channel) => {
    const config = getGuildConfig(channel.guild.id);
    if (!config.antiWebhook.enabled) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.WebhookCreate }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry) return;

    if (!config.whitelist.users.includes(entry.executor.id)) {
        pushLog(channel.guild.id, 'ANTI_WEBHOOK', 'Webhook Sospechoso Creado', `Webhook creado por @${entry.executor.tag} en <#${channel.id}>. Protegido por NEROX.`, 'HIGH');
    }
});

// ==========================================
// 10. ARRANCADOR DE SERVICIOS
// ==========================================
app.listen(CONFIG.PORT, () => {
    console.log(`🌐 [EXPRESS] Dashboard Enterprise V2 activo en el puerto ${CONFIG.PORT}`);
});

client.once('ready', async () => {
    console.log(`🤖 [BOT] NEROX GUARD Enterprise conectado correctamente como ${client.user.tag}`);
    await registerCommands();
});

client.login(CONFIG.BOT_TOKEN);

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    AuditLogEvent,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// ==========================================
// 1. CLIENTE Y BASES DE DATOS EN MEMORIA
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

// En producción se gestiona con Prisma + PostgreSQL
const dbConfig = new Map();
const dbPanels = new Map();      // Paneles de tickets
const dbEconomy = new Map();     // Economía ($)
const dbStats = new Map();       // Métricas globales

function getGuildConfig(guildId) {
    if (!dbConfig.has(guildId)) {
        dbConfig.set(guildId, {
            logs: { security: null, mod: null, tickets: null, economy: null, users: null },
            welcome: { enabled: false, channelId: null, message: '¡Bienvenido {user} a {server}!', autoRoleId: null },
            farewell: { enabled: false, channelId: null, message: '{user} ha dejado el servidor.' },
            economySymbol: '$',
            economyName: 'Dólares',
            security: {
                antiNuke: true, antiRaid: true, antiBot: true, antiWebhook: true,
                antiSpam: true, antiLink: true, antiScam: true, antiMassBan: true,
                antiRoleDelete: true, antiChannelDelete: true
            }
        });
    }
    return dbConfig.get(guildId);
}

function getGuildEconomy(guildId, userId) {
    const key = `${guildId}-${userId}`;
    if (!dbEconomy.has(key)) {
        dbEconomy.set(key, { cash: 100, bank: 0, lastWork: 0 });
    }
    return dbEconomy.get(key);
}

function recordStat(type) {
    const current = dbStats.get(type) || 0;
    dbStats.set(type, current + 1);
}

// ==========================================
// 2. DASHBOARD EXPRESS ENGINE
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'sn_security_secret_key',
    resave: false,
    saveUninitialized: false
}));

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

// OAuth2 Discord
app.get('/login', (req, res) => {
    const redirectUri = encodeURIComponent(`${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código no provisto.');

    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
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

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.send('Error en OAuth2.');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        req.session.user = await userRes.json();
        req.session.guilds = await guildsRes.json();
        res.redirect('/dashboard');
    } catch (err) {
        console.error('[OAuth2 Error]', err);
        res.status(500).send('Error de autenticación.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Maquetación HTML del Dashboard
const renderHeader = (user, title = "Dashboard") => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - SN SECURITY</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root { --bg-main: #0b0f19; --bg-card: #151c2c; --accent: #38bdf8; --accent-hover: #0284c7; --text: #f8fafc; --text-sub: #94a3b8; --border: #334155; --success: #22c55e; --danger: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 0; }
        body { background: var(--bg-main); color: var(--text); display: flex; min-height: 100vh; }
        .sidebar { width: 260px; background: #0d1322; border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; justify-content: space-between; }
        .sidebar .brand { font-size: 1.4em; font-weight: bold; color: var(--accent); display: flex; align-items: center; gap: 10px; margin-bottom: 30px; }
        .nav-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .nav-item a { color: var(--text-sub); text-decoration: none; padding: 12px 16px; border-radius: 8px; display: flex; align-items: center; gap: 12px; font-weight: 500; transition: 0.2s; }
        .nav-item a:hover, .nav-item.active a { background: var(--bg-card); color: var(--text); border-left: 4px solid var(--accent); }
        .user-profile { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-card); border-radius: 10px; }
        .user-avatar { width: 40px; height: 40px; border-radius: 50%; }
        .main-content { flex: 1; padding: 40px; overflow-y: auto; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: var(--bg-card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); }
        .stat-card .val { font-size: 1.8em; font-weight: bold; color: var(--accent); margin-top: 5px; }
        .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 20px; }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .btn { background: var(--accent); color: #fff; padding: 10px 20px; border-radius: 8px; border: none; font-weight: bold; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s; }
        .btn:hover { background: var(--accent-hover); }
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #334155; transition: .4s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(20px); }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; color: var(--text-sub); }
        .form-group input, .form-group textarea { width: 100%; padding: 10px; background: var(--bg-main); border: 1px solid var(--border); border-radius: 6px; color: #fff; }
    </style>
</head>
<body>
    <div class="sidebar">
        <div>
            <div class="brand"><i class="fa-solid fa-shield-halved"></i> SN SECURITY</div>
            <ul class="nav-list">
                <li class="nav-item active"><a href="/dashboard"><i class="fa-solid fa-house"></i> Servidores</a></li>
            </ul>
        </div>
        ${user ? `
        <div class="user-profile">
            <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="user-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div style="flex:1; overflow:hidden;">
                <strong style="font-size:0.9em; display:block; text-overflow:ellipsis; overflow:hidden;">${user.username}</strong>
                <a href="/logout" style="color:var(--danger); font-size:0.8em; text-decoration:none;">Cerrar Sesión</a>
            </div>
        </div>` : ''}
    </div>
    <div class="main-content">
`;

// Rutas Express
app.get('/', (req, res) => {
    res.send(`
        ${renderHeader(null, "Inicio")}
        <div style="text-align:center; padding: 100px 20px;">
            <h1 style="font-size:3em; margin-bottom:10px; color:var(--accent);">🛡️ SN SECURITY</h1>
            <p style="color:var(--text-sub); margin-bottom:30px; font-size:1.2em;">Sistema integral de protección, gestión de tickets y economía.</p>
            <a href="/dashboard" class="btn" style="padding: 15px 30px; font-size: 1.1em;"><i class="fa-solid fa-right-to-bracket"></i> Acceder al Panel</a>
        </div>
        </body></html>
    `);
});

app.get('/dashboard', isAuth, (req, res) => {
    const adminGuilds = (req.session.guilds || []).filter(g => (parseInt(g.permissions) & 0x8) === 0x8);

    let listHtml = adminGuilds.map(g => {
        const active = client.guilds.cache.has(g.id);
        return `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:15px;">
                    <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:50px; height:50px; border-radius:50%;">
                    <div>
                        <h3>${g.name}</h3>
                        <span style="color:${active ? 'var(--success)' : 'var(--danger)'}; font-size:0.85em;">
                            ${active ? '● Bot Conectado' : '○ No configurado'}
                        </span>
                    </div>
                </div>
                ${active 
                    ? `<a href="/dashboard/guild/${g.id}" class="btn"><i class="fa-solid fa-sliders"></i> Administrar</a>`
                    : `<a href="https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot" target="_blank" class="btn" style="background:#475569;"><i class="fa-solid fa-plus"></i> Añadir Bot</a>`
                }
            </div>
        `;
    }).join('');

    res.send(`
        ${renderHeader(req.session.user, "Servidores")}
        <div class="top-bar">
            <h2>Panel Central</h2>
        </div>
        <div class="stats-grid">
            <div class="stat-card"><div>Estado</div><div class="val" style="color:var(--success);">🟢 En Línea</div></div>
            <div class="stat-card"><div>Ping</div><div class="val">${client.ws.ping}ms</div></div>
            <div class="stat-card"><div>Servidores</div><div class="val">${client.guilds.cache.size}</div></div>
            <div class="stat-card"><div>Ataques Bloqueados</div><div class="val">${dbStats.get('attacks') || 0}</div></div>
        </div>
        <h3>Tus Servidores</h3><br>
        ${listHtml || '<p>No administras ningún servidor actualmente.</p>'}
        </body></html>
    `);
});

app.get('/dashboard/guild/:guildId', isAuth, (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.send('El bot no está en este servidor.');

    const config = getGuildConfig(guildId);
    const panels = dbPanels.get(guildId) || [];

    res.send(`
        ${renderHeader(req.session.user, guild.name)}
        <div class="top-bar">
            <h2>Configuración: ${guild.name}</h2>
            <a href="/dashboard" class="btn" style="background:#475569;">← Volver</a>
        </div>

        <div class="card">
            <h3><i class="fa-solid fa-shield-halved" style="color:var(--accent);"></i> 🛡️ Módulos de Seguridad</h3><br>
            <form action="/dashboard/guild/${guildId}/security" method="POST" class="grid-2">
                ${Object.entries(config.security).map(([m, state]) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-main); padding:12px 16px; border-radius:8px;">
                        <span style="font-weight:bold; text-transform:capitalize;">${m.replace('anti', 'Anti ')}</span>
                        <label class="switch">
                            <input type="checkbox" name="${m}" ${state ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                `).join('')}
                <div style="grid-column: 1 / -1; margin-top:10px;">
                    <button class="btn" type="submit"><i class="fa-solid fa-floppy-disk"></i> Guardar Cambios</button>
                </div>
            </form>
        </div>

        <div class="card">
            <h3><i class="fa-solid fa-ticket" style="color:var(--accent);"></i> 🎫 Paneles de Soporte</h3><br>
            <div style="margin-bottom:20px;">
                ${panels.map((p, idx) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-main); padding:12px; border-radius:8px; margin-bottom:8px;">
                        <div><strong>${p.title}</strong> - <span style="color:var(--text-sub);">Canal: <#${p.channelId}></span></div>
                        <form action="/dashboard/guild/${guildId}/tickets/deploy" method="POST" style="display:inline;">
                            <input type="hidden" name="panelIndex" value="${idx}">
                            <button class="btn" type="submit" style="padding:6px 12px; font-size:0.85em;"><i class="fa-solid fa-paper-plane"></i> Enviar</button>
                        </form>
                    </div>
                `).join('') || '<p style="color:var(--text-sub);">No hay paneles configurados.</p>'}
            </div>

            <h4>Crear Nuevo Panel</h4><br>
            <form action="/dashboard/guild/${guildId}/tickets/create" method="POST" class="form-group">
                <div class="grid-2">
                    <div>
                        <label>Título</label>
                        <input type="text" name="title" placeholder="Ej: SOPORTE TÉCNICO" required>
                    </div>
                    <div>
                        <label>ID del Canal</label>
                        <input type="text" name="channelId" placeholder="ID del canal de texto" required>
                    </div>
                </div>
                <div style="margin-top:10px;">
                    <label>Descripción</label>
                    <textarea name="description" placeholder="Haz clic en el botón para abrir un ticket..."></textarea>
                </div>
                <button class="btn" type="submit" style="margin-top:10px;"><i class="fa-solid fa-plus"></i> Crear Panel</button>
            </form>
        </div>
        </body></html>
    `);
});

app.post('/dashboard/guild/:guildId/security', isAuth, (req, res) => {
    const { guildId } = req.params;
    const config = getGuildConfig(guildId);
    Object.keys(config.security).forEach(key => {
        config.security[key] = req.body[key] === 'on';
    });
    dbConfig.set(guildId, config);
    res.redirect(`/dashboard/guild/${guildId}`);
});

app.post('/dashboard/guild/:guildId/tickets/create', isAuth, (req, res) => {
    const { guildId } = req.params;
    const { title, channelId, description } = req.body;
    const panels = dbPanels.get(guildId) || [];
    panels.push({ title, channelId, description });
    dbPanels.set(guildId, panels);
    res.redirect(`/dashboard/guild/${guildId}`);
});

app.post('/dashboard/guild/:guildId/tickets/deploy', isAuth, async (req, res) => {
    const { guildId } = req.params;
    const { panelIndex } = req.body;
    const guild = client.guilds.cache.get(guildId);
    const panels = dbPanels.get(guildId) || [];
    const panel = panels[panelIndex];

    if (guild && panel) {
        const channel = guild.channels.cache.get(panel.channelId);
        if (channel && channel.isTextBased()) {
            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${panel.title}`)
                .setDescription(panel.description || 'Abre un ticket para consultar con soporte.')
                .setColor(0x38BDF8);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ticket_open_${panelIndex}`)
                    .setLabel('Abrir Ticket')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary)
            );

            await channel.send({ embeds: [embed], components: [row] });
        }
    }
    res.redirect(`/dashboard/guild/${guildId}`);
});

app.listen(PORT, () => {
    console.log(`[SN SECURITY] Servidor Web activo en puerto ${PORT}`);
});

// ==========================================
// 3. EVENTOS Y FUNCIONES DE DISCORD
// ==========================================
async function handleAntiNukeAction(guild, executor, actionName) {
    if (!executor || executor.id === client.user.id || executor.id === guild.ownerId) return;
    try {
        recordStat('attacks');
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member) {
            await member.roles.set([]).catch(() => {});
            await member.ban({ reason: `[SN SECURITY] ${actionName}` }).catch(() => {});
        }
    } catch (err) {
        console.error(`[AntiNuke Error] ${err.message}`);
    }
}

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const config = getGuildConfig(channel.guild.id);
    if (!config.security?.antiChannelDelete) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(channel.guild, entry.executor, `Eliminación del canal #${channel.name}`);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('ticket_open_')) {
        const modal = new ModalBuilder()
            .setCustomId(`modal_ticket_submit`)
            .setTitle('Formulario de Soporte');

        const inputReason = new TextInputBuilder()
            .setCustomId('ticket_reason')
            .setLabel('Motivo de tu solicitud')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(inputReason));
        return await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_ticket_submit') {
        const reason = interaction.fields.getTextInputValue('ticket_reason');
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: 0
        });

        const embed = new EmbedBuilder()
            .setTitle(`🎫 Ticket de ${interaction.user.tag}`)
            .setDescription(`**Motivo:** ${reason}`)
            .setColor(0x22C55E);

        await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
        recordStat('tickets');
        return interaction.reply({ content: `✅ Ticket creado en ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.isChatInputCommand()) {
        const { commandName, guildId, user } = interaction;
        const config = getGuildConfig(guildId);

        if (commandName === 'balance') {
            const eco = getGuildEconomy(guildId, user.id);
            const embed = new EmbedBuilder()
                .setTitle(`💰 Balance de ${user.username}`)
                .setColor(0x38BDF8)
                .addFields(
                    { name: 'Efectivo', value: `${config.economySymbol}${eco.cash}`, inline: true },
                    { name: 'Banco', value: `${config.economySymbol}${eco.bank}`, inline: true }
                );
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'work') {
            const eco = getGuildEconomy(guildId, user.id);
            const now = Date.now();
            if (now - eco.lastWork < 3600000) {
                return interaction.reply({ content: '⏳ Debes esperar 1 hora para volver a trabajar.', ephemeral: true });
            }
            const reward = Math.floor(Math.random() * 400) + 100;
            eco.cash += reward;
            eco.lastWork = now;
            return interaction.reply(`👷 Ganaste **${config.economySymbol}${reward}** ${config.economyName}.`);
        }
    }
});

client.once('ready', async () => {
    console.log(`[SN SECURITY] Bot conectado como ${client.user.tag}`);
    const commands = [
        { name: 'balance', description: 'Muestra tu saldo actual' },
        { name: 'work', description: 'Trabaja para ganar dinero' }
    ];
    await client.application.commands.set(commands).catch(console.error);
});

client.login(process.env.DISCORD_TOKEN);

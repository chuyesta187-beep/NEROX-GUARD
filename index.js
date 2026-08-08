// ==========================================
// NEROX GUARD - ENTERPRISE DASHBOARD & SECURITY PLATFORM
// ==========================================

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    AuditLogEvent
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURACIÓN Y VARIABLES DE ENTORNO
// ==========================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    CLIENT_ID: process.env.CLIENT_ID || 'TU_CLIENT_ID',
    CLIENT_SECRET: process.env.CLIENT_SECRET || 'TU_CLIENT_SECRET',
    BOT_TOKEN: process.env.DISCORD_TOKEN || 'TU_DISCORD_TOKEN',
    DASHBOARD_URL: process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3000}`,
    SESSION_SECRET: process.env.SESSION_SECRET || 'nerox_super_secret_session_key_2026',
    DB_PATH: path.join(__dirname, 'database.json'),
    OWNER_IDS: ['TU_DISCORD_USER_ID']
};

// ==========================================
// 2. PERSISTENCIA EN DISCO Y MEMORIA
// ==========================================
const memoryDB = {
    guildSettings: new Map(), // guildId -> { antiNuke, antiRaid, autoMod, logsChannel, whitelist }
    welcomeConfigs: new Map(),
    forms: new Map(),
    formSubmissions: new Map(),
    incidents: new Map()      // incidentId -> data
};

function loadDatabase() {
    if (fs.existsSync(CONFIG.DB_PATH)) {
        try {
            const raw = fs.readFileSync(CONFIG.DB_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (data.guildSettings) memoryDB.guildSettings = new Map(data.guildSettings);
            if (data.welcomeConfigs) memoryDB.welcomeConfigs = new Map(data.welcomeConfigs);
            if (data.forms) memoryDB.forms = new Map(data.forms);
            if (data.formSubmissions) memoryDB.formSubmissions = new Map(data.formSubmissions);
            if (data.incidents) memoryDB.incidents = new Map(data.incidents);
            console.log('💾 [DB] Base de datos sincronizada desde database.json');
        } catch (err) {
            console.error('❌ Error al cargar database.json:', err);
        }
    } else {
        saveDatabase();
    }
}

function saveDatabase() {
    try {
        const data = {
            guildSettings: Array.from(memoryDB.guildSettings.entries()),
            welcomeConfigs: Array.from(memoryDB.welcomeConfigs.entries()),
            forms: Array.from(memoryDB.forms.entries()),
            formSubmissions: Array.from(memoryDB.formSubmissions.entries()),
            incidents: Array.from(memoryDB.incidents.entries())
        };
        fs.writeFileSync(CONFIG.DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Error al guardar datos en database.json:', err);
    }
}

loadDatabase();

function getGuildSettings(guildId) {
    if (!memoryDB.guildSettings.has(guildId)) {
        memoryDB.guildSettings.set(guildId, {
            securityScore: 85,
            antiNuke: { enabled: true, antiChannelDelete: true, antiRoleDelete: true, antiBanMass: true },
            antiRaid: { enabled: true, joinLimit: 5, windowSeconds: 10, action: 'kick' },
            autoMod: { enabled: true, antiSpam: true, antiLinks: true, badWords: [] },
            logsChannel: null,
            whitelist: []
        });
        saveDatabase();
    }
    return memoryDB.guildSettings.get(guildId);
}

// ==========================================
// 3. INICIALIZACIÓN CLIENTE DISCORD BOT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration || GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ].filter(Boolean)
});

// Trackers de joins para Anti-Raid
const joinTracker = new Map(); // guildId -> Array<timestamps>

// ==========================================
// 4. MOTOR EXPRESS Y OAUTH2
// ==========================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 * 7 }
}));

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    const redirectUri = encodeURIComponent(`${CONFIG.DASHBOARD_URL}/api/auth/callback`);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login');

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
        if (!tokenData.access_token) return res.redirect('/login');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guildsData = await guildsRes.json();

        req.session.user = userData;
        req.session.guilds = Array.isArray(guildsData) ? guildsData : [];
        res.redirect('/dashboard');
    } catch (err) {
        console.error('❌ OAuth2 Error:', err);
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// 5. FRONTEND DASHBOARD ENTERPRISE VISTA
// ==========================================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>NEROX GUARD — Enterprise Security</title>
        <style>
            body { background: #030712; color: #f9fafb; font-family: system-ui, sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center; }
            .card { background: #111827; border: 1px solid #1f2937; padding: 40px; border-radius: 12px; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h1 { color: #06b6d4; margin-bottom: 10px; font-size: 1.8rem; }
            p { color: #9ca3af; margin-bottom: 25px; font-size: 0.95rem; }
            a { background: #06b6d4; color: #000; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; }
            a:hover { background: #22d3ee; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🛡️ NEROX GUARD</h1>
            <p>Plataforma de Administración y Protección Inteligente para Servidores de Discord.</p>
            <a href="/login">Acceder con Discord</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/dashboard', isAuth, (req, res) => {
    const adminGuilds = req.session.guilds.filter(g => (parseInt(g.permissions) & 0x8) === 0x8);

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard — NEROX GUARD</title>
        <style>
            :root {
                --bg: #030712; --sidebar: #0b0f19; --card: #111827; --border: #1f2937;
                --accent: #06b6d4; --accent-hover: #22d3ee; --text: #f9fafb; --muted: #9ca3af;
                --danger: #ef4444; --success: #10b981; --warning: #f59e0b;
            }
            * { margin:0; padding:0; box-sizing:border-box; font-family: system-ui, -apple-system, sans-serif; }
            body { background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }

            .sidebar { width: 260px; background: var(--sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; justify-content: space-between; }
            .brand { padding: 20px; font-size: 1.2rem; font-weight: bold; color: var(--accent); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
            .nav-group { padding: 15px 10px; flex: 1; overflow-y: auto; }
            .nav-title { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); padding: 10px 10px 5px; font-weight: 700; letter-spacing: 0.05em; }
            .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; color: var(--muted); text-decoration: none; border-radius: 6px; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: 0.2s; margin-bottom: 2px; }
            .nav-item:hover, .nav-item.active { background: #1f2937; color: var(--text); }
            .nav-item.active { border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; }

            .user-block { padding: 15px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
            .user-info { display: flex; align-items: center; gap: 10px; }
            .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); }
            .logout-btn { color: var(--danger); text-decoration: none; font-size: 0.8rem; font-weight: bold; }

            .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
            .topbar { height: 60px; background: var(--sidebar); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 25px; }
            .status-badge { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--success); font-weight: 600; }
            .dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); }

            .content { flex: 1; padding: 25px; overflow-y: auto; }
            .page { display: none; }
            .page.active { display: block; }

            .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 25px; }
            .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
            .card-title { font-size: 0.9rem; color: var(--muted); font-weight: 600; margin-bottom: 5px; }
            .card-value { font-size: 1.8rem; font-weight: bold; color: var(--text); }

            select, input, textarea { width: 100%; background: #030712; border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; margin-top: 5px; font-size: 0.9rem; }
            button.btn { background: var(--accent); color: #000; font-weight: bold; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; transition: 0.2s; margin-top: 15px; }
            button.btn:hover { background: var(--accent-hover); }

            .switch-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); }
            .switch-row:last-child { border-bottom: none; }

            @media (max-width: 768px) {
                body { flex-direction: column; }
                .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
                .nav-group { display: flex; overflow-x: auto; padding: 5px; }
                .nav-title { display: none; }
                .user-block { display: none; }
            }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div>
                <div class="brand">🛡️ NEROX GUARD</div>
                <div class="nav-group">
                    <div class="nav-title">Navegación</div>
                    <div class="nav-item active" onclick="showPage('overview')">🏠 Inicio</div>
                    <div class="nav-item" onclick="showPage('security')">🛡️ Seguridad</div>
                    <div class="nav-item" onclick="showPage('community')">👋 Comunidad</div>
                    <div class="nav-item" onclick="showPage('forms')">📋 Formularios</div>
                    <div class="nav-item" onclick="showPage('logs')">🚨 Incidentes y Logs</div>
                </div>
            </div>
            <div class="user-block">
                <div class="user-info">
                    <img class="avatar" src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                    <span style="font-size:0.85rem; font-weight:bold;">${req.session.user.username}</span>
                </div>
                <a href="/logout" class="logout-btn">Salir</a>
            </div>
        </div>

        <div class="main">
            <div class="topbar">
                <div style="width: 300px;">
                    <select id="selectedGuild" onchange="loadGuildData()">
                        <option value="">-- Selecciona un Servidor --</option>
                        ${adminGuilds.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
                    </select>
                </div>
                <div class="status-badge">
                    <div class="dot"></div> Sistema Operativo (2026 Core)
                </div>
            </div>

            <div class="content">
                <div id="overview" class="page active">
                    <h2 style="margin-bottom: 20px;">Estado del Sistema</h2>
                    <div class="grid-3">
                        <div class="card">
                            <div class="card-title">Security Score</div>
                            <div class="card-value" style="color: var(--success);" id="scoreVal">94/100</div>
                        </div>
                        <div class="card">
                            <div class="card-title">Nivel de Riesgo</div>
                            <div class="card-value" style="color: var(--accent);">🟢 BAJO</div>
                        </div>
                        <div class="card">
                            <div class="card-title">Incidentes Recientes</div>
                            <div class="card-value" id="incidentCount">0</div>
                        </div>
                    </div>
                </div>

                <div id="security" class="page">
                    <h2 style="margin-bottom: 20px;">Módulo de Seguridad Enterprise</h2>
                    <div class="grid-3">
                        <div class="card">
                            <h3>💥 Protección Anti-Nuke</h3>
                            <div class="switch-row">
                                <span>Bloqueo Eliminación de Canales</span>
                                <input type="checkbox" id="antiChannelDelete" checked>
                            </div>
                            <div class="switch-row">
                                <span>Bloqueo Eliminación de Roles</span>
                                <input type="checkbox" id="antiRoleDelete" checked>
                            </div>
                            <div class="switch-row">
                                <span>Bloqueo Bans Masivos</span>
                                <input type="checkbox" id="antiBanMass" checked>
                            </div>
                        </div>

                        <div class="card">
                            <h3>🚨 Protección Anti-Raid</h3>
                            <label>Límite de Joins Simultáneos</label>
                            <input type="number" id="joinLimit" value="5">
                            <label>Ventana de Tiempo (Segundos)</label>
                            <input type="number" id="windowSeconds" value="10">
                            <button class="btn" onclick="saveSecuritySettings()">Guardar Parámetros</button>
                        </div>
                    </div>
                </div>

                <div id="community" class="page">
                    <h2 style="margin-bottom: 20px;">Bienvenida y Sistema Social</h2>
                    <div class="card" style="max-width: 600px;">
                        <div class="switch-row">
                            <span>Activar Mensajes de Bienvenida</span>
                            <input type="checkbox" id="welcomeEnabled">
                        </div>
                        <label>ID Canal de Bienvenida</label>
                        <input type="text" id="welcomeChannel" placeholder="Ej: 1234567890">

                        <label>Mensaje Personalizado ({user}, {server}, {members})</label>
                        <textarea id="welcomeMessage" rows="3"></textarea>

                        <label>ID Rol Automático al Entrar (AutoRole)</label>
                        <input type="text" id="autoRoleId" placeholder="ID del Rol">

                        <button class="btn" onclick="saveWelcomeSettings()">Aplicar Cambios</button>
                    </div>
                </div>

                <div id="forms" class="page">
                    <h2 style="margin-bottom: 20px;">Gestor de Formularios y Postulaciones</h2>
                    <div class="card" style="max-width: 600px;">
                        <label>Título del Formulario</label>
                        <input type="text" id="formTitle" placeholder="Ej: POSTULACIÓN STAFF">

                        <label>Descripción</label>
                        <textarea id="formDesc" rows="2" placeholder="Instrucciones..."></textarea>

                        <label>ID Canal de Envíos</label>
                        <input type="text" id="formChannel" placeholder="Canal para revisiones">

                        <label>Pregunta 1</label>
                        <input type="text" id="q1" placeholder="¿Cuál es tu edad?">

                        <label>Pregunta 2</label>
                        <input type="text" id="q2" placeholder="¿Por qué quieres postular?">

                        <button class="btn" onclick="publishForm()">Crear y Publicar en Discord</button>
                    </div>
                </div>

                <div id="logs" class="page">
                    <h2 style="margin-bottom: 20px;">Registro de Incidentes y Auditoría</h2>
                    <div class="card">
                        <div id="incidentsList">Selecciona un servidor para consultar los registros.</div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            function showPage(pageId) {
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.getElementById(pageId).classList.add('active');
                event.currentTarget.classList.add('active');
            }

            async function loadGuildData() {
                const guildId = document.getElementById('selectedGuild').value;
                if(!guildId) return;

                const res = await fetch(\`/api/guilds/\${guildId}/config\`);
                if(!res.ok) return;
                const data = await res.json();

                document.getElementById('antiChannelDelete').checked = data.security.antiNuke.antiChannelDelete;
                document.getElementById('antiRoleDelete').checked = data.security.antiNuke.antiRoleDelete;
                document.getElementById('antiBanMass').checked = data.security.antiNuke.antiBanMass;
                document.getElementById('joinLimit').value = data.security.antiRaid.joinLimit;
                document.getElementById('windowSeconds').value = data.security.antiRaid.windowSeconds;

                document.getElementById('welcomeEnabled').checked = data.welcome.enabled;
                document.getElementById('welcomeChannel').value = data.welcome.channelId || '';
                document.getElementById('welcomeMessage').value = data.welcome.message || '';
                document.getElementById('autoRoleId').value = data.welcome.autoRoleId || '';
            }

            async function saveSecuritySettings() {
                const guildId = document.getElementById('selectedGuild').value;
                if(!guildId) return alert('Selecciona un servidor');

                const body = {
                    antiNuke: {
                        antiChannelDelete: document.getElementById('antiChannelDelete').checked,
                        antiRoleDelete: document.getElementById('antiRoleDelete').checked,
                        antiBanMass: document.getElementById('antiBanMass').checked
                    },
                    antiRaid: {
                        joinLimit: parseInt(document.getElementById('joinLimit').value),
                        windowSeconds: parseInt(document.getElementById('windowSeconds').value)
                    }
                };

                await fetch(\`/api/guilds/\${guildId}/security\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                alert('✅ Configuración de seguridad guardada.');
            }

            async function saveWelcomeSettings() {
                const guildId = document.getElementById('selectedGuild').value;
                if(!guildId) return alert('Selecciona un servidor');

                const body = {
                    enabled: document.getElementById('welcomeEnabled').checked,
                    channelId: document.getElementById('welcomeChannel').value,
                    message: document.getElementById('welcomeMessage').value,
                    autoRoleId: document.getElementById('autoRoleId').value
                };

                await fetch(\`/api/guilds/\${guildId}/welcome\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                alert('✅ Configuración de bienvenida actualizada.');
            }

            async function publishForm() {
                const guildId = document.getElementById('selectedGuild').value;
                if(!guildId) return alert('Selecciona un servidor');

                const body = {
                    title: document.getElementById('formTitle').value,
                    description: document.getElementById('formDesc').value,
                    channelId: document.getElementById('formChannel').value,
                    questions: [
                        { label: document.getElementById('q1').value, style: 'SHORT' },
                        { label: document.getElementById('q2').value, style: 'PARAGRAPH' }
                    ].filter(q => q.label.trim() !== '')
                };

                const res = await fetch(\`/api/guilds/\${guildId}/forms\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if(res.ok) alert('✅ Formulario publicado con éxito en Discord.');
                else alert('❌ Error al publicar el formulario.');
            }
        </script>
    </body>
    </html>
    `);
});

// ==========================================
// 6. ENDPOINTS API REST
// ==========================================
app.get('/api/guilds/:guildId/config', isAuth, (req, res) => {
    const { guildId } = req.params;
    res.json({
        security: getGuildSettings(guildId),
        welcome: memoryDB.welcomeConfigs.get(guildId) || { enabled: false }
    });
});

app.post('/api/guilds/:guildId/security', isAuth, (req, res) => {
    const { guildId } = req.params;
    const settings = getGuildSettings(guildId);
    
    settings.antiNuke = { ...settings.antiNuke, ...req.body.antiNuke };
    settings.antiRaid = { ...settings.antiRaid, ...req.body.antiRaid };

    saveDatabase();
    res.json({ success: true });
});

app.post('/api/guilds/:guildId/welcome', isAuth, (req, res) => {
    const { guildId } = req.params;
    memoryDB.welcomeConfigs.set(guildId, req.body);
    saveDatabase();
    res.json({ success: true });
});

app.post('/api/guilds/:guildId/forms', isAuth, async (req, res) => {
    const { guildId } = req.params;
    const { title, description, channelId, questions } = req.body;

    const formId = `form_${Date.now()}`;
    const form = { id: formId, guildId, title, description, channelId, questions };

    memoryDB.forms.set(formId, form);
    saveDatabase();

    try {
        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId);

        const embed = new EmbedBuilder()
            .setTitle(`📋 ${title}`)
            .setDescription(`${description}\n\n> *Haz clic en el botón para responder.*`)
            .setColor('#06b6d4');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_form_${formId}`)
                .setLabel('📝 Completar Formulario')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'No se pudo publicar en el canal indicado.' });
    }
});

// ==========================================
// 7. EVENTOS DE SEGURIDAD (ANTI-RAID, ANTI-NUKE & INTERACCIONES)
// ==========================================

client.on('guildMemberAdd', async (member) => {
    const settings = getGuildSettings(member.guild.id);

    const welcomeCfg = memoryDB.welcomeConfigs.get(member.guild.id);
    if (welcomeCfg) {
        if (welcomeCfg.autoRoleId) {
            const role = member.guild.roles.cache.get(welcomeCfg.autoRoleId);
            if (role) await member.roles.add(role).catch(() => null);
        }
        if (welcomeCfg.enabled && welcomeCfg.channelId) {
            const channel = member.guild.channels.cache.get(welcomeCfg.channelId);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(`👋 ¡Bienvenido/a a ${member.guild.name}!`)
                    .setDescription((welcomeCfg.message || "Bienvenido/a {user}").replace(/{user}/g, `<@${member.id}>`))
                    .setColor('#06b6d4');
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        }
    }

    if (!settings.antiRaid.enabled) return;

    const now = Date.now();
    const windowMs = settings.antiRaid.windowSeconds * 1000;
    
    if (!joinTracker.has(member.guild.id)) joinTracker.set(member.guild.id, []);
    const userJoins = joinTracker.get(member.guild.id);

    userJoins.push(now);
    const recentJoins = userJoins.filter(t => now - t < windowMs);
    joinTracker.set(member.guild.id, recentJoins);

    if (recentJoins.length > settings.antiRaid.joinLimit) {
        try {
            await member.kick('NEROX GUARD: Protección Anti-Raid Activada');
            
            const incidentId = `INC_${Date.now()}`;
            memoryDB.incidents.set(incidentId, {
                id: incidentId,
                guildId: member.guild.id,
                type: 'ANTI_RAID',
                user: member.user.tag,
                action: 'KICK',
                date: new Date().toISOString()
            });
            saveDatabase();
        } catch (e) {
            console.error('❌ Error ejecutando Anti-Raid:', e);
        }
    }
});

client.on('channelDelete', async (channel) => {
    const settings = getGuildSettings(channel.guild.id);
    if (!settings.antiNuke.enabled || !settings.antiNuke.antiChannelDelete) return;

    try {
        const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
        const entry = auditLogs.entries.first();
        if (!entry) return;

        const executor = entry.executor;
        if (executor.id === client.user.id || settings.whitelist.includes(executor.id)) return;

        const member = await channel.guild.members.fetch(executor.id);
        if (member) {
            await member.ban({ reason: 'NEROX GUARD: Anti-Nuke (Eliminación de canal no autorizada)' });
        }
    } catch (e) {
        console.error('❌ Error en Anti-Nuke Channel:', e);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('open_form_')) {
        const formId = interaction.customId.replace('open_form_', '');
        const form = memoryDB.forms.get(formId);

        if (!form) return interaction.reply({ content: '❌ Formulario no encontrado.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`submit_form_${form.id}`)
            .setTitle(form.title.substring(0, 45));

        const rows = form.questions.map(q => {
            const input = new TextInputBuilder()
                .setCustomId(`q_${q.label}`)
                .setLabel(q.label.substring(0, 45))
                .setStyle(q.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(true);
            return new ActionRowBuilder().addComponents(input);
        });

        modal.addComponents(rows);
        return await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_form_')) {
        const formId = interaction.customId.replace('submit_form_', '');
        const form = memoryDB.forms.get(formId);

        if (!form) return interaction.reply({ content: '❌ Formulario expirado.', ephemeral: true });

        const channel = interaction.guild.channels.cache.get(form.channelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(`📋 Respuesta: ${form.title}`)
                .setDescription(`**Postulante:** <@${interaction.user.id}> (${interaction.user.tag})`)
                .setColor('#f59e0b')
                .setTimestamp();

            form.questions.forEach(q => {
                const answer = interaction.fields.getTextInputValue(`q_${q.label}`);
                embed.addFields({ name: `📌 ${q.label}`, value: answer });
            });

            await channel.send({ embeds: [embed] });
        }

        return interaction.reply({ content: '✅ Formulario enviado al equipo de administración.', ephemeral: true });
    }
});

// ==========================================
// 8. ARRANQUE DEL SERVIDOR
// ==========================================
app.listen(CONFIG.PORT, () => {
    console.log(`🌐 Dashboard NEROX GUARD activo en puerto ${CONFIG.PORT}`);
});

client.once('ready', () => {
    console.log(`🤖 NEROX GUARD activado correctamente como ${client.user.tag}`);
});

client.login(CONFIG.BOT_TOKEN);

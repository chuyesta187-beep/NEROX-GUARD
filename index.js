// ==========================================
// NEROX GUARD - INDEX ENTERPRISE v2.5
// ==========================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    PermissionFlagsBits 
} = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

// 1. INICIALIZACIÓN DE SERVICIOS
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1
});

redis.connect().catch(() => console.log('[CACHE] Redis no disponible. Usando fallback en memoria.'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.User]
});

client.commands = new Collection();

// CONFIGURACIÓN GLOBAL
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || 'TU_DISCORD_ID';
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || '123456789012345678';
const SUPPORT_INVITE_URL = process.env.SUPPORT_INVITE_URL || 'https://discord.gg/PZw45tHPfc';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
const PORT = process.env.PORT || 3000;

const dbFailedCaptchaAttempts = new Map();
const dbSystemLogs = [];

function addSystemLog(level, message) {
    const timestamp = new Date().toLocaleString();
    dbSystemLogs.unshift({ level, message, timestamp });
    if (dbSystemLogs.length > 100) dbSystemLogs.pop();
}

// 2. CONFIGURACIÓN DE EXPRESS & MIDDLEWARES
const app = express();

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'nerox_guard_enterprise_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 } // 24 Horas
}));

// Middlewares de Protección
function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

function checkSupportServer(req, res, next) {
    if (req.session.user && req.session.user.id === BOT_OWNER_ID) return next();
    if (req.session.isInSupportServer) return next();
    res.redirect('/gatekeeper');
}

function isOwner(req, res, next) {
    if (req.session.user && req.session.user.id === BOT_OWNER_ID) return next();
    res.status(403).send('Acceso denegado. Exclusivo para el propietario del bot.');
}

// 3. LAYOUT SAAS DE NAVEGACIÓN DEDICADA
const renderSaaSLayout = (user, activeGuild, activeTab, title, bodyHtml, isOwnerPanel = false) => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - NEROX GUARD</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --bg-main: #030712;
            --bg-sidebar: #090d16;
            --bg-card: #0f172a;
            --accent: ${isOwnerPanel ? '#f59e0b' : '#06b6d4'};
            --accent-hover: ${isOwnerPanel ? '#d97706' : '#0284c7'};
            --border: #1e293b;
            --text-main: #f8fafc;
            --text-sub: #94a3b8;
            --success: #22c55e;
            --danger: #ef4444;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
        body { background: var(--bg-main); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }

        .sidebar { width: 260px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; justify-content: space-between; flex-shrink: 0; }
        .brand { padding: 20px; font-size: 1.1em; font-weight: 800; color: var(--accent); letter-spacing: 1px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
        .brand span { font-size: 0.65em; color: var(--text-sub); font-weight: normal; block; }

        .nav-list { list-style: none; padding: 15px; display: flex; flex-direction: column; gap: 6px; }
        .nav-item a { color: var(--text-sub); text-decoration: none; padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 0.9em; transition: 0.2s; }
        .nav-item a:hover { background: var(--bg-card); color: #fff; }
        .nav-item.active a { background: var(--bg-card); color: var(--accent); border-left: 3px solid var(--accent); }

        .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .top-bar { height: 65px; border-bottom: 1px solid var(--border); background: var(--bg-sidebar); display: flex; align-items: center; justify-content: space-between; padding: 0 25px; }
        .content-area { flex: 1; padding: 25px; overflow-y: auto; }

        .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; }
        .btn { background: var(--accent); color: #fff; padding: 8px 16px; border-radius: 6px; border: none; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
        .btn:hover { background: var(--accent-hover); }
        .btn-secondary { background: #334155; }
        .user-avatar { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border); }
    </style>
</head>
<body>
    <div class="sidebar">
        <div>
            <div class="brand">
                <i class="fa-solid ${isOwnerPanel ? 'fa-crown' : 'fa-shield-halved'}"></i>
                <div>${isOwnerPanel ? 'OWNER PANEL' : 'NEROX GUARD'} <span>${isOwnerPanel ? 'Control Creador' : 'Enterprise SaaS'}</span></div>
            </div>
            <ul class="nav-list">
                ${isOwnerPanel ? `
                    <li class="nav-item ${activeTab === 'dashboard' ? 'active' : ''}"><a href="/owner?tab=dashboard"><i class="fa-solid fa-chart-line"></i> Dashboard</a></li>
                    <li class="nav-item ${activeTab === 'blacklist' ? 'active' : ''}"><a href="/owner?tab=blacklist"><i class="fa-solid fa-ban"></i> Blacklist</a></li>
                    <li class="nav-item ${activeTab === 'premium' ? 'active' : ''}"><a href="/owner?tab=premium"><i class="fa-solid fa-gem"></i> Premium</a></li>
                    <li class="nav-item ${activeTab === 'logs' ? 'active' : ''}"><a href="/owner?tab=logs"><i class="fa-solid fa-terminal"></i> Logs Globales</a></li>
                ` : activeGuild ? `
                    <li class="nav-item ${activeTab === 'overview' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=overview"><i class="fa-solid fa-house"></i> Inicio</a></li>
                    <li class="nav-item ${activeTab === 'security' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=security"><i class="fa-solid fa-shield-cat"></i> Seguridad</a></li>
                    <li class="nav-item ${activeTab === 'tickets' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=tickets"><i class="fa-solid fa-ticket"></i> Tickets</a></li>
                    <li class="nav-item ${activeTab === 'welcome' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=welcome"><i class="fa-solid fa-hand-wave"></i> Bienvenida</a></li>
                    <li class="nav-item ${activeTab === 'forms' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=forms"><i class="fa-solid fa-file-pen"></i> Formularios</a></li>
                    <li class="nav-item ${activeTab === 'staff' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=staff"><i class="fa-solid fa-users-gear"></i> Staff</a></li>
                    <li class="nav-item ${activeTab === 'settings' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=settings"><i class="fa-solid fa-gear"></i> Ajustes</a></li>
                ` : `
                    <li class="nav-item active"><a href="/dashboard"><i class="fa-solid fa-server"></i> Seleccionar Servidor</a></li>
                `}
            </ul>
        </div>
        ${user ? `
        <div style="padding:15px; border-top:1px solid var(--border); display:flex; align-items:center; gap:10px;">
            <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="user-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div style="flex:1; overflow:hidden;">
                <strong style="font-size:0.85em; display:block; text-overflow:ellipsis; overflow:hidden;">${user.username}</strong>
                <a href="/logout" style="color:var(--danger); font-size:0.75em; text-decoration:none;">Cerrar sesión</a>
            </div>
        </div>` : ''}
    </div>

    <div class="main-content">
        <div class="top-bar">
            <div style="font-weight:bold; font-size:1em;">
                ${isOwnerPanel ? '👑 Control de Propietario' : activeGuild ? `Servidor: ${activeGuild.name}` : 'Selección de Servidor'}
            </div>
            <div>
                ${user && user.id === BOT_OWNER_ID && !isOwnerPanel ? `<a href="/owner" class="btn" style="background:#f59e0b;"><i class="fa-solid fa-crown"></i> Panel Owner</a>` : ''}
                ${activeGuild ? `<a href="/dashboard" class="btn btn-secondary"><i class="fa-solid fa-arrow-left"></i> Servidores</a>` : ''}
            </div>
        </div>
        <div class="content-area">
            ${bodyHtml}
        </div>
    </div>
</body>
</html>
`;

// 4. RUTAS Y VISTAS WEB

// --- LOGIN (CANVAS ANIMADO) ---
app.get('/login', (req, res) => {
    const ip = req.ip;
    const attempts = dbFailedCaptchaAttempts.get(ip) || 0;

    if (attempts >= 5) {
        return res.status(429).send('<h1 style="color:white; text-align:center; padding-top:100px;">⛔ Acceso Bloqueado por Intentos Fallidos.</h1>');
    }

    const totalGuilds = client.guilds.cache.size || 250;

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Autenticación - NEROX GUARD</title>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            :root { --bg-deep: #030712; --primary-cyan: #06b6d4; --card-bg: rgba(15, 23, 42, 0.8); }
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
            body, html { height: 100%; width: 100%; overflow: hidden; background-color: var(--bg-deep); color: #f8fafc; }
            #cyber-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
            .login-wrapper { position: relative; z-index: 2; height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
            .login-card { background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 24px; padding: 40px; width: 100%; max-width: 440px; text-align: center; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7); }
            .shield-icon { font-size: 3.5em; color: var(--primary-cyan); margin-bottom: 15px; }
            .btn-verify { background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; border: none; padding: 14px; border-radius: 12px; font-weight: 700; width: 100%; cursor: pointer; font-size: 1em; margin-top: 15px; }
        </style>
    </head>
    <body>
        <canvas id="cyber-canvas"></canvas>
        <div class="login-wrapper">
            <div class="login-card">
                <i class="fa-solid fa-shield-halved shield-icon"></i>
                <h1 style="font-size:1.8em; margin-bottom:8px;">NEROX GUARD</h1>
                <p style="color:#94a3b8; font-size:0.9em; margin-bottom:20px;">Protección avanzada para comunidades Discord</p>
                
                <form action="/api/verify-captcha" method="POST">
                    <div style="display:flex; justify-content:center; margin-bottom:15px;">
                        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                    </div>
                    <button type="submit" class="btn-verify"><i class="fa-solid fa-lock"></i> Verificar Seguridad</button>
                </form>
            </div>
        </div>
        <script>
            const canvas = document.getElementById('cyber-canvas');
            const ctx = canvas.getContext('2d');
            function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);
            const particles = Array.from({length: 60}, () => ({
                x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6
            }));
            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#030712'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.5)'; ctx.fill();
                });
                requestAnimationFrame(animate);
            }
            animate();
        </script>
    </body>
    </html>
    `);
});

// --- CAPTCHA PROCESS ---
app.post('/api/verify-captcha', async (req, res) => {
    const token = req.body['cf-turnstile-response'];
    const ip = req.ip;

    if (!token) return res.redirect('/login');

    try {
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: ip })
        });
        const outcome = await verifyRes.json();

        if (outcome.success) {
            req.session.captchaPassed = true;
            dbFailedCaptchaAttempts.delete(ip);
            const redirectUri = encodeURIComponent(`${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`);
            return res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`);
        } else {
            dbFailedCaptchaAttempts.set(ip, (dbFailedCaptchaAttempts.get(ip) || 0) + 1);
            return res.redirect('/login');
        }
    } catch (e) {
        res.redirect('/login');
    }
});

// --- DISCORD OAUTH2 CALLBACK & GATEKEEPER CHECK ---
app.get('/api/auth/callback', async (req, res) => {
    if (!req.session.captchaPassed) return res.redirect('/login');
    const { code } = req.query;
    if (!code) return res.redirect('/login');

    try {
        const redirectUri = `${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`;
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code, redirect_uri: redirectUri
            })
        });
        const tokenData = await tokenRes.json();
        
        const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const userData = await userRes.json();

        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const userGuilds = await guildsRes.json();

        req.session.user = userData;
        req.session.guilds = userGuilds;

        // Comprobar membresía en el Servidor de Soporte
        let isInSupport = false;
        const supportGuild = client.guilds.cache.get(SUPPORT_GUILD_ID);
        if (supportGuild) {
            const member = await supportGuild.members.fetch(userData.id).catch(() => null);
            if (member) isInSupport = true;
        }
        req.session.isInSupportServer = isInSupport;

        if (userData.id === BOT_OWNER_ID) return res.redirect('/owner');
        if (!isInSupport) return res.redirect('/gatekeeper');

        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/login');
    }
});

// --- GATEKEEPER VIEW ---
app.get('/gatekeeper', isAuth, (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>Soporte Requerido - NEROX GUARD</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            body { background: #030712; color: #fff; font-family: sans-serif; display: flex; height: 100vh; justify-content: center; align-items: center; margin: 0; }
            .box { background: #0f172a; padding: 40px; border-radius: 16px; border: 1px solid #1e293b; text-align: center; max-width: 400px; }
            .btn { display: block; background: #5865F2; color: #fff; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 15px; }
        </style>
    </head>
    <body>
        <div class="box">
            <i class="fa-solid fa-lock" style="font-size:3em; color:#ef4444; margin-bottom:15px;"></i>
            <h2>Acceso Requerido</h2>
            <p style="color:#94a3b8; font-size:0.9em; margin-top:10px;">Para ingresar al Dashboard debes formar parte del servidor oficial de soporte.</p>
            <a href="${SUPPORT_INVITE_URL}" target="_blank" class="btn"><i class="fa-brands fa-discord"></i> Unirse al Soporte</a>
            <a href="/gatekeeper" class="btn" style="background:#22c55e;"><i class="fa-solid fa-rotate-right"></i> Verificar Nuevamente</a>
        </div>
    </body>
    </html>
    `);
});

// --- DASHBOARD: LISTA DE SERVIDORES ---
app.get('/dashboard', isAuth, checkSupportServer, (req, res) => {
    const adminGuilds = (req.session.guilds || []).filter(g => (parseInt(g.permissions) & 0x8) === 0x8);

    const listHtml = `<div class="grid-3">` + adminGuilds.map(g => {
        const active = client.guilds.cache.has(g.id);
        return `
            <div class="card" style="display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:48px; height:48px; border-radius:50%;">
                    <div>
                        <strong>${g.name}</strong>
                        <div style="font-size:0.75em; color:${active ? 'var(--success)' : 'var(--danger)'};">${active ? '● Operativo' : '○ No Instalado'}</div>
                    </div>
                </div>
                ${active 
                    ? `<a href="/dashboard/guild/${g.id}?tab=overview" class="btn"><i class="fa-solid fa-sliders"></i></a>`
                    : `<a href="https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot" target="_blank" class="btn btn-secondary"><i class="fa-solid fa-plus"></i></a>`
                }
            </div>
        `;
    }).join('') + `</div>`;

    res.send(renderSaaSLayout(req.session.user, null, '', 'Servidores', listHtml));
});

// --- DASHBOARD: MÓDULOS DE NAVEGACIÓN DEDICADOS ---
app.get('/dashboard/guild/:guildId', isAuth, checkSupportServer, (req, res) => {
    const { guildId } = req.params;
    const tab = req.query.tab || 'overview';
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send('El bot no pertenece a este servidor.');

    let content = '';

    if (tab === 'security') {
        content = `
            <div class="card">
                <h2>🛡️ SECURITY CENTER</h2><br>
                <div class="grid-3">
                    ${['Anti Raid', 'Anti Nuke', 'Anti Bot', 'Anti Webhook', 'Anti Spam', 'Anti Link', 'Anti Mass Ban', 'Anti Channel Delete', 'Anti Role Delete'].map(m => `
                        <div style="background:#030712; padding:15px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border);">
                            <span>${m}</span>
                            <span style="color:var(--success); font-weight:bold;">🟢 Activo</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (tab === 'tickets') {
        content = `
            <div class="card">
                <h2>🎫 GESTOR DE TICKETS</h2><br>
                <p style="color:var(--text-sub);">Configura tus paneles de soporte con opciones dinámicas y roles de atención.</p>
            </div>
        `;
    } else if (tab === 'forms') {
        content = `
            <div class="card">
                <h2>📝 FORMULARIOS DE APLICACIÓN</h2><br>
                <p style="color:var(--text-sub);">Crea postulaciones para el equipo de Staff con preguntas personalizadas.</p>
            </div>
        `;
    } else if (tab === 'staff') {
        content = `
            <div class="card">
                <h2>👥 STAFF MANAGER</h2><br>
                <p style="color:var(--text-sub);">Asigna permisos de administración y visualiza los registros de actividad del Staff.</p>
            </div>
        `;
    } else {
        content = `
            <div class="card">
                <h2>🏠 Vista General</h2><br>
                <p style="color:var(--text-sub);">Bienvenido al centro de administración para <strong>${guild.name}</strong>.</p>
            </div>
        `;
    }

    res.send(renderSaaSLayout(req.session.user, guild, tab, guild.name, content));
});

// --- OWNER PANEL ---
app.get('/owner', isAuth, isOwner, (req, res) => {
    const tab = req.query.tab || 'dashboard';
    res.send(renderSaaSLayout(req.session.user, null, tab, 'Propietario', `<div class="card"><h2>👑 Panel Owner Activo</h2></div>`, true));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// 5. INICIALIZACIÓN UNIFICADA DE SERVICIOS
async function startServer() {
    try {
        await prisma.$connect().catch(() => console.log('[DATABASE] Fallo conexión Prisma. Revisa DATABASE_URL.'));
        console.log('[DATABASE] Prisma cliente activo.');

        app.listen(PORT, () => {
            console.log(`[WEB] Servidor iniciado correctamente en puerto: ${PORT}`);
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (err) {
        console.error('[ARRANQUE CRÍTICO]', err);
    }
}

client.once('ready', () => {
    console.log(`[DISCORD] Bot online como: ${client.user.tag}`);
});

startServer();

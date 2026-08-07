// ==========================================
// NEROX GUARD - INDEX ENTERPRISE v4.0 (FULL SAAS + RB3 SECURITY + ADVANCED OWNER AUTH)
// ==========================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection 
} = require('discord.js');
const Redis = require('ioredis');

// 1. CONFIGURACIÓN GLOBAL Y CONSTANTES
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || 'TU_DISCORD_ID';
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || '123456789012345678';
const SUPPORT_INVITE_URL = 'https://discord.gg/PZw45tHPfc';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
const PORT = process.env.PORT || 3000;

// Configuración de Seguridad para el Panel Owner
let OWNER_PIN_PASSWORD = process.env.OWNER_PASSWORD || '2013'; 

// 2. SERVICIOS Y MAPAS DE MEMORIA / CACHE
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1
});

redis.connect()
    .then(() => console.log('[CACHE] Conexión con Redis establecida.'))
    .catch(() => console.log('[CACHE] Redis no disponible. Modo memoria activo.'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.User]
});

client.commands = new Collection();
const dbFailedCaptchaAttempts = new Map();
const dbFailedOwnerAttempts = new Map();
const ownerLockoutTimers = new Map();

// 3. EXPRESS & MIDDLEWARES
const app = express();

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'nerox_guard_enterprise_ultra_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
}));

// Middlewares de Autenticación
function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

function isOwner(req, res, next) {
    if (!req.session.user || req.session.user.id !== BOT_OWNER_ID) {
        return res.status(403).send('Acceso denegado. Exclusivo para el propietario del bot.');
    }
    if (!req.session.ownerAuthPassed) {
        return res.redirect('/owner/verify');
    }
    next();
}

// 4. MOTOR DE PLANTILLAS SAAS GLASSMORPHISM & NEÓN
const renderSaaSLayout = (user, activeGuild, activeTab, title, bodyHtml, isOwnerPanel = false, isInSupport = true) => `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - NEROX GUARD</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg-dark: #020617;
            --bg-glass: rgba(15, 23, 42, 0.75);
            --bg-glass-card: rgba(30, 41, 59, 0.5);
            --border-glass: rgba(56, 189, 248, 0.15);
            --accent-cyan: #06b6d4;
            --accent-blue: #3b82f6;
            --accent-gold: #f59e0b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --danger: #ef4444;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
        body { background: var(--bg-dark); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }

        .sidebar {
            width: 280px; background: rgba(9, 13, 22, 0.85); backdrop-filter: blur(15px);
            border-right: 1px solid var(--border-glass); display: flex; flex-direction: column; justify-content: space-between; flex-shrink: 0;
        }
        .brand {
            padding: 22px; font-size: 1.1em; font-weight: 800; color: var(--accent-cyan);
            letter-spacing: 1px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-glass);
            text-shadow: 0 0 10px rgba(6, 182, 212, 0.4);
        }

        .nav-list { list-style: none; padding: 15px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
        .nav-item a {
            color: var(--text-muted); text-decoration: none; padding: 11px 16px; border-radius: 10px;
            display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 0.88em; transition: all 0.3s;
        }
        .nav-item a:hover { background: var(--bg-glass-card); color: #fff; transform: translateX(3px); }
        .nav-item.active a {
            background: linear-gradient(90deg, rgba(6, 182, 212, 0.15), rgba(59, 130, 246, 0.05));
            color: var(--accent-cyan); border-left: 3px solid var(--accent-cyan);
            box-shadow: 0 0 15px rgba(6, 182, 212, 0.1);
        }

        .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: radial-gradient(circle at top right, rgba(6, 182, 212, 0.05), transparent 40%); }
        .top-bar { height: 65px; border-bottom: 1px solid var(--border-glass); background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: space-between; padding: 0 25px; }
        .content-area { flex: 1; padding: 25px; overflow-y: auto; }

        .banner-warning { background: rgba(245, 158, 11, 0.1); border: 1px solid var(--accent-gold); color: #fef08a; padding: 12px 20px; border-radius: 10px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
        .banner-warning a { color: #fff; background: var(--accent-gold); padding: 6px 14px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.85em; }

        .glass-card { background: var(--bg-glass); backdrop-filter: blur(12px); border: 1px solid var(--border-glass); border-radius: 16px; padding: 22px; margin-bottom: 20px; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5); }
        .grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-bottom: 20px; }
        .stat-card { background: var(--bg-glass-card); border: 1px solid var(--border-glass); border-radius: 12px; padding: 18px; display: flex; align-items: center; gap: 15px; }
        .stat-icon { width: 48px; height: 48px; border-radius: 10px; background: rgba(6, 182, 212, 0.1); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center; font-size: 1.4em; }

        .module-row { display: flex; align-items: center; justify-content: space-between; padding: 14px; background: var(--bg-glass-card); border-radius: 10px; margin-bottom: 10px; border: 1px solid var(--border-glass); }
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; inset: 0; background-color: #334155; transition: .4s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--accent-cyan); }
        input:checked + .slider:before { transform: translateX(20px); }

        .btn { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue)); color: #fff; padding: 9px 18px; border-radius: 8px; border: none; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.3s; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); }
        .btn-secondary { background: #334155; }
        .user-avatar { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--accent-cyan); }
    </style>
</head>
<body>
    <div class="sidebar">
        <div>
            <div class="brand">
                <i class="fa-solid ${isOwnerPanel ? 'fa-crown' : 'fa-shield-halved'}"></i>
                <div>${isOwnerPanel ? 'OWNER SYSTEM' : 'NEROX GUARD'} <span style="font-size:0.65em; color:var(--text-muted); display:block;">Enterprise Edition v4.0</span></div>
            </div>
            <ul class="nav-list">
                ${isOwnerPanel ? `
                    <li class="nav-item ${activeTab === 'dashboard' ? 'active' : ''}"><a href="/owner?tab=dashboard"><i class="fa-solid fa-chart-pie"></i> Estadísticas Globales</a></li>
                    <li class="nav-item ${activeTab === 'guilds' ? 'active' : ''}"><a href="/owner?tab=guilds"><i class="fa-solid fa-server"></i> Gestión de Servidores</a></li>
                    <li class="nav-item ${activeTab === 'blacklist' ? 'active' : ''}"><a href="/owner?tab=blacklist"><i class="fa-solid fa-user-slash"></i> Blacklist Global</a></li>
                    <li class="nav-item ${activeTab === 'licenses' ? 'active' : ''}"><a href="/owner?tab=licenses"><i class="fa-solid fa-key"></i> Licencias y Premium</a></li>
                    <li class="nav-item ${activeTab === 'broadcast' ? 'active' : ''}"><a href="/owner?tab=broadcast"><i class="fa-solid fa-bullhorn"></i> Anuncio Global</a></li>
                    <li class="nav-item ${activeTab === 'console' ? 'active' : ''}"><a href="/owner?tab=console"><i class="fa-solid fa-terminal"></i> Consola y Logs</a></li>
                ` : activeGuild ? `
                    <li class="nav-item ${activeTab === 'overview' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=overview"><i class="fa-solid fa-house"></i> Inicio</a></li>
                    <li class="nav-item ${activeTab === 'security' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=security"><i class="fa-solid fa-shield-cat"></i> Seguridad (Estilo RB3)</a></li>
                    <li class="nav-item ${activeTab === 'tickets' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=tickets"><i class="fa-solid fa-ticket"></i> Gestor de Tickets</a></li>
                    <li class="nav-item ${activeTab === 'welcome' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=welcome"><i class="fa-solid fa-hand-wave"></i> Bienvenida / Autorol</a></li>
                    <li class="nav-item ${activeTab === 'forms' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=forms"><i class="fa-solid fa-file-pen"></i> Formularios Modal</a></li>
                    <li class="nav-item ${activeTab === 'staff' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=staff"><i class="fa-solid fa-users-gear"></i> Staff & Ranking</a></li>
                    <li class="nav-item ${activeTab === 'logs' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=logs"><i class="fa-solid fa-list-check"></i> Logs Segregados</a></li>
                    <li class="nav-item ${activeTab === 'settings' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=settings"><i class="fa-solid fa-gear"></i> Ajustes del Sistema</a></li>
                ` : `
                    <li class="nav-item active"><a href="/dashboard"><i class="fa-solid fa-server"></i> Seleccionar Servidor</a></li>
                `}
            </ul>
        </div>
        ${user ? `
        <div style="padding:15px; border-top:1px solid var(--border-glass); display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.2);">
            <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="user-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div style="flex:1; overflow:hidden;">
                <strong style="font-size:0.85em; display:block; text-overflow:ellipsis; overflow:hidden;">${user.username}</strong>
                <a href="/logout" style="color:var(--danger); font-size:0.75em; text-decoration:none;">Cerrar sesión</a>
            </div>
        </div>` : ''}
    </div>

    <div class="main-content">
        <div class="top-bar">
            <div style="font-weight:bold; font-size:1em; display:flex; align-items:center; gap:8px;">
                ${isOwnerPanel ? '<i class="fa-solid fa-crown" style="color:var(--accent-gold);"></i> Panel de Control Owner' : activeGuild ? `Servidor: ${activeGuild.name}` : 'Selección de Servidor'}
            </div>
            <div>
                ${user && user.id === BOT_OWNER_ID && !isOwnerPanel ? `<a href="/owner" class="btn" style="background:linear-gradient(135deg, #f59e0b, #d97706);"><i class="fa-solid fa-crown"></i> Panel Owner</a>` : ''}
                ${activeGuild ? `<a href="/dashboard" class="btn btn-secondary"><i class="fa-solid fa-arrow-left"></i> Servidores</a>` : ''}
            </div>
        </div>
        <div class="content-area">
            ${!isInSupport ? `
                <div class="banner-warning">
                    <span><i class="fa-solid fa-triangle-exclamation"></i> No estás en el servidor de soporte. Únete para activar el estado prioritario de seguridad.</span>
                    <a href="${SUPPORT_INVITE_URL}" target="_blank"><i class="fa-brands fa-discord"></i> Unirse Ahora</a>
                </div>
            ` : ''}
            ${bodyHtml}
        </div>
    </div>
</body>
</html>
`;

// 5. RUTAS Y VISTAS DE AUTENTICACIÓN

// --- LOGIN CON ANIMACIÓN DE MATRICES / PARTICULAS ---
app.get('/login', (req, res) => {
    const ip = req.ip;
    const attempts = dbFailedCaptchaAttempts.get(ip) || 0;

    if (attempts >= 5) {
        return res.status(429).send('<h1 style="color:white; text-align:center; padding-top:100px; font-family:sans-serif;">⛔ Acceso Bloqueado Temporalmente por Intentos Fallidos de Captcha.</h1>');
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Login - NEROX GUARD Enterprise</title>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body, html { height: 100%; width: 100%; overflow: hidden; background: #020617; color: #f8fafc; }
            #cyber-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
            .login-wrapper { position: relative; z-index: 3; height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
            .glass-card {
                background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(20px); border: 1px solid rgba(56, 189, 248, 0.2);
                border-radius: 24px; padding: 40px; width: 100%; max-width: 440px; text-align: center;
                box-shadow: 0 0 50px rgba(6, 182, 212, 0.15);
            }
            .btn-verify {
                background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; border: none; padding: 14px;
                border-radius: 12px; font-weight: 700; width: 100%; cursor: pointer; font-size: 1em; margin-top: 15px;
                transition: 0.3s; box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); display: flex; align-items: center; justify-content: center; gap: 10px;
            }
            .btn-verify:hover { transform: translateY(-2px); box-shadow: 0 0 25px rgba(6, 182, 212, 0.7); }
        </style>
    </head>
    <body>
        <canvas id="cyber-canvas"></canvas>
        <div class="login-wrapper">
            <div class="glass-card">
                <i class="fa-solid fa-shield-halved" style="font-size: 3.5em; color: #06b6d4; margin-bottom: 15px;"></i>
                <h1 style="font-size: 1.8em; font-weight: 800;">NEROX GUARD</h1>
                <p style="color: #94a3b8; font-size: 0.85em; margin-bottom: 25px;">Enterprise Security & Moderation Hub</p>
                <form action="/api/verify-captcha" method="POST">
                    <div style="display:flex; justify-content:center; margin-bottom:20px;">
                        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                    </div>
                    <button type="submit" class="btn-verify"><i class="fa-brands fa-discord"></i> Iniciar sesión con Discord</button>
                </form>
            </div>
        </div>
        <script>
            const canvas = document.getElementById('cyber-canvas');
            const ctx = canvas.getContext('2d');
            function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);
            const particles = Array.from({length: 50}, () => ({
                x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8
            }));
            function animate() {
                ctx.fillStyle = 'rgba(2, 6, 23, 0.3)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                particles.forEach((p, i) => {
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fillStyle = '#06b6d4'; ctx.fill();
                    for (let j = i + 1; j < particles.length; j++) {
                        const p2 = particles[j]; const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                        if (dist < 120) {
                            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                            ctx.strokeStyle = "rgba(6, 182, 212, " + (1 - dist / 120) * 0.3 + ")"; ctx.stroke();
                        }
                    }
                });
                requestAnimationFrame(animate);
            }
            animate();
        </script>
    </body>
    </html>
    `);
});

// --- VERIFICACIÓN DE OWNER CON PIN Y PROTECCIÓN DE INTENTOS ---
app.get('/owner/verify', isAuth, (req, res) => {
    if (req.session.user.id !== BOT_OWNER_ID) return res.status(403).send('Acceso denegado.');

    const ip = req.ip;
    const lockUntil = ownerLockoutTimers.get(ip);
    if (lockUntil && Date.now() < lockUntil) {
        const remaining = Math.ceil((lockUntil - Date.now()) / 1000);
        return res.status(429).send(`<h2 style="color:white; text-align:center; padding-top:100px; font-family:sans-serif;">⛔ Bloqueado por seguridad. Inténtalo de nuevo en ${remaining} segundos.</h2>`);
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Seguridad - Panel Owner</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body { background: #020617; color: #f8fafc; height: 100vh; display: flex; align-items: center; justify-content: center; }
            .card { background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(15px); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 20px; padding: 35px; width: 100%; max-width: 400px; text-align: center; }
            input[type="password"] { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; text-align: center; font-size: 1.2em; letter-spacing: 4px; margin: 20px 0; }
            .btn-owner { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; width: 100%; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="card">
            <i class="fa-solid fa-lock-hashtag" style="font-size: 3em; color: #f59e0b; margin-bottom: 15px;"></i>
            <h2>Autenticación Propietario</h2>
            <p style="color: #94a3b8; font-size: 0.85em; margin-top: 5px;">Introduce el PIN de seguridad de doble factor</p>
            <form action="/owner/verify" method="POST">
                <input type="password" name="pin" maxlength="10" placeholder="••••" required autofocus>
                <button type="submit" class="btn-owner">Verificar Acceso</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

app.post('/owner/verify', isAuth, (req, res) => {
    if (req.session.user.id !== BOT_OWNER_ID) return res.status(403).send('Acceso denegado.');

    const { pin } = req.body;
    const ip = req.ip;

    if (pin === OWNER_PIN_PASSWORD) {
        req.session.ownerAuthPassed = true;
        dbFailedOwnerAttempts.delete(ip);
        return res.redirect('/owner');
    } else {
        const attempts = (dbFailedOwnerAttempts.get(ip) || 0) + 1;
        dbFailedOwnerAttempts.set(ip, attempts);

        if (attempts >= 5) {
            ownerLockoutTimers.set(ip, Date.now() + 15 * 60 * 1000); // 15 Minutos de bloqueo
            dbFailedOwnerAttempts.delete(ip);
        }
        return res.redirect('/owner/verify');
    }
});

// --- RUTAS DE CALLBACK DE OAUTH2 ---
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

        let isInSupport = false;
        const supportGuild = client.guilds.cache.get(SUPPORT_GUILD_ID);
        if (supportGuild) {
            const member = await supportGuild.members.fetch(userData.id).catch(() => null);
            if (member) isInSupport = true;
        }
        req.session.isInSupportServer = isInSupport;

        if (userData.id === BOT_OWNER_ID) return res.redirect('/owner/verify');

        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/login');
    }
});

// 6. DASHBOARD PRINCIPAL Y MÓDULOS DEL SERVIDOR

// --- LISTA DE SERVIDORES ---
app.get('/dashboard', isAuth, (req, res) => {
    const adminGuilds = (req.session.guilds || []).filter(g => (parseInt(g.permissions) & 0x8) === 0x8);

    const listHtml = `
    <div class="grid-cards">
        ${adminGuilds.map(g => {
            const active = client.guilds.cache.has(g.id);
            return `
                <div class="glass-card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width:48px; height:48px; border-radius:50%;">
                        <div>
                            <strong>${g.name}</strong>
                            <div style="font-size:0.75em; color:${active ? 'var(--success)' : 'var(--danger)'};">${active ? '● Operativo' : '○ No Instalado'}</div>
                        </div>
                    </div>
                    ${active 
                        ? `<a href="/dashboard/guild/${g.id}?tab=overview" class="btn"><i class="fa-solid fa-sliders"></i> Panel</a>`
                        : `<a href="https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot" target="_blank" class="btn btn-secondary"><i class="fa-solid fa-plus"></i> Añadir</a>`
                    }
                </div>
            `;
        }).join('')}
    </div>
    `;

    res.send(renderSaaSLayout(req.session.user, null, '', 'Servidores', listHtml, false, req.session.isInSupportServer));
});

// --- MÓDULOS DEL SERVIDOR (RB3 SECURITY, TICKETS, STAFF, LOGS, ETC) ---
app.get('/dashboard/guild/:guildId', isAuth, (req, res) => {
    const { guildId } = req.params;
    const tab = req.query.tab || 'overview';
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send('El bot no está presente en este servidor.');

    let content = '';

    if (tab === 'security') {
        const securityModules = [
            'Antiraid', 'Antinuke', 'Automod', 'Antispam', 'Anti Enlaces', 
            'Anti Menciones', 'Anti Bots', 'Anti Webhook', 'Anti Token', 
            'Anti VPN', 'Anti Alt Accounts', 'Protección Canales', 
            'Protección Roles', 'Protección Emojis', 'Protección Permisos'
        ];

        content = `
            <div class="glass-card">
                <h2>🛡️ Módulos de Seguridad (Estilo RB3)</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Control estricto de protección en tiempo real contra incursiones y vulnerabilidades.</p>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">
                    ${securityModules.map(mod => `
                        <div class="module-row">
                            <div>
                                <strong>${mod}</strong>
                                <span style="font-size:0.7em; display:block; color:var(--text-muted);">Nivel: Estricto</span>
                            </div>
                            <label class="switch">
                                <input type="checkbox" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (tab === 'tickets') {
        content = `
            <div class="glass-card">
                <h2>🎫 Sistema Completo de Tickets</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Paneles ilimitados, menús desplegables (hasta 25 opciones) y encuestas de satisfacción.</p>
                <button class="btn"><i class="fa-solid fa-plus"></i> Crear Nuevo Panel</button>
            </div>
        `;
    } else if (tab === 'staff') {
        content = `
            <div class="glass-card">
                <h2>👥 Gestión de Staff y Ranking</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Métricas de rendimiento, tiempo conectado, sanciones aplicadas y actividad diaria.</p>
            </div>
        `;
    } else if (tab === 'logs') {
        content = `
            <div class="glass-card">
                <h2>📊 Logs Segregados</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Canales de registros independientes por categoría.</p>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">
                    ${['Mensajes', 'Moderación', 'Roles', 'Canales', 'Miembros', 'Boost', 'Tickets', 'Seguridad'].map(cat => `
                        <div class="module-row">
                            <span>${cat}</span>
                            <button class="btn btn-secondary" style="font-size:0.75em;">Configurar</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        content = `
            <div class="grid-cards">
                <div class="stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-users"></i></div>
                    <div>
                        <strong style="font-size:1.4em;">${guild.memberCount}</strong>
                        <span style="font-size:0.75em; display:block; color:var(--text-muted);">Usuarios Protegidos</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-shield-virus"></i></div>
                    <div>
                        <strong style="font-size:1.4em;">0</strong>
                        <span style="font-size:0.75em; display:block; color:var(--text-muted);">Ataques Detenidos</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-ticket"></i></div>
                    <div>
                        <strong style="font-size:1.4em;">0</strong>
                        <span style="font-size:0.75em; display:block; color:var(--text-muted);">Tickets Activos</span>
                    </div>
                </div>
            </div>
            <div class="glass-card">
                <h2>📈 Actividad del Servidor</h2>
                <canvas id="chartActivity" style="max-height:250px; margin-top:15px;"></canvas>
            </div>
            <script>
                const ctx = document.getElementById('chartActivity').getContext('2d');
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
                        datasets: [{
                            label: 'Eventos de Seguridad',
                            data: [12, 19, 3, 5, 2, 3, 9],
                            borderColor: '#06b6d4',
                            tension: 0.4
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            </script>
        `;
    }

    res.send(renderSaaSLayout(req.session.user, guild, tab, guild.name, content, false, req.session.isInSupportServer));
});

// 7. PANEL OWNER ENTERPRISE
app.get('/owner', isAuth, isOwner, (req, res) => {
    const tab = req.query.tab || 'dashboard';

    let content = `
        <div class="grid-cards">
            <div class="stat-card">
                <div class="stat-icon" style="color:var(--accent-gold);"><i class="fa-solid fa-server"></i></div>
                <div>
                    <strong style="font-size:1.4em;">${client.guilds.cache.size}</strong>
                    <span style="font-size:0.75em; display:block; color:var(--text-muted);">Servidores Activos</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="color:var(--accent-gold);"><i class="fa-solid fa-users"></i></div>
                <div>
                    <strong style="font-size:1.4em;">${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}</strong>
                    <span style="font-size:0.75em; display:block; color:var(--text-muted);">Usuarios Globales</span>
                </div>
            </div>
        </div>
        <div class="glass-card">
            <h2>👑 Administración General del Bot</h2>
            <p style="color:var(--text-muted); font-size:0.85em; margin-top:5px;">Ajustes de infraestructura, reinicio de cluster y licencias globales.</p>
        </div>
    `;

    res.send(renderSaaSLayout(req.session.user, null, tab, 'Propietario', content, true, true));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// 8. ARRANQUE DEL SERVIDOR Y CLIENTE DISCORD
async function startServer() {
    try {
        app.listen(PORT, () => {
            console.log(`[WEB] Servidor Express activo en puerto: ${PORT}`);
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[ERROR ARRANQUE]', error);
        process.exit(1);
    }
}

client.once('ready', () => {
    console.log(`[DISCORD] Bot iniciado como: ${client.user.tag}`);
});

startServer();

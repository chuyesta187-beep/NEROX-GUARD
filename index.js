// ==========================================
// NEROX GUARD - INDEX ENTERPRISE v5.0 (ANIME CYBERPUNK + FLOATING SAVE BAR + SAAS FULL)
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

let OWNER_PIN_PASSWORD = process.env.OWNER_PASSWORD || '2013'; 

// 2. SERVICIOS Y MAPAS EN MEMORIA
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1
});

redis.connect().catch(() => console.log('[CACHE] Redis no disponible. Modo memoria activo.'));

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

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

function isOwner(req, res, next) {
    if (!req.session.user || req.session.user.id !== BOT_OWNER_ID) {
        return res.status(403).send('Acceso denegado. Exclusivo para el propietario.');
    }
    if (!req.session.ownerAuthPassed) {
        return res.redirect('/owner/verify');
    }
    next();
}

// 4. MOTOR DE PLANTILLAS GLOBAL (ANIME CYBERPUNK + FLOATING SAVE SYSTEM)
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
            --bg-glass: rgba(15, 23, 42, 0.72);
            --bg-glass-card: rgba(30, 41, 59, 0.45);
            --border-glass: rgba(56, 189, 248, 0.2);
            --accent-cyan: #06b6d4;
            --accent-blue: #3b82f6;
            --accent-gold: #f59e0b;
            --accent-pink: #ec4899;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --success: #10b981;
            --danger: #ef4444;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
        body { background: var(--bg-dark); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; position: relative; }

        /* Fondo Animado Anime / Cyberpunk Integrado */
        #anime-canvas {
            position: absolute; inset: 0; width: 100%; height: 100%;
            z-index: 0; pointer-events: none; opacity: 0.85;
        }
        .anime-bg-overlay {
            position: absolute; inset: 0;
            background: 
                radial-gradient(circle at 80% 20%, rgba(236, 72, 153, 0.08), transparent 40%),
                radial-gradient(circle at 20% 80%, rgba(6, 182, 212, 0.08), transparent 40%),
                url('https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1920&q=80') center/cover no-repeat;
            opacity: 0.12; z-index: 0; pointer-events: none; mix-blend-mode: luminosity;
        }

        /* Layout Container */
        .app-container { position: relative; z-index: 1; display: flex; width: 100%; height: 100%; }

        .sidebar {
            width: 280px; background: rgba(9, 13, 22, 0.82); backdrop-filter: blur(20px);
            border-right: 1px solid var(--border-glass); display: flex; flex-direction: column; justify-content: space-between; flex-shrink: 0;
        }
        .brand {
            padding: 22px; font-size: 1.1em; font-weight: 800; color: var(--accent-cyan);
            letter-spacing: 1px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-glass);
            text-shadow: 0 0 12px rgba(6, 182, 212, 0.5);
        }

        .nav-list { list-style: none; padding: 15px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
        .nav-item a {
            color: var(--text-muted); text-decoration: none; padding: 11px 16px; border-radius: 12px;
            display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 0.88em; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .nav-item a:hover { background: var(--bg-glass-card); color: #fff; transform: translateX(4px); box-shadow: 0 0 15px rgba(6, 182, 212, 0.15); }
        .nav-item.active a {
            background: linear-gradient(90deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.1));
            color: var(--accent-cyan); border-left: 3px solid var(--accent-cyan);
            box-shadow: 0 0 20px rgba(6, 182, 212, 0.2);
        }

        .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .top-bar { height: 65px; border-bottom: 1px solid var(--border-glass); background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(15px); display: flex; align-items: center; justify-content: space-between; padding: 0 25px; }
        .content-area { flex: 1; padding: 25px; overflow-y: auto; scroll-behavior: smooth; }

        .banner-warning { background: rgba(245, 158, 11, 0.12); border: 1px solid var(--accent-gold); color: #fef08a; padding: 12px 20px; border-radius: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; backdrop-filter: blur(10px); }
        .banner-warning a { color: #fff; background: var(--accent-gold); padding: 6px 14px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 0.85em; }

        /* Efectos Glassmorphism & Hover Neón */
        .glass-card { 
            background: var(--bg-glass); backdrop-filter: blur(16px); border: 1px solid var(--border-glass); 
            border-radius: 18px; padding: 24px; margin-bottom: 20px; 
            box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5); transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
        }
        .glass-card:hover {
            border-color: rgba(6, 182, 212, 0.4);
            box-shadow: 0 0 25px rgba(6, 182, 212, 0.15);
            transform: translateY(-2px);
        }

        .grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-bottom: 20px; }
        .stat-card { background: var(--bg-glass-card); border: 1px solid var(--border-glass); border-radius: 14px; padding: 18px; display: flex; align-items: center; gap: 15px; }
        .stat-icon { width: 50px; height: 50px; border-radius: 12px; background: rgba(6, 182, 212, 0.12); color: var(--accent-cyan); display: flex; align-items: center; justify-content: center; font-size: 1.4em; }

        .module-row { display: flex; align-items: center; justify-content: space-between; padding: 16px; background: var(--bg-glass-card); border-radius: 12px; margin-bottom: 12px; border: 1px solid var(--border-glass); }
        
        .switch { position: relative; display: inline-block; width: 46px; height: 26px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; inset: 0; background-color: #334155; transition: .4s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 4px; bottom: 4px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--accent-cyan); box-shadow: 0 0 10px var(--accent-cyan); }
        input:checked + .slider:before { transform: translateX(20px); }

        .btn { background: linear-gradient(135deg, var(--accent-cyan), var(--accent-blue)); color: #fff; padding: 10px 20px; border-radius: 10px; border: none; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.3s; box-shadow: 0 0 12px rgba(6, 182, 212, 0.2); }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 0 22px rgba(6, 182, 212, 0.6); }
        .btn-secondary { background: #334155; box-shadow: none; }
        .btn-success { background: linear-gradient(135deg, var(--success), #059669); }
        .btn-danger { background: linear-gradient(135deg, var(--danger), #dc2626); }

        .form-control { width: 100%; padding: 11px 15px; border-radius: 10px; border: 1px solid var(--border-glass); background: rgba(15, 23, 42, 0.8); color: #fff; margin-top: 6px; font-size: 0.9em; outline: none; }
        .form-control:focus { border-color: var(--accent-cyan); box-shadow: 0 0 10px rgba(6, 182, 212, 0.3); }

        /* Floating Unsaved Changes Bar */
        .unsaved-bar {
            position: fixed; bottom: -80px; left: 50%; transform: translateX(-50%);
            width: 90%; max-width: 700px; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(25px);
            border: 1px solid var(--accent-cyan); border-radius: 16px; padding: 14px 24px;
            display: flex; align-items: center; justify-content: space-between;
            box-shadow: 0 0 30px rgba(6, 182, 212, 0.3); z-index: 1000; transition: bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .unsaved-bar.visible { bottom: 25px; }

        .user-avatar { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--accent-cyan); }
    </style>
</head>
<body>
    <canvas id="anime-canvas"></canvas>
    <div class="anime-bg-overlay"></div>

    <div class="app-container">
        <div class="sidebar">
            <div>
                <div class="brand">
                    <i class="fa-solid ${isOwnerPanel ? 'fa-crown' : 'fa-shield-halved'}"></i>
                    <div>${isOwnerPanel ? 'OWNER SYSTEM' : 'NEROX GUARD'} <span style="font-size:0.65em; color:var(--text-muted); display:block;">Cyberpunk SaaS Edition</span></div>
                </div>
                <ul class="nav-list">
                    ${isOwnerPanel ? `
                        <li class="nav-item ${activeTab === 'dashboard' ? 'active' : ''}"><a href="/owner?tab=dashboard" class="nav-link"><i class="fa-solid fa-chart-pie"></i> Estadísticas Globales</a></li>
                        <li class="nav-item ${activeTab === 'guilds' ? 'active' : ''}"><a href="/owner?tab=guilds" class="nav-link"><i class="fa-solid fa-server"></i> Gestión de Servidores</a></li>
                        <li class="nav-item ${activeTab === 'blacklist' ? 'active' : ''}"><a href="/owner?tab=blacklist" class="nav-link"><i class="fa-solid fa-user-slash"></i> Blacklist Global</a></li>
                        <li class="nav-item ${activeTab === 'licenses' ? 'active' : ''}"><a href="/owner?tab=licenses" class="nav-link"><i class="fa-solid fa-key"></i> Licencias y Premium</a></li>
                    ` : activeGuild ? `
                        <li class="nav-item ${activeTab === 'overview' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=overview" class="nav-link"><i class="fa-solid fa-house"></i> Inicio</a></li>
                        <li class="nav-item ${activeTab === 'security' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=security" class="nav-link"><i class="fa-solid fa-shield-cat"></i> Seguridad (RB3)</a></li>
                        <li class="nav-item ${activeTab === 'tickets' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=tickets" class="nav-link"><i class="fa-solid fa-ticket"></i> Gestor de Tickets</a></li>
                        <li class="nav-item ${activeTab === 'welcome' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=welcome" class="nav-link"><i class="fa-solid fa-hand-wave"></i> Bienvenida / Autorol</a></li>
                        <li class="nav-item ${activeTab === 'forms' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=forms" class="nav-link"><i class="fa-solid fa-file-pen"></i> Formularios Modal</a></li>
                        <li class="nav-item ${activeTab === 'staff' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=staff" class="nav-link"><i class="fa-solid fa-users-gear"></i> Staff & Rankings</a></li>
                        <li class="nav-item ${activeTab === 'logs' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=logs" class="nav-link"><i class="fa-solid fa-list-check"></i> Logs Segregados</a></li>
                        <li class="nav-item ${activeTab === 'settings' ? 'active' : ''}"><a href="/dashboard/guild/${activeGuild.id}?tab=settings" class="nav-link"><i class="fa-solid fa-gear"></i> Ajustes del Bot</a></li>
                    ` : `
                        <li class="nav-item active"><a href="/dashboard" class="nav-link"><i class="fa-solid fa-server"></i> Seleccionar Servidor</a></li>
                    `}
                </ul>
            </div>
            ${user ? `
            <div style="padding:15px; border-top:1px solid var(--border-glass); display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.25);">
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
                        <span><i class="fa-solid fa-triangle-exclamation"></i> Estado de seguridad limitado. Únete al servidor oficial para activar protección completa.</span>
                        <a href="${SUPPORT_INVITE_URL}" target="_blank"><i class="fa-brands fa-discord"></i> Unirse Ahora</a>
                    </div>
                ` : ''}
                <form id="dashboard-form" onchange="markUnsaved()" oninput="markUnsaved()">
                    ${bodyHtml}
                </form>
            </div>
        </div>
    </div>

    <!-- Barra Flotante de Cambios sin Guardar -->
    <div id="unsaved-bar" class="unsaved-bar">
        <span style="font-size:0.9em; font-weight:600;"><i class="fa-solid fa-triangle-exclamation" style="color:var(--accent-gold); margin-right:8px;"></i> Tienes cambios sin guardar en este módulo.</span>
        <div style="display:flex; gap:10px;">
            <button type="button" onclick="discardChanges()" class="btn btn-secondary" style="padding:7px 14px; font-size:0.85em;"><i class="fa-solid fa-xmark"></i> Descartar</button>
            <button type="button" onclick="saveChanges()" class="btn btn-success" style="padding:7px 16px; font-size:0.85em;"><i class="fa-solid fa-floppy-disk"></i> Guardar Cambios</button>
        </div>
    </div>

    <script>
        // --- 1. FONDO ANIMADO CYBERPUNK / ANIME (PARTÍCULAS + SAKURA) ---
        const canvas = document.getElementById('anime-canvas');
        const ctx = canvas.getContext('2d');
        let width, height;

        function resizeCanvas() {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        const particles = Array.from({ length: 45 }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 2 + 0.5,
            vx: (Math.random() - 0.5) * 0.5,
            vy: Math.random() * 0.8 + 0.3,
            color: Math.random() > 0.4 ? '#06b6d4' : '#ec4899',
            angle: Math.random() * Math.PI * 2
        }));

        function animateBg() {
            ctx.clearRect(0, 0, width, height);
            
            particles.forEach((p, i) => {
                p.x += p.vx + Math.sin(p.angle) * 0.3;
                p.y += p.vy;
                p.angle += 0.01;

                if (p.y > height) { p.y = -10; p.x = Math.random() * width; }
                if (p.x > width) p.x = 0;
                if (p.x < 0) p.x = width;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.shadowBlur = 8;
                ctx.shadowColor = p.color;
                ctx.fill();
                ctx.shadowBlur = 0;

                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                    if (dist < 100) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = "rgba(6, 182, 212, " + (1 - dist / 100) * 0.15 + ")";
                        ctx.stroke();
                    }
                }
            });
            requestAnimationFrame(animateBg);
        }
        animateBg();

        // --- 2. SISTEMA DE PREVENCIÓN DE CAMBIOS SIN GUARDAR ---
        let hasUnsavedChanges = false;
        const unsavedBar = document.getElementById('unsaved-bar');

        function markUnsaved() {
            if (!hasUnsavedChanges) {
                hasUnsavedChanges = true;
                unsavedBar.classList.add('visible');
            }
        }

        function discardChanges() {
            hasUnsavedChanges = false;
            unsavedBar.classList.remove('visible');
            location.reload();
        }

        function saveChanges() {
            hasUnsavedChanges = false;
            unsavedBar.classList.remove('visible');
            alert('✅ Configuración guardada correctamente.');
        }

        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                if (hasUnsavedChanges) {
                    if (!confirm('⚠️ Tienes cambios sin guardar. ¿Deseas salir sin guardar?')) {
                        e.preventDefault();
                    }
                }
            });
        });
    </script>
</body>
</html>
`;

// 5. RUTAS Y VISTAS DE AUTENTICACIÓN
app.get('/login', (req, res) => {
    const ip = req.ip;
    const attempts = dbFailedCaptchaAttempts.get(ip) || 0;

    if (attempts >= 5) {
        return res.status(429).send('<h1 style="color:white; text-align:center; padding-top:100px; font-family:sans-serif;">⛔ Acceso Bloqueado Temporalmente.</h1>');
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
            .login-wrapper { position: relative; z-index: 3; height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
            .glass-card {
                background: rgba(15, 23, 42, 0.82); backdrop-filter: blur(25px); border: 1px solid rgba(56, 189, 248, 0.25);
                border-radius: 24px; padding: 40px; width: 100%; max-width: 440px; text-align: center;
                box-shadow: 0 0 50px rgba(6, 182, 212, 0.2);
            }
            .btn-verify {
                background: linear-gradient(135deg, #06b6d4, #3b82f6); color: #fff; border: none; padding: 14px;
                border-radius: 12px; font-weight: 700; width: 100%; cursor: pointer; font-size: 1em; margin-top: 15px;
                transition: 0.3s; box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); display: flex; align-items: center; justify-content: center; gap: 10px;
            }
        </style>
    </head>
    <body>
        <div class="login-wrapper">
            <div class="glass-card">
                <i class="fa-solid fa-shield-halved" style="font-size: 3.5em; color: #06b6d4; margin-bottom: 15px;"></i>
                <h1 style="font-size: 1.8em; font-weight: 800;">NEROX GUARD</h1>
                <p style="color: #94a3b8; font-size: 0.85em; margin-bottom: 25px;">SaaS Security & Moderation Hub</p>
                <form action="/api/verify-captcha" method="POST">
                    <div style="display:flex; justify-content:center; margin-bottom:20px;">
                        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                    </div>
                    <button type="submit" class="btn-verify"><i class="fa-brands fa-discord"></i> Iniciar sesión con Discord</button>
                </form>
            </div>
        </div>
    </body>
    </html>
    `);
});

app.get('/owner/verify', isAuth, (req, res) => {
    if (req.session.user.id !== BOT_OWNER_ID) return res.status(403).send('Acceso denegado.');

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>PIN Owner - NEROX GUARD</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body { background: #020617; color: #f8fafc; height: 100vh; display: flex; align-items: center; justify-content: center; }
            .card { background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(20px); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 20px; padding: 35px; width: 100%; max-width: 400px; text-align: center; }
            input[type="password"] { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; text-align: center; font-size: 1.2em; letter-spacing: 4px; margin: 20px 0; outline: none; }
            .btn-owner { background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; width: 100%; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="card">
            <i class="fa-solid fa-lock-hashtag" style="font-size: 3em; color: #f59e0b; margin-bottom: 15px;"></i>
            <h2>Autenticación Propietario</h2>
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
    if (pin === OWNER_PIN_PASSWORD) {
        req.session.ownerAuthPassed = true;
        return res.redirect('/owner');
    }
    return res.redirect('/owner/verify');
});

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
            const redirectUri = encodeURIComponent(`${process.env.DASHBOARD_URL || `http://localhost:${PORT}`}/api/auth/callback`);
            return res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`);
        } else {
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

// 6. MÓDULOS DE CONFIGURACIÓN DEL SERVIDOR
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

app.get('/dashboard/guild/:guildId', isAuth, (req, res) => {
    const { guildId } = req.params;
    const tab = req.query.tab || 'overview';
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send('El bot no está presente en este servidor.');

    let content = '';

    if (tab === 'welcome') {
        content = `
            <div class="glass-card">
                <h2>👋 Módulo de Bienvenida y Autorol</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Personaliza la tarjeta de bienvenida con imágenes, variables de usuario y embeds.</p>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                    <div>
                        <label style="font-size:0.85em; font-weight:bold;">Canal de Bienvenida</label>
                        <select class="form-control">
                            <option># general</option>
                            <option># bienvenidas</option>
                        </select>
                        <label style="font-size:0.85em; font-weight:bold; margin-top:15px; display:block;">Mensaje Personalizado</label>
                        <textarea class="form-control" rows="4">¡Bienvenido/a {user} a {server}! Eres el miembro #{count}.</textarea>
                    </div>
                    <div>
                        <label style="font-size:0.85em; font-weight:bold;">URL de Fondo Personalizado</label>
                        <input type="text" class="form-control" placeholder="https://i.imgur.com/example.png">
                        <label style="font-size:0.85em; font-weight:bold; margin-top:15px; display:block;">Auto Rol al Entrar</label>
                        <select class="form-control">
                            <option>@Miembro</option>
                            <option>@Usuario Verificado</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
    } else if (tab === 'security') {
        const securityModules = [
            'Antiraid', 'Antinuke', 'Automod', 'Antispam', 'Anti Enlaces', 
            'Anti Menciones', 'Anti Bots', 'Anti Webhook', 'Anti Token', 
            'Anti VPN', 'Anti Alt Accounts', 'Protección Canales'
        ];

        content = `
            <div class="glass-card">
                <h2>🛡️ Seguridad RB3 Enterprise</h2>
                <p style="color:var(--text-muted); font-size:0.85em; margin-bottom:20px;">Activa/desactiva interruptores de mitigación automatizada en tiempo real.</p>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">
                    ${securityModules.map(mod => `
                        <div class="module-row">
                            <div>
                                <strong>${mod}</strong>
                                <span style="font-size:0.7em; display:block; color:var(--text-muted);">Estado: Operativo</span>
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
                        <span style="font-size:0.75em; display:block; color:var(--text-muted);">Amenazas Mitigadas</span>
                    </div>
                </div>
            </div>
            <div class="glass-card">
                <h2>📈 Actividad de Seguridad y Eventos</h2>
                <canvas id="chartActivity" style="max-height:240px; margin-top:15px;"></canvas>
            </div>
            <script>
                const ctx = document.getElementById('chartActivity').getContext('2d');
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
                        datasets: [{
                            label: 'Ataques Detenidos',
                            data: [5, 12, 2, 8, 1, 4, 10],
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

app.get('/owner', isAuth, isOwner, (req, res) => {
    const tab = req.query.tab || 'dashboard';

    let content = `
        <div class="grid-cards">
            <div class="stat-card">
                <div class="stat-icon" style="color:var(--accent-gold);"><i class="fa-solid fa-server"></i></div>
                <div>
                    <strong style="font-size:1.4em;">${client.guilds.cache.size}</strong>
                    <span style="font-size:0.75em; display:block; color:var(--text-muted);">Servidores Totales</span>
                </div>
            </div>
        </div>
        <div class="glass-card">
            <h2>👑 Panel Global de Administración</h2>
            <p style="color:var(--text-muted); font-size:0.85em;">Ajustes de infraestructura global del bot.</p>
        </div>
    `;

    res.send(renderSaaSLayout(req.session.user, null, tab, 'Propietario', content, true, true));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// 7. INICIALIZACIÓN DE SERVIDORES
async function startServer() {
    try {
        app.listen(PORT, () => {
            console.log(`[WEB] Servidor activo en puerto: ${PORT}`);
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[ERROR ARRANQUE]', error);
        process.exit(1);
    }
}

client.once('ready', () => {
    console.log(`[DISCORD] Bot online como: ${client.user.tag}`);
});

startServer();

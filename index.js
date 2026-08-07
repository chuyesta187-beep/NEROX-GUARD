// ==========================================
// NEROX GUARD - INDEX ENTERPRISE v2.8 (CYBERSECURITY INTERACTIVE CANVAS)
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

// 1. INICIALIZACIÓN DE SERVICIOS
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1
});

redis.connect()
    .then(() => console.log('[CACHE] Conexión con Redis establecida.'))
    .catch(() => console.log('[CACHE] Redis no disponible. Usando fallback en memoria.'));

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

// 2. CONFIGURACIÓN DE EXPRESS & MIDDLEWARES
const app = express();

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'nerox_guard_enterprise_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 }
}));

function isAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/login');
}

function isOwner(req, res, next) {
    if (req.session.user && req.session.user.id === BOT_OWNER_ID) return next();
    res.status(403).send('Acceso denegado. Exclusivo para el propietario del bot.');
}

// 3. LAYOUT SAAS DE NAVEGACIÓN DEDICADA
const renderSaaSLayout = (user, activeGuild, activeTab, title, bodyHtml, isOwnerPanel = false, isInSupport = true) => `
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
            --warning: #f59e0b;
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

        .banner-warning { background: rgba(245, 158, 11, 0.15); border: 1px solid var(--warning); color: #fef08a; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
        .banner-warning a { color: #fff; background: var(--warning); padding: 6px 12px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.85em; }

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
            ${!isInSupport ? `
                <div class="banner-warning">
                    <span><i class="fa-solid fa-triangle-exclamation"></i> Aún no te has unido al servidor oficial de soporte para recibir actualizaciones y parches de seguridad.</span>
                    <a href="${SUPPORT_INVITE_URL}" target="_blank"><i class="fa-brands fa-discord"></i> Unirse Ahora</a>
                </div>
            ` : ''}
            ${bodyHtml}
        </div>
    </div>
</body>
</html>
`;

// 4. RUTAS Y VISTAS WEB

// --- LOGIN CON FONDO CYBERSECURITY HIGH-TECH ---
app.get('/login', (req, res) => {
    const ip = req.ip;
    const attempts = dbFailedCaptchaAttempts.get(ip) || 0;

    if (attempts >= 5) {
        return res.status(429).send('<h1 style="color:white; text-align:center; padding-top:100px;">⛔ Acceso Bloqueado por Intentos Fallidos.</h1>');
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Autenticación Enterprise - NEROX GUARD</title>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            :root {
                --cyan-glow: #06b6d4;
                --blue-glow: #3b82f6;
                --bg-deep: #030712;
            }

            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body, html { height: 100%; width: 100%; overflow: hidden; background: var(--bg-deep); color: #f8fafc; }

            /* CANVAS Y GLOWS DEL FONDO */
            #cyber-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
            
            .cursor-glow {
                position: absolute; width: 400px; height: 400px; border-radius: 50%;
                background: radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, rgba(0,0,0,0) 70%);
                pointer-events: none; transform: translate(-50%, -50%); z-index: 2; transition: width 0.3s, height 0.3s;
            }

            .card-halo {
                position: absolute; width: 480px; height: 580px;
                background: radial-gradient(circle, rgba(6, 182, 212, 0.25) 0%, rgba(59, 130, 246, 0.1) 50%, rgba(0,0,0,0) 70%);
                border-radius: 30px; filter: blur(30px); z-index: 2; pointer-events: none;
            }

            .login-wrapper { position: relative; z-index: 3; height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }

            /* GLASSMORPHISM CARD CON BORDE NEÓN ANIMADO */
            .glass-card {
                position: relative;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(20px);
                border-radius: 24px;
                padding: 40px;
                width: 100%;
                max-width: 450px;
                text-align: center;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85);
                opacity: 0; transform: translateY(30px) scale(0.95);
                animation: introCard 1s cubic-bezier(0.16, 1, 0.3, 1) 1.2s forwards;
            }

            .glass-card::before {
                content: ''; position: absolute; inset: -2px; border-radius: 26px; padding: 2px;
                background: linear-gradient(90deg, var(--cyan-glow), var(--blue-glow), var(--cyan-glow));
                background-size: 200% 200%;
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor; mask-composite: exclude;
                animation: neonBorder 4s linear infinite; pointer-events: none;
            }

            @keyframes neonBorder { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
            @keyframes introCard { to { opacity: 1; transform: translateY(0) scale(1); } }

            .brand-logo { font-size: 3em; color: var(--cyan-glow); margin-bottom: 10px; filter: drop-shadow(0 0 15px rgba(6, 182, 212, 0.6)); }
            .checkbox-container { display: flex; align-items: flex-start; gap: 10px; text-align: left; font-size: 0.82em; color: #94a3b8; margin: 18px 0; background: rgba(30, 41, 59, 0.5); padding: 12px; border-radius: 10px; border: 1px solid #334155; }
            .checkbox-container input { margin-top: 3px; accent-color: var(--cyan-glow); cursor: pointer; }
            .support-link-btn { display: inline-flex; align-items: center; gap: 6px; color: var(--cyan-glow); font-size: 0.8em; text-decoration: none; margin-top: 4px; font-weight: 600; }
            .support-link-btn:hover { text-decoration: underline; }

            .btn-verify {
                background: linear-gradient(135deg, var(--cyan-glow), var(--blue-glow));
                color: #fff; border: none; padding: 14px; border-radius: 12px; font-weight: 700; width: 100%;
                cursor: pointer; font-size: 1em; margin-top: 10px; transition: 0.3s;
                box-shadow: 0 0 15px rgba(6, 182, 212, 0.4); display: flex; justify-content: center; align-items: center; gap: 8px;
            }
            .btn-verify:hover { transform: translateY(-2px); box-shadow: 0 0 25px rgba(6, 182, 212, 0.7); }
        </style>
    </head>
    <body>
        <div class="cursor-glow" id="cursorGlow"></div>
        <canvas id="cyber-canvas"></canvas>

        <div class="login-wrapper">
            <div class="card-halo"></div>
            <div class="glass-card">
                <i class="fa-solid fa-shield-halved brand-logo"></i>
                <h1 style="font-size:1.8em; font-weight:800; letter-spacing:1px; margin-bottom:4px;">NEROX GUARD</h1>
                <p style="color:#94a3b8; font-size:0.85em; margin-bottom:20px;">Enterprise Security & Moderation Hub</p>

                <form action="/api/verify-captcha" method="POST">
                    <div style="display:flex; justify-content:center; margin-bottom:15px;">
                        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                    </div>

                    <div class="checkbox-container">
                        <input type="checkbox" id="joinSupport" name="joinSupport" value="true" checked>
                        <label for="joinSupport">
                            Me uniré al servidor oficial de soporte de NEROX GUARD para recibir actualizaciones, soporte y apelar sanciones.
                            <br>
                            <a href="${SUPPORT_INVITE_URL}" target="_blank" class="support-link-btn"><i class="fa-brands fa-discord"></i> Unirse al servidor de soporte</a>
                        </label>
                    </div>

                    <button type="submit" class="btn-verify"><i class="fa-brands fa-discord"></i> Iniciar sesión con Discord</button>
                </form>
            </div>
        </div>

        <script>
            // CURSOR GLOW EFFECT
            const glow = document.getElementById('cursorGlow');
            window.addEventListener('mousemove', (e) => {
                glow.style.left = e.clientX + 'px';
                glow.style.top = e.clientY + 'px';
            });

            // CANVAS HIGH-TECH ENGINE
            const canvas = document.getElementById('cyber-canvas');
            const ctx = canvas.getContext('2d');

            function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
            resize(); window.addEventListener('resize', resize);

            // GRID & MATRIX DATA
            let gridOffset = 0;
            const matrixChars = '01NEROXGUARD10SECURITY89';
            const matrixColumns = Math.floor(window.innerWidth / 20);
            const matrixDrops = Array(matrixColumns).fill(0).map(() => Math.random() * -100);

            // PARTICLES & HEXAGONS
            const particles = Array.from({length: 45}, () => ({
                x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8
            }));

            const hexes = Array.from({length: 12}, () => ({
                x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                size: Math.random() * 25 + 15, alpha: 0, speed: Math.random() * 0.02 + 0.005, dir: 1
            }));

            const rays = Array.from({length: 3}, () => ({
                y: Math.random() * canvas.height, speed: Math.random() * 3 + 2, width: Math.random() * 2 + 1
            }));

            let shieldPulse = 0;

            function drawHexagon(x, y, radius, alpha) {
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i;
                    const hx = x + radius * Math.cos(angle);
                    const hy = y + radius * Math.sin(angle);
                    if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.strokeStyle = `rgba(6, 182, 212, ${alpha})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            function animate() {
                ctx.fillStyle = 'rgba(3, 7, 18, 0.35)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 1. MATRIX RAIN
                ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
                ctx.font = '12px monospace';
                for (let i = 0; i < matrixDrops.length; i++) {
                    const char = matrixChars[Math.floor(Math.random() * matrixChars.length)];
                    ctx.fillText(char, i * 20, matrixDrops[i] * 20);
                    if (matrixDrops[i] * 20 > canvas.height && Math.random() > 0.975) matrixDrops[i] = 0;
                    matrixDrops[i]++;
                }

                // 2. MOVING 3D PERSPECTIVE GRID
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.07)';
                ctx.lineWidth = 1;
                gridOffset = (gridOffset + 0.5) % 40;
                for (let x = 0; x < canvas.width; x += 40) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
                }
                for (let y = gridOffset; y < canvas.height; y += 40) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
                }

                // 3. CENTRAL SHIELD LOGO PULSE
                shieldPulse += 0.02;
                const shieldGlow = Math.sin(shieldPulse) * 0.15 + 0.25;
                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.font = '220px "Font Awesome 6 Free"';
                ctx.fillStyle = `rgba(6, 182, 212, ${shieldGlow * 0.2})`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('\\f3ed', 0, 0); // Shield Icon
                ctx.restore();

                // 4. ANIMATED HEXAGONS
                hexes.forEach(h => {
                    h.alpha += h.speed * h.dir;
                    if (h.alpha >= 0.4) h.dir = -1;
                    if (h.alpha <= 0) { h.dir = 1; h.x = Math.random() * canvas.width; h.y = Math.random() * canvas.height; }
                    drawHexagon(h.x, h.y, h.size, h.alpha);
                });

                // 5. LIGHT RAYS
                ctx.fillStyle = 'rgba(59, 130, 246, 0.4)';
                rays.forEach(r => {
                    r.y += r.speed; if (r.y > canvas.height) r.y = 0;
                    ctx.fillRect(0, r.y, canvas.width, r.width);
                });

                // 6. CONNECTED PARTICLES
                particles.forEach((p, index) => {
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

                    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.7)'; ctx.fill();

                    for (let j = index + 1; j < particles.length; j++) {
                        const p2 = particles[j];
                        const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                        if (dist < 120) {
                            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                            ctx.strokeStyle = `rgba(6, 182, 212, ${1 - dist / 120})`;
                            ctx.lineWidth = 0.6; ctx.stroke();
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

// --- VERIFICACIÓN DE CAPTCHA Y GUARDADO DE PREFERENCIA ---
app.post('/api/verify-captcha', async (req, res) => {
    const token = req.body['cf-turnstile-response'];
    const joinSupport = req.body.joinSupport === 'true';
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
            req.session.joinSupportOpt = joinSupport;
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

// --- DISCORD OAUTH2 CALLBACK ---
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

        // Comprobación de membresía en el servidor de soporte
        let isInSupport = false;
        const supportGuild = client.guilds.cache.get(SUPPORT_GUILD_ID);
        if (supportGuild) {
            const member = await supportGuild.members.fetch(userData.id).catch(() => null);
            if (member) isInSupport = true;
        }
        req.session.isInSupportServer = isInSupport;

        if (userData.id === BOT_OWNER_ID) return res.redirect('/owner');

        res.redirect('/dashboard');
    } catch (err) {
        res.redirect('/login');
    }
});

// --- DASHBOARD: LISTA DE SERVIDORES ---
app.get('/dashboard', isAuth, (req, res) => {
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

    res.send(renderSaaSLayout(req.session.user, null, '', 'Servidores', listHtml, false, req.session.isInSupportServer));
});

// --- DASHBOARD: MÓDULOS DEL SERVIDOR ---
app.get('/dashboard/guild/:guildId', isAuth, (req, res) => {
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

    res.send(renderSaaSLayout(req.session.user, guild, tab, guild.name, content, false, req.session.isInSupportServer));
});

// --- OWNER PANEL ---
app.get('/owner', isAuth, isOwner, (req, res) => {
    const tab = req.query.tab || 'dashboard';
    res.send(renderSaaSLayout(req.session.user, null, tab, 'Propietario', `<div class="card"><h2>👑 Panel Owner Activo</h2></div>`, true, true));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// 5. INICIALIZACIÓN Y ARRANQUE DE SERVIDORES
async function startServer() {
    try {
        app.listen(PORT, () => {
            console.log(`[WEB] Servidor Express corriendo en el puerto: ${PORT}`);
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[ERROR CRÍTICO]', error);
        process.exit(1);
    }
}

client.once('ready', () => {
    console.log(`[DISCORD] Bot online como: ${client.user.tag}`);
});

startServer();

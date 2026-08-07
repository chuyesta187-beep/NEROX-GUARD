// ==========================================
// NEROX GUARD - INDEX COMPLETO INTEGRADO
// ==========================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

// 1. INICIALIZACIÓN DE SERVICIOS
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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
const dbFailedCaptchaAttempts = new Map();

// 2. CONFIGURACIÓN DE EXPRESS & PASSPORT
const app = express();
const PORT = process.env.PORT || 3000;
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'nerox_guard_secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 86400000 } // 24 Horas
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

// Middlewares de autenticación
function checkCaptchaVerified(req, res, next) {
    if (req.session.captchaVerified) return next();
    res.redirect('/login');
}

function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

// 3. RUTAS Y VISTAS WEB

// --- VISTA /LOGIN CON CANVASCYBER ANIMADO ---
app.get('/login', (req, res) => {
    const ip = req.ip;
    const attempts = dbFailedCaptchaAttempts.get(ip) || 0;

    if (attempts >= 5) {
        return res.status(429).send(`
            <div style="background:#030712; color:#ef4444; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:'Segoe UI', sans-serif;">
                <h1 style="font-size:2.5em; font-weight:800; letter-spacing:1px;">⛔ ACCESO BLOQUEADO</h1>
                <p style="color:#94a3b8; margin-top:10px;">Demasiados intentos fallidos de verificación desde tu dirección IP. Intenta de nuevo más tarde.</p>
            </div>
        `);
    }

    const totalGuilds = client.guilds.cache.size || 250;

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Autenticación de Seguridad - NEROX GUARD</title>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            :root {
                --bg-deep: #030712;
                --primary-cyan: #06b6d4;
                --primary-blue: #3b82f6;
                --accent-glow: rgba(6, 182, 212, 0.4);
                --card-bg: rgba(15, 23, 42, 0.75);
                --border-color: rgba(56, 189, 248, 0.2);
            }

            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
            
            body, html {
                height: 100%;
                width: 100%;
                overflow: hidden;
                background-color: var(--bg-deep);
                color: #f8fafc;
            }

            #cyber-canvas {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 1;
            }

            .login-wrapper {
                position: relative;
                z-index: 2;
                height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }

            .login-card {
                background: var(--card-bg);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid var(--border-color);
                border-radius: 24px;
                padding: 40px;
                width: 100%;
                max-width: 460px;
                text-align: center;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(6, 182, 212, 0.15);
                position: relative;
                overflow: hidden;
            }

            .login-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 2px;
                background: linear-gradient(90deg, transparent, var(--primary-cyan), transparent);
                animation: scanline 4s linear infinite;
            }

            @keyframes scanline {
                0% { left: -100%; }
                100% { left: 100%; }
            }

            .shield-container {
                position: relative;
                width: 80px;
                height: 80px;
                margin: 0 auto 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle, rgba(6,182,212,0.2) 0%, rgba(0,0,0,0) 70%);
            }

            .shield-icon {
                font-size: 3.5em;
                background: linear-gradient(135deg, #38bdf8, #06b6d4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                filter: drop-shadow(0 0 12px var(--accent-glow));
                animation: pulseGlow 3s ease-in-out infinite alternate;
            }

            @keyframes pulseGlow {
                0% { filter: drop-shadow(0 0 8px rgba(6, 182, 212, 0.3)); transform: scale(1); }
                100% { filter: drop-shadow(0 0 20px rgba(56, 189, 248, 0.8)); transform: scale(1.05); }
            }

            .title {
                font-size: 1.8em;
                font-weight: 800;
                letter-spacing: 1.5px;
                background: linear-gradient(135deg, #ffffff, #94a3b8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 6px;
            }

            .subtitle {
                color: #94a3b8;
                font-size: 0.88em;
                margin-bottom: 25px;
                line-height: 1.4;
            }

            .captcha-container {
                display: flex;
                justify-content: center;
                margin-bottom: 20px;
                min-height: 65px;
            }

            .btn-verify {
                background: linear-gradient(135deg, #06b6d4, #3b82f6);
                color: #ffffff;
                border: none;
                padding: 14px 24px;
                border-radius: 12px;
                font-weight: 700;
                width: 100%;
                cursor: pointer;
                font-size: 1em;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                box-shadow: 0 4px 15px rgba(6, 182, 212, 0.3);
                transition: all 0.3s ease;
            }

            .btn-verify:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 25px rgba(6, 182, 212, 0.5);
                background: linear-gradient(135deg, #0891b2, #2563eb);
            }

            .status-container {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }

            .status-item {
                background: rgba(30, 41, 59, 0.5);
                padding: 8px 4px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .status-dot {
                display: inline-block;
                width: 7px;
                height: 7px;
                background-color: #22c55e;
                border-radius: 50%;
                box-shadow: 0 0 8px #22c55e;
                margin-right: 4px;
            }

            .status-label {
                font-size: 0.7em;
                color: #64748b;
                display: block;
                margin-bottom: 2px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .status-val {
                font-size: 0.78em;
                font-weight: 700;
                color: #e2e8f0;
            }
        </style>
    </head>
    <body>
        <canvas id="cyber-canvas"></canvas>

        <div class="login-wrapper">
            <div class="login-card">
                <div class="shield-container">
                    <i class="fa-solid fa-shield-halved shield-icon"></i>
                </div>
                
                <h1 class="title">NEROX GUARD</h1>
                <p class="subtitle">Protección avanzada y gestión integral para comunidades de Discord</p>

                <form action="/api/verify-captcha" method="POST">
                    <div class="captcha-container">
                        <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITE_KEY}" data-theme="dark"></div>
                    </div>

                    <button type="submit" class="btn-verify">
                        <i class="fa-solid fa-lock"></i> Verificación de Seguridad
                    </button>
                </form>

                <div class="status-container">
                    <div class="status-item">
                        <span class="status-label">Sistema</span>
                        <div class="status-val"><span class="status-dot"></span>Online</div>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Seguridad</span>
                        <div class="status-val" style="color:#38bdf8;">Shield v2.5</div>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Protegidos</span>
                        <div class="status-val">${totalGuilds}+ Guilds</div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            const canvas = document.getElementById('cyber-canvas');
            const ctx = canvas.getContext('2d');

            function resizeCanvas() {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            const particles = [];
            const particleCount = Math.min(Math.floor(window.innerWidth / 15), 90);

            class Particle {
                constructor() { this.reset(); }
                reset() {
                    this.x = Math.random() * canvas.width;
                    this.y = Math.random() * canvas.height;
                    this.vx = (Math.random() - 0.5) * 0.6;
                    this.vy = (Math.random() - 0.5) * 0.6;
                    this.radius = Math.random() * 1.8 + 1;
                    this.alpha = Math.random() * 0.5 + 0.2;
                }
                update() {
                    this.x += this.vx;
                    this.y += this.vy;
                    if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
                    if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
                }
                draw() {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                    ctx.fillStyle = \`rgba(6, 182, 212, \${this.alpha})\`;
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = '#06b6d4';
                    ctx.fill();
                }
            }

            for (let i = 0; i < particleCount; i++) particles.push(new Particle());

            function connectParticles() {
                for (let a = 0; a < particles.length; a++) {
                    for (let b = a + 1; b < particles.length; b++) {
                        const dx = particles[a].x - particles[b].x;
                        const dy = particles[a].y - particles[b].y;
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        if (dist < 130) {
                            const opacity = (1 - dist / 130) * 0.25;
                            ctx.beginPath();
                            ctx.moveTo(particles[a].x, particles[a].y);
                            ctx.lineTo(particles[b].x, particles[b].y);
                            ctx.strokeStyle = \`rgba(56, 189, 248, \${opacity})\`;
                            ctx.lineWidth = 0.8;
                            ctx.stroke();
                        }
                    }
                }
            }

            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
                gradient.addColorStop(0, '#030712');
                gradient.addColorStop(0.5, '#0b132b');
                gradient.addColorStop(1, '#030712');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                particles.forEach(p => { p.update(); p.draw(); });
                connectParticles();
                requestAnimationFrame(animate);
            }
            animate();
        </script>
    </body>
    </html>
    `);
});

// --- VERIFICACIÓN DE CAPTCHA POST ---
app.post('/api/verify-captcha', async (req, res) => {
    const token = req.body['cf-turnstile-response'];
    const ip = req.ip;

    if (!token) {
        return res.redirect('/login?error=missing_captcha');
    }

    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${encodeURIComponent(TURNSTILE_SECRET_KEY)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(ip)}`
        });

        const data = await response.json();

        if (data.success) {
            req.session.captchaVerified = true;
            dbFailedCaptchaAttempts.delete(ip);
            return res.redirect('/auth/discord');
        } else {
            const current = dbFailedCaptchaAttempts.get(ip) || 0;
            dbFailedCaptchaAttempts.set(ip, current + 1);
            return res.redirect('/login?error=invalid_captcha');
        }
    } catch (err) {
        console.error('Error verificando Turnstile:', err);
        return res.redirect('/login?error=server_error');
    }
});

// --- AUTENTICACIÓN OAUTH2 DISCORD ---
app.get('/auth/discord', checkCaptchaVerified, passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/login?error=auth_failed'
}), (req, res) => {
    res.redirect('/dashboard');
});

// --- DASHBOARD PRINCIPAL ---
app.get('/dashboard', checkAuth, (req, res) => {
    const user = req.user;
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <title>Panel de Control - NEROX GUARD</title>
            <style>
                body { background: #030712; color: #f8fafc; font-family: system-ui, sans-serif; padding: 40px; }
                .card { background: #0f172a; padding: 24px; border-radius: 12px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto; }
                h1 { color: #38bdf8; }
                a { color: #ef4444; text-decoration: none; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Bienvenido, ${user.username}#${user.discriminator || '0'}</h1>
                <p>Sesión verificada de forma segura.</p>
                <p>ID de usuario: <code>${user.id}</code></p>
                <br>
                <a href="/logout">Cerrar Sesión</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        req.session.destroy();
        res.redirect('/login');
    });
});

// 4. EVENTOS DE DISCORD BOT
client.once('ready', () => {
    console.log(`[BOT] NEROX GUARD iniciado correctamente como: ${client.user.tag}`);
    client.user.setActivity('Protegiendo Servidores | /help', { type: 3 });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply({ content: `🏓 Pong! Latencia: ${client.ws.ping}ms`, ephemeral: true });
    }
});

// 5. INICIALIZACIÓN Y ARRANQUE UNIFICADO
async function startServer() {
    try {
        await prisma.$connect();
        console.log('[DATABASE] Conexión con PostgreSQL (Prisma) establecida.');

        redis.on('connect', () => console.log('[CACHE] Conexión con Redis establecida.'));

        app.listen(PORT, () => {
            console.log(`[WEB] Servidor Express corriendo en el puerto: ${PORT}`);
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('[ERROR CRÍTICO] Fallo durante la inicialización:', error);
        process.exit(1);
    }
}

startServer();

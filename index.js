// ==========================================
// NEROX GUARD - COMPLETE DASHBOARD & BOT CORE
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
    PermissionsBitField
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
    DB_PATH: path.join(__dirname, 'database.json')
};

// ==========================================
// 2. PERSISTENCIA EN DISCO (JSON AS SYNC)
// ==========================================
const memoryDB = {
    welcomeConfigs: new Map(),
    goodbyeConfigs: new Map(),
    forms: new Map(),
    formSubmissions: new Map()
};

function loadDatabase() {
    if (fs.existsSync(CONFIG.DB_PATH)) {
        try {
            const raw = fs.readFileSync(CONFIG.DB_PATH, 'utf-8');
            const data = JSON.parse(raw);
            if (data.welcomeConfigs) memoryDB.welcomeConfigs = new Map(data.welcomeConfigs);
            if (data.goodbyeConfigs) memoryDB.goodbyeConfigs = new Map(data.goodbyeConfigs);
            if (data.forms) memoryDB.forms = new Map(data.forms);
            if (data.formSubmissions) memoryDB.formSubmissions = new Map(data.formSubmissions);
            console.log('💾 Base de datos local cargada correctamente desde database.json');
        } catch (err) {
            console.error('❌ Error al leer database.json:', err);
        }
    } else {
        saveDatabase();
    }
}

function saveDatabase() {
    try {
        const data = {
            welcomeConfigs: Array.from(memoryDB.welcomeConfigs.entries()),
            goodbyeConfigs: Array.from(memoryDB.goodbyeConfigs.entries()),
            forms: Array.from(memoryDB.forms.entries()),
            formSubmissions: Array.from(memoryDB.formSubmissions.entries())
        };
        fs.writeFileSync(CONFIG.DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error('❌ Error guardando datos en database.json:', err);
    }
}

loadDatabase();

function getWelcomeConfig(guildId) {
    if (!memoryDB.welcomeConfigs.has(guildId)) {
        memoryDB.welcomeConfigs.set(guildId, {
            enabled: false,
            channelId: null,
            message: "¡Bienvenido {user} a {server}! Nos alegra tenerte aquí.",
            banner: null,
            embedColor: "#06b6d4",
            autoRoleId: null
        });
        saveDatabase();
    }
    return memoryDB.welcomeConfigs.get(guildId);
}

function getGoodbyeConfig(guildId) {
    if (!memoryDB.goodbyeConfigs.has(guildId)) {
        memoryDB.goodbyeConfigs.set(guildId, {
            enabled: false,
            channelId: null,
            message: "{user} ha abandonado el servidor.",
            banner: null,
            embedColor: "#ef4444"
        });
        saveDatabase();
    }
    return memoryDB.goodbyeConfigs.get(guildId);
}

// ==========================================
// 3. INICIALIZACIÓN CLIENTE DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// 4. MOTOR EXPRESS Y AUTENTICACIÓN OAUTH2
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

// Ruta de Login OAuth2 Discord
app.get('/login', (req, res) => {
    const redirectUri = encodeURIComponent(`${CONFIG.DASHBOARD_URL}/api/auth/callback`);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// Callback OAuth2
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

        req.session.user = userData;
        req.session.accessToken = tokenData.access_token;

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error en Callback OAuth2:', err);
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// 5. RUTAS DASHBOARD Y API REST
// ==========================================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>NEROX GUARD</title>
        <style>
            body { background: #020617; color: #fff; font-family: system-ui, sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center; }
            .card { background: #0f172a; border: 1px solid #06b6d4; padding: 40px; border-radius: 12px; text-align: center; }
            a { background: #06b6d4; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🛡️ NEROX GUARD</h1>
            <p style="margin-bottom: 20px; color: #94a3b8;">Sistema de Gestión Enterprise para Discord</p>
            <a href="/login">Acceder con Discord</a>
        </div>
    </body>
    </html>
    `);
});

// VISTA INTERACTIVA DEL DASHBOARD
app.get('/dashboard', isAuth, (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard - NEROX GUARD</title>
        <style>
            :root { --bg: #020617; --card: #0f172a; --border: #1e293b; --accent: #06b6d4; --text: #f8fafc; --muted: #94a3b8; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 20px; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 25px; }
            .btn-logout { background: #ef4444; color: #fff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 0.85em; font-weight: bold; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
            .card { background: var(--card); border: 1px solid var(--border); padding: 20px; border-radius: 10px; }
            .card h3 { color: var(--accent); margin-bottom: 15px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
            label { display: block; font-size: 0.85em; color: var(--muted); margin: 10px 0 4px; }
            input, textarea, select { width: 100%; background: #020617; border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; font-size: 0.9em; }
            button { background: var(--accent); color: #000; font-weight: bold; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; width: 100%; margin-top: 15px; }
            button:hover { opacity: 0.9; }
            .checkbox-group { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
            .checkbox-group input { width: auto; }
        </style>
    </head>
    <body>
        <div class="header">
            <h2>Bienvenido, ${req.session.user.username} 👋</h2>
            <a href="/logout" class="btn-logout">Cerrar Sesión</a>
        </div>

        <div class="card" style="margin-bottom: 20px;">
            <label for="guildId"><strong>ID del Servidor de Discord (Guild ID):</strong></label>
            <input type="text" id="guildId" placeholder="Ejemplo: 123456789012345678">
        </div>

        <div class="grid">
            <!-- MÓDULO BIENVENIDA / DESPEDIDA -->
            <div class="card">
                <h3>👋 Bienvenida y Despedida</h3>
                
                <div class="checkbox-group">
                    <input type="checkbox" id="welcomeEnabled">
                    <label for="welcomeEnabled" style="margin:0;">Activar Bienvenidas</label>
                </div>

                <label>ID Canal Bienvenida</label>
                <input type="text" id="welcomeChannel" placeholder="ID del canal">

                <label>Mensaje Bienvenida</label>
                <textarea id="welcomeMessage" rows="3" placeholder="¡Bienvenido {user} a {server}!"></textarea>

                <label>ID Rol Automático (AutoRole)</label>
                <input type="text" id="autoRoleId" placeholder="ID del rol al entrar">

                <button onclick="saveWelcome()">Guardar Configuración</button>
            </div>

            <!-- MÓDULO FORMULARIOS -->
            <div class="card">
                <h3>📝 Crear Formulario</h3>

                <label>Título del Formulario</label>
                <input type="text" id="formTitle" placeholder="Ej: POSTULACIÓN STAFF">

                <label>Descripción</label>
                <textarea id="formDesc" rows="2" placeholder="Responde las preguntas..."></textarea>

                <label>ID Canal de Envíos/Revisión</label>
                <input type="text" id="formChannel" placeholder="ID del canal de admins">

                <label>Pregunta 1</label>
                <input type="text" id="q1" placeholder="Ej: ¿Edad?">

                <label>Pregunta 2</label>
                <input type="text" id="q2" placeholder="Ej: ¿Por qué quieres el puesto?">

                <button onclick="createForm()">Crear y Publicar Formulario</button>
            </div>
        </div>

        <script>
            async function saveWelcome() {
                const guildId = document.getElementById('guildId').value;
                if (!guildId) return alert('Por favor ingresa un Guild ID válido.');

                const data = {
                    welcome: {
                        enabled: document.getElementById('welcomeEnabled').checked,
                        channelId: document.getElementById('welcomeChannel').value,
                        message: document.getElementById('welcomeMessage').value,
                        autoRoleId: document.getElementById('autoRoleId').value
                    }
                };

                const res = await fetch(\`/api/guilds/\${guildId}/welcome-goodbye\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (res.ok) alert('✅ Configuración de bienvenida guardada correctamente.');
                else alert('❌ Error al guardar la configuración.');
            }

            async function createForm() {
                const guildId = document.getElementById('guildId').value;
                if (!guildId) return alert('Por favor ingresa un Guild ID válido.');

                const formData = {
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
                    body: JSON.stringify(formData)
                });

                const result = await res.json();
                if (result.success) {
                    await fetch(\`/api/guilds/\${guildId}/forms/\${result.form.id}/publish\`, { method: 'POST' });
                    alert('✅ Formulario creado y publicado exitosamente en Discord.');
                } else {
                    alert('❌ Error al crear el formulario.');
                }
            }
        </script>
    </body>
    </html>
    `);
});

// API Bienvenida / Despedida
app.get('/api/guilds/:guildId/welcome-goodbye', isAuth, (req, res) => {
    const { guildId } = req.params;
    res.json({
        welcome: getWelcomeConfig(guildId),
        goodbye: getGoodbyeConfig(guildId)
    });
});

app.post('/api/guilds/:guildId/welcome-goodbye', isAuth, (req, res) => {
    const { guildId } = req.params;
    const { welcome, goodbye } = req.body;

    if (welcome) {
        const curr = getWelcomeConfig(guildId);
        memoryDB.welcomeConfigs.set(guildId, { ...curr, ...welcome });
    }
    if (goodbye) {
        const curr = getGoodbyeConfig(guildId);
        memoryDB.goodbyeConfigs.set(guildId, { ...curr, ...goodbye });
    }

    saveDatabase();
    res.json({ success: true, message: 'Configuraciones guardadas en disco correctamente.' });
});

// API Formularios
app.post('/api/guilds/:guildId/forms', isAuth, (req, res) => {
    const { guildId } = req.params;
    const { title, description, channelId, questions } = req.body;

    if (!title || !channelId || !Array.isArray(questions)) {
        return res.status(400).json({ error: 'Parámetros inválidos' });
    }

    const formId = `form_${Date.now()}`;
    const newForm = {
        id: formId,
        guildId,
        title,
        description: description || '',
        channelId,
        questions: questions.map((q, idx) => ({
            id: q.id || `q_${idx}`,
            label: q.label,
            style: q.style || 'SHORT'
        }))
    };

    memoryDB.forms.set(formId, newForm);
    saveDatabase();
    res.json({ success: true, form: newForm });
});

app.post('/api/guilds/:guildId/forms/:formId/publish', isAuth, async (req, res) => {
    const { guildId, formId } = req.params;
    const form = memoryDB.forms.get(formId);

    if (!form || form.guildId !== guildId) {
        return res.status(404).json({ error: 'Formulario no localizado' });
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(form.channelId);

        const embed = new EmbedBuilder()
            .setTitle(`📋 ${form.title}`)
            .setDescription(`${form.description}\n\n> *Haz clic en el botón inferior para comenzar.*`)
            .setColor('#06b6d4');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_form_${form.id}`)
                .setLabel('📝 Completar formulario')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'No se pudo publicar el formulario en Discord' });
    }
});

// ==========================================
// 6. EVENTOS DE DISCORD BOT
// ==========================================

// Evento Bienvenida + Autorole
client.on('guildMemberAdd', async (member) => {
    const cfg = getWelcomeConfig(member.guild.id);

    if (cfg.autoRoleId) {
        const role = member.guild.roles.cache.get(cfg.autoRoleId);
        if (role) await member.roles.add(role).catch(() => null);
    }

    if (cfg.enabled && cfg.channelId) {
        const channel = member.guild.channels.cache.get(cfg.channelId);
        if (channel) {
            const formatted = cfg.message
                .replace(/{user}/g, `<@${member.id}>`)
                .replace(/{username}/g, member.user.username)
                .replace(/{server}/g, member.guild.name)
                .replace(/{members}/g, member.guild.memberCount.toString());

            const embed = new EmbedBuilder()
                .setTitle(`👋 ¡Bienvenido a ${member.guild.name}!`)
                .setDescription(formatted)
                .setColor(cfg.embedColor || '#06b6d4')
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            if (cfg.banner) embed.setImage(cfg.banner);

            await channel.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => null);
        }
    }
});

// Evento Despedida
client.on('guildMemberRemove', async (member) => {
    const cfg = getGoodbyeConfig(member.guild.id);

    if (cfg.enabled && cfg.channelId) {
        const channel = member.guild.channels.cache.get(cfg.channelId);
        if (channel) {
            const formatted = cfg.message
                .replace(/{user}/g, member.user.tag)
                .replace(/{username}/g, member.user.username)
                .replace(/{server}/g, member.guild.name)
                .replace(/{members}/g, member.guild.memberCount.toString());

            const embed = new EmbedBuilder()
                .setTitle(`😢 Usuario desvinculado`)
                .setDescription(formatted)
                .setColor(cfg.embedColor || '#ef4444')
                .setTimestamp();

            if (cfg.banner) embed.setImage(cfg.banner);

            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    }
});

// Manejador de Interacciones (Modales / Botones)
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('open_form_')) {
        const formId = interaction.customId.replace('open_form_', '');
        const form = memoryDB.forms.get(formId);

        if (!form) return interaction.reply({ content: '❌ Formulario no encontrado.', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId(`submit_form_${form.id}`)
            .setTitle(form.title.substring(0, 45));

        const rows = form.questions.slice(0, 5).map(q => {
            const input = new TextInputBuilder()
                .setCustomId(`q_${q.id}`)
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

        if (!form) return interaction.reply({ content: '❌ Formulario no activo.', ephemeral: true });

        const answers = {};
        form.questions.forEach(q => {
            answers[q.label] = interaction.fields.getTextInputValue(`q_${q.id}`);
        });

        const subId = `sub_${Date.now()}`;
        const submission = {
            id: subId,
            formId: form.id,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            answers,
            status: 'PENDING'
        };

        memoryDB.formSubmissions.set(subId, submission);
        saveDatabase();

        const channel = interaction.guild.channels.cache.get(form.channelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(`📋 Respuesta: ${form.title}`)
                .setDescription(`**Postulante:** <@${interaction.user.id}> (${interaction.user.tag})`)
                .setColor('#f59e0b')
                .setTimestamp();

            Object.entries(answers).forEach(([q, a]) => embed.addFields({ name: `📌 ${q}`, value: a }));

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`form_accept_${subId}`).setLabel('Aceptar').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`form_reject_${subId}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger)
            );

            await channel.send({ embeds: [embed], components: [row] });
        }

        return interaction.reply({ content: '✅ Formulario enviado.', ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('form_accept_') || interaction.customId.startsWith('form_reject_'))) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
        }

        const isAccept = interaction.customId.startsWith('form_accept_');
        const subId = interaction.customId.replace(isAccept ? 'form_accept_' : 'form_reject_', '');
        const sub = memoryDB.formSubmissions.get(subId);

        if (!sub) return interaction.reply({ content: '❌ Registro no localizado.', ephemeral: true });

        sub.status = isAccept ? 'ACCEPTED' : 'REJECTED';
        saveDatabase();

        const oldEmbed = interaction.message.embeds[0];
        const updated = EmbedBuilder.from(oldEmbed)
            .setColor(isAccept ? '#10b981' : '#ef4444')
            .addFields({ name: 'Revisado por', value: `<@${interaction.user.id}> (${isAccept ? 'Aceptado' : 'Rechazado'})` });

        await interaction.update({ embeds: [updated], components: [] });
    }
});

// ==========================================
// 7. ARRANQUE DEL SERVIDOR Y BOT
// ==========================================
app.listen(CONFIG.PORT, () => {
    console.log(`🌐 Dashboard web activo en puerto ${CONFIG.PORT}`);
});

client.once('ready', () => {
    console.log(`🤖 NEROX GUARD activo como ${client.user.tag}`);
});

client.login(CONFIG.BOT_TOKEN);

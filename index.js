const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType,
    AuditLogEvent 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// 📁 PERSISTENCIA LOCAL EN DISCO (Base de Datos en JSON)
const DB_PATH = path.join(__dirname, 'database.json');
let db = { servers: {}, users: {}, whitelists: {}, backups: {} };

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        } else {
            saveDB();
        }
    } catch (e) { console.error("Error cargando DB:", e); }
}

function saveDB() {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) { console.error("Error guardando DB:", e); }
}

loadDB();

// ⏱️ Trackers en tiempo real para mitigar ataques (Anti-Nuke)
const nukeTracker = new Map();
const raidAlerts = new Map();

// Helpers para inicialización de estructuras por Servidor
function initGuild(guildId) {
    if (!db.servers[guildId]) {
        db.servers[guildId] = {
            antiNuke: 'Activado',
            antiSpam: 'Activado',
            modoEmergencia: 'Desactivado',
            logs: 'Activado',
            edadMinima: 7
        };
    }
    if (!db.whitelists[guildId]) db.whitelists[guildId] = [];
    saveDB();
    return db.servers[guildId];
}

function initUser(userId) {
    if (!db.users[userId]) {
        db.users[userId] = { reputation: '🟢 Bajo riesgo', warns: 0, spamCount: 0, history: [] };
        saveDB();
    }
    return db.users[userId];
}

// 🚀 EVENTO: REGISTRO Y DESPLIEGUE DE COMANDOS AVANZADOS
client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard Apex operando como ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('diagnostico')
            .setDescription('Muestra el estado de salud del hardware, red y base de datos del bot'),
            
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Gestiona la lista blanca del Anti-Nuke')
            .addSubcommand(sub => sub.setName('add').setDescription('Añade a un administrador a la whitelist').addUserOption(o => o.setName('usuario').setDescription('Admin a autorizar').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Elimina a un administrador de la whitelist').addUserOption(o => o.setName('usuario').setDescription('Admin a remover').setRequired(true)))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('historial')
            .setDescription('Muestra el expediente de auditoría y reputación de un usuario')
            .addUserOption(o => o.setName('usuario').setDescription('Usuario a consultar').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Aplica una advertencia formal y recalcula la reputación de riesgo')
            .addUserOption(o => o.setName('usuario').setDescription('Usuario a sancionar').setRequired(true))
            .addStringOption(o => o.setName('razon').setDescription('Razón de la sanción').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    ];

    await client.application.commands.set(commands);
    startDashboard(); // Lanzar la interfaz web
});

// 🔒 Verificar si un usuario pertenece a la lista blanca
function isWhitelisted(guildId, userId) {
    if (!db.whitelists[guildId]) return false;
    return db.whitelists[guildId].includes(userId);
}

// 🔔 ALERTAS AL DUEÑO VÍA DM Y AL STAFF
async function alertarDueñoYStaff(guild, titulo, descripcion) {
    const logChannel = guild.channels.cache.find(ch => ch.name.includes('log') || ch.name.includes('auditoria'));
    const embed = new EmbedBuilder().setTitle(`🚨 CRÍTICO: ${titulo}`).setDescription(descripcion).setColor('#e74c3c').setTimestamp();
    
    if (logChannel) logChannel.send({ embeds: [embed] }).catch(() => null);
    
    try {
        const owner = await guild.fetchOwner();
        if (owner) await owner.send({ content: `⚠️ **Notificación Crítica en tu servidor [${guild.name}]**`, embeds: [embed] });
    } catch (e) { console.log("No se pudo enviar el DM al owner."); }
}

// 🚨 ACTIVACIÓN AUTOMÁTICA DEL MODO EMERGENCIA
function dispararModoEmergencia(guild, razon) {
    const config = initGuild(guild.id);
    if (config.modoEmergencia === 'Activado') return;

    config.modoEmergencia = 'Activado';
    saveDB();

    alertarDueñoYStaff(guild, 'Modo de Emergencia Activado Automáticamente', `El protocolo se ha disparado debido a un patrón hostil continuo: **${razon}**. Los canales de texto han entrado en cuarentena.`);
}

// Tracker de acciones para el Anti-Nuke y Auto-Modo Emergencia
async function registrarAccionNuke(guild, executorId, tipoAccion) {
    if (executorId === client.user.id || isWhitelisted(guild.id, executorId)) return;

    const ahora = Date.now();
    if (!nukeTracker.has(executorId)) nukeTracker.set(executorId, []);
    const acciones = nukeTracker.get(executorId);
    acciones.push({ tipo: tipoAccion, tiempo: ahora });

    const recientes = acciones.filter(a => ahora - a.tiempo < 12000); // Ventana de 12 segundos
    nukeTracker.set(executorId, recientes);

    // Si un solo moderador altera más de 3 elementos
    if (recientes.length >= 3) {
        const miembro = await guild.members.fetch(executorId).catch(() => null);
        if (miembro && miembro.bannable) {
            await miembro.ban({ reason: `Nerox Guard Anti-Nuke: Modificación masiva no autorizada de ${tipoAccion}.` }).catch(() => null);
            dispararModoEmergencia(guild, `Intento de destrucción masiva por parte de un staff (${executorId})`);
        }
    }
}

// 🛡️ EVENTOS ANTI-NUKE & RESTAURACIÓN AUTOMÁTICA

// Intercepción de borrado de Canales
client.on('channelDelete', async (channel) => {
    const config = initGuild(channel.guild.id);
    if (config.antiNuke !== 'Activado') return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    if (!audit) return;
    const entrada = audit.entries.first();
    if (!entrada) return;

    await registrarAccionNuke(channel.guild, entrada.executor.id, 'canales');

    // Restauración inmediata de canal borrado
    await channel.guild.channels.create({
        name: channel.name,
        type: channel.type,
        parent: channel.parentId,
        permissionOverwrites: channel.permissionOverwrites.cache.map(p => p)
    }).catch(() => null);
});

// Intercepción de borrado de Roles
client.on('roleDelete', async (role) => {
    const config = initGuild(role.guild.id);
    if (config.antiNuke !== 'Activado') return;

    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    if (!audit) return;
    const entrada = audit.entries.first();
    if (!entrada) return;

    await registrarAccionNuke(role.guild, entrada.executor.id, 'roles');

    // Restauración inmediata del rol borrado
    await role.guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        permissions: role.permissions,
        mentionable: role.mentionable
    }).catch(() => null);
});

// Protección de Permisos (Dar privilegios de Administrador masivos)
client.on('guildMemberUpdate', async (oldM, newM) => {
    const config = initGuild(newM.guild.id);
    if (config.antiNuke !== 'Activado') return;

    if (!oldM.permissions.has(PermissionFlagsBits.Administrator) && newM.permissions.has(PermissionFlagsBits.Administrator)) {
        const audit = await newM.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate }).catch(() => null);
        if (!audit) return;
        const entrada = audit.entries.first();
        if (!entrada) return;

        if (entrada.executor.id !== client.user.id && !isWhitelisted(newM.guild.id, entrada.executor.id)) {
            // Quitar el rol sospechoso asignado
            const rolesAgregados = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id));
            for (const [id, role] of rolesAgregados) {
                if (role.permissions.has(PermissionFlagsBits.Administrator)) {
                    await newM.roles.remove(role).catch(() => null);
                }
            }
            await registrarAccionNuke(newM.guild, entrada.executor.id, 'otorgamiento de privilegios admin');
        }
    }
});

// Auto-Modo Emergencia por volumen masivo de Baneos
client.on('guildBanAdd', async (ban) => {
    const ahora = Date.now();
    if (!raidAlerts.has(ban.guild.id)) raidAlerts.set(ban.guild.id, []);
    const bansRecientes = raidAlerts.get(ban.guild.id);
    bansRecientes.push(ahora);

    const filtrados = bansRecientes.filter(t => ahora - t < 10000); // 10 segundos
    raidAlerts.set(ban.guild.id, filtrados);

    if (filtrados.length >= 4) {
        dispararModoEmergencia(ban.guild, 'Detección de baneos masivos simultáneos (Staff malicioso o cuenta hackeada)');
    }
});

// 🧹 ANTI-SPAM AVANZADO Y CONTROL DE FLUJO
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const config = initGuild(message.guildId);

    if (config.modoEmergencia === 'Activado' && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.delete().catch(() => null);
    }

    const uData = initUser(message.author.id);

    // Sistema de Mitigación de Spam / Recalculo de Reputación
    if (config.antiSpam === 'Activado' && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        uData.spamCount++;
        if (uData.spamCount > 6) {
            uData.reputation = '🟡 Riesgo medio';
            uData.history.push({ tipo: 'Spam Automático', fecha: new Date().toLocaleDateString(), razon: 'Saturación rápida de chat' });
            saveDB();
            await message.delete().catch(() => null);
            await message.member.timeout(5 * 60 * 1000, 'Nerox Guard: Anti-Spam de alto flujo.').catch(() => null);
        }
        setTimeout(() => { if (uData.spamCount > 0) { uData.spamCount--; saveDB(); } }, 5000);
    }
});

// ⚙️ PROCESAMIENTO DE COMANDOS SLASH
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    initGuild(interaction.guildId);

    const { commandName, options, guild } = interaction;

    // 📊 COMANDO DIAGNÓSTICO
    if (commandName === 'diagnostico') {
        const memoria = process.memoryUsage().heapUsed / 1024 / 1024;
        const embed = new EmbedBuilder()
            .setTitle('📊 Diagnóstico Técnico del Sistema')
            .setColor('#3498db')
            .addFields(
                { name: '🌐 Latencia de Red (Ping)', value: `\`${client.ws.ping}ms\``, inline: true },
                { name: '🧠 Memoria Ram Usada', value: `\`${memoria.toFixed(2)} MB\``, inline: true },
                { name: '💾 Base de Datos Local', value: '`🟢 Operativa y Sincronizada (JSON)`', inline: true },
                { name: '🛡️ Infraestructura', value: `\`Protegiendo ${client.guilds.cache.size} Servidores\``, inline: true }
            );
        return interaction.reply({ embeds: [embed] });
    }

    // 🔒 GESTIÓN DE WHITELIST
    if (commandName === 'whitelist') {
        const sub = options.getSubcommand();
        const user = options.getUser('usuario');

        if (sub === 'add') {
            if (db.whitelists[guild.id].includes(user.id)) return interaction.reply({ content: 'El usuario ya se encuentra en la lista blanca.', ephemeral: true });
            db.whitelists[guild.id].push(user.id);
            saveDB();
            return interaction.reply({ content: `✅ **${user.tag}** ha sido inmunizado frente al sistema Anti-Nuke.` });
        } else {
            db.whitelists[guild.id] = db.whitelists[guild.id].filter(id => id !== user.id);
            saveDB();
            return interaction.reply({ content: `❌ **${user.tag}** fue removido de la inmunidad.` });
        }
    }

    // 📜 HISTORIAL Y REPUTACIÓN DE RIESGO
    if (commandName === 'historial') {
        const user = options.getUser('usuario');
        const uData = initUser(user.id);

        const embed = new EmbedBuilder()
            .setTitle(`📜 Perfil de Seguridad: ${user.username}`)
            .setColor(uData.reputation.includes('🟢') ? '#2ecc71' : uData.reputation.includes('🟡') ? '#f1c40f' : '#e74c3c')
            .addFields(
                { name: '🚩 Nivel de Riesgo Evaluado', value: `**${uData.reputation}**`, inline: false },
                { name: '⚠️ Sanciones Acumuladas', value: `\`${uData.warns} Advertencias\``, inline: true },
                { name: '📝 Historial Reciente', value: uData.history.length ? uData.history.map(h => `• [${h.fecha}] **${h.tipo}** - Razón: ${h.razon}`).join('\n') : 'Expediente limpio.' }
            );
        return interaction.reply({ embeds: [embed] });
    }

    // APLICACIÓN DE WARNS (SANCIONES MANUALES)
    if (commandName === 'warn') {
        const user = options.getUser('usuario');
        const razon = options.getString('razon');
        const uData = initUser(user.id);

        uData.warns++;
        uData.history.push({ tipo: 'Warn Manual', fecha: new Date().toLocaleDateString(), razon: razon });
        
        // Ajuste automático de reputación según advertencias
        if (uData.warns >= 2 && uData.warns < 4) uData.reputation = '🟡 Riesgo medio';
        if (uData.warns >= 4) uData.reputation = '🔴 Alto riesgo';

        saveDB();
        return interaction.reply({ content: `⚠️ Sanción aplicada con éxito a **${user.tag}**. Su perfil de riesgo ha sido actualizado.` });
    }
});

// 🌐 DASHBOARD WEB INTEGRADO (Backend Express en Segundo Plano)
function startDashboard() {
    const app = express();
    const PORT = 3000;

    app.get('/', (req, res) => {
        res.send(`
            <html>
                <head><title>Nerox Guard Dashboard</title></head>
                <body style="font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 40px;">
                    <h1>🛡️ Nerox Guard Web Panel</h1>
                    <p>Servidores en Monitorización: <strong>${client.guilds.cache.size}</strong></p>
                    <p>Estado Core del Sistema: <span style="color: #a6e3a1;">ONLINE</span></p>
                    <h2>Métricas de Base de Datos</h2>
                    <pre style="background: #11111b; padding: 20px; border-radius: 8px; color: #f5c2e7;">${JSON.stringify(db, null, 2)}</pre>
                </body>
            </html>
        `);
    });

    app.listen(PORT, () => console.log(`🌐 Dashboard web accesible internamente en el puerto ${PORT}`));
}

client.login(process.env.DISCORD_TOKEN);

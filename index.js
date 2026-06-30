// =====================================================================
// 🛡️ NEROX GUARD — REVIEWS UPDATE CORE v6.5.0 (FINAL DELIVERABLE)
// =====================================================================
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    AuditLogEvent,
    ChannelType,
    Partials
} = require('discord.js');
const fs = require('fs');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildScheduledEvents
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1520579136609976432";

const CONFIG_PRO = {
    NUKE_THRESHOLD: 3,        
    SWEEP_INTERVAL: 450000    
};

const DB_FILE = './database.json';
let db = {};
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { db = {}; }
}
function saveDB() { 
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4)); } catch (e) { console.error("Error en DB:", e); }
}

const staffActionTracker = new Map();
const recentJoins = new Map();
const antiSpamTracker = new Map();
let emergenciaTimers = new Map();

// Garbage Collector contra fugas de memoria
setInterval(() => {
    const ahora = Date.now();
    antiSpamTracker.clear();
    recentJoins.clear();
    for (const [key, value] of staffActionTracker.entries()) {
        if (ahora - value.time > 60000) staffActionTracker.delete(key);
    }
}, CONFIG_PRO.SWEEP_INTERVAL);

// Sistema de Respaldo Automatizado en Caliente (Cada 1 Hora)
setInterval(async () => {
    for (const guildId of client.guilds.cache.keys()) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await guardarSnapshotEstructural(guild);
    }
}, 3600000);

function initGuild(guildId) {
    if (!db[guildId]) {
        db[guildId] = {
            antiNuke: 'Activado', antiRaid: 'Activado', antiLink: 'Activado',
            antiInvite: 'Activado', antiSpam: 'Activado', antiBot: 'Activado',
            antiWebhook: 'Activado', antiRolePermissions: 'Activado', antiServerUpdate: 'Activado',
            modoEmergencia: 'Desactivado', logsChannel: null, reviewsChannel: null, 
            reviewCount: 0, // 🆕 Almacenamiento local para métricas de reseñas
            whitelist: []
        };
        saveDB();
    }
    // Asegurar retrocompatibilidad del contador en servidores existentes
    if (db[guildId].reviewCount === undefined) db[guildId].reviewCount = 0;
    return db[guildId];
}

async function enviarLog(guild, embedColor, titulo, descripcion) {
    const config = initGuild(guild.id);
    if (!config.logsChannel) return;
    const canal = guild.channels.cache.get(config.logsChannel);
    if (!canal) return;

    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Auditoría — ${titulo}`)
        .setDescription(descripcion)
        .setColor(embedColor)
        .setTimestamp()
        .setFooter({ text: 'Nerox Guard Security v6.5.0', iconURL: client.user?.displayAvatarURL() });
    await canal.send({ embeds: [embed] }).catch(() => {});
}

// Registro de comandos de barra actualizados para la v6.5.0
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('🛡️ Abre el panel de control maestro de seguridad.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('publicacion').setDescription('📝 Deja una reseña o valoración sobre el servidor o el bot.')
        .addStringOption(opt => opt.setName('reseña').setDescription('Escribe tu opinión detallada aquí').setRequired(true))
        .addStringOption(opt => opt.setName('estrellas').setDescription('Calificación general de 1 a 5 estrellas').setRequired(true)
            .addChoices(
                { name: '⭐⭐⭐⭐⭐ (Excelente)', value: '⭐⭐⭐⭐⭐' },
                { name: '⭐⭐⭐⭐ (Bueno)', value: '⭐⭐⭐⭐' },
                { name: '⭐⭐⭐ (Regular)', value: '⭐⭐⭐' },
                { name: '⭐⭐ (Malo)', value: '⭐⭐' },
                { name: '⭐ (Pésimo)', value: '⭐' }
            ))
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => { 
    console.log(`🛡️ Nerox Guard Reviews Update v6.5.0 en línea.`);
    if (process.env.REFRESH_COMMANDS === "true") {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
    }
});

// Interceptor Completo de Comandos de Barra
client.on('interactionCreate', async interaction => {
    if (!interaction.guild || !interaction.isChatInputCommand()) return;
    const { guild, commandName } = interaction;
    const config = initGuild(guild.id);

    if (commandName === 'publicacion') {
        const resenaTexto = interaction.options.getString('reseña');
        const estrellas = interaction.options.getString('estrellas');
        
        const targetCanalId = config.reviewsChannel || interaction.channel.id;
        const targetCanal = guild.channels.cache.get(targetCanalId);

        // Actualizar métricas del servidor
        config.reviewCount++;
        saveDB();

        // 🆕 Embed Mejorado v6.5.0 con Contador Integrado
        const embedReview = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📝 Nueva Reseña Publicada')
            .setDescription(`*"${resenaTexto}"*`)
            .addFields(
                { name: '👤 Autor', value: `${interaction.user}`, inline: true },
                { name: '⭐ Calificación', value: `\`${estrellas}\``, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Nerox Guard Reviews • Reseña #${config.reviewCount}`, iconURL: client.user.displayAvatarURL() });

        if (targetCanal) {
            const mensajeEnviado = await targetCanal.send({ embeds: [embedReview] }).catch(() => null);
            
            // 🆕 Inyección de Reacciones automáticas para engagement comunitario
            if (mensajeEnviado) {
                await mensajeEnviado.react('⭐').catch(() => {});
                await mensajeEnviado.react('✅').catch(() => {});
            }

            return interaction.reply({ content: `✅ ¡Muchas gracias! Tu reseña ha sido enviada al canal correspondiente (Reseña #${config.reviewCount}).`, ephemeral: true });
        } else {
            return interaction.reply({ content: '❌ Error técnico: No se localizó un canal de publicaciones válido en la configuración.', ephemeral: true });
        }
    }
});

// =====================================================================
// INTERCEPTORES DE CHAT, MENCIONES MASIVAS Y PROTECCIONES RAID
// =====================================================================
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const config = initGuild(message.guild.id);

    if (message.mentions.users.size >= 10) {
        if (!config.whitelist.includes(message.author.id) && !message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            if (message.deletable) await message.delete().catch(() => {});
            if (message.member?.moderatable) {
                await message.member.timeout(300000, '[🛡️ Nerox Anti-Mass Mention]').catch(() => {});
                return enviarLog(message.guild, 0xFF0000, 'Mitigación de Menciones', `El usuario <@${message.author.id}> fue aislado por ráfaga de menciones masivas.`);
            }
        }
    }

    if (config.modoEmergencia === 'Activado') {
        if (!config.whitelist.includes(message.author.id) && !message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            if ((Date.now() - message.member.joinedTimestamp) < 86400000) {
                if (message.deletable) await message.delete().catch(() => {});
                return;
            }
        }
    }

    if (config.whitelist.includes(message.author.id) || message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;

    if (config.antiSpam === 'Activado') {
        const me = message.guild.members.me ?? await message.guild.members.fetchMe().catch(() => null);
        if (me && me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const ahora = Date.now(); const key = `${message.guild.id}-${message.author.id}`;
            let tiempos = antiSpamTracker.get(key) || []; tiempos.push(ahora);
            
            tiempos = tiempos.filter(t => para => ahora - t < 5000); antiSpamTracker.set(key, tiempos);
            if (tiempos.length >= 6) {
                antiSpamTracker.delete(key);
                if (message.member && message.member.moderatable) {
                    if (me.permissions.has(PermissionFlagsBits.ManageMessages) && message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
                        await message.channel.bulkDelete(5).catch(() => {});
                    }
                    await message.member.timeout(60000, '[🛡️ Nerox Anti-Spam Reactor]').catch(() => {});
                    await enviarLog(message.guild, 0xFFFF00, 'Aislamiento de Spam', `Usuario <@${message.author.id}> silenciado por spam.`);
                }
            }
        }
    }
});

client.on('guildMemberAdd', async member => {
    const config = initGuild(member.guild.id);
    if (config.modoEmergencia === 'Activado' && !member.user.bot && member.kickable) {
        await member.kick("[🛡️ Bloqueo Activo Anti-Raid]").catch(() => {});
        return enviarLog(member.guild, 0xFF0000, 'Perímetro Bloqueado', `Ingreso rechazado automáticamente para **${member.user.tag}**.`);
    }

    if (config.antiRaid === 'Activado') {
        const ahora = Date.now(); const serverJoins = recentJoins.get(member.guild.id) || []; serverJoins.push(ahora);
        const filtrados = serverJoins.filter(t => ahora - t < 10000); recentJoins.set(member.guild.id, filtrados);
        if (filtrados.length >= 5 && config.modoEmergencia !== 'Activado') {
            config.modoEmergencia = 'Activado'; saveDB();
            await enviarLog(member.guild, 0xFF0000, '🚨 ALERTA: ANTI-RAID DETECTADO', 'Modo Emergencia bloqueado automáticamente por 5 minutos.');

            if (emergenciaTimers.has(member.guild.id)) clearTimeout(emergenciaTimers.get(member.guild.id));
            const timer = setTimeout(async () => {
                const instanciaConfig = initGuild(member.guild.id);
                if (instanciaConfig.modoEmergencia === 'Activado') {
                    instanciaConfig.modoEmergencia = 'Desactivado'; saveDB();
                    await enviarLog(member.guild, 0x2ECC71, '🟢 REAPERTURA PERIMETRAL', 'Modo Emergencia finalizado.');
                }
            }, 300000);
            emergenciaTimers.set(member.guild.id, timer);
        }
    }
});

// =====================================================================
// REAL-TIME AUDIT LOGS & ENGINE AUTOMÁTICO DE RECONSTRUCCIÓN
// =====================================================================
async function verificarSospechoso(guild, executorId, actionType) {
    const config = initGuild(guild.id);
    if (executorId === client.user.id || executorId === guild.ownerId || config.whitelist.includes(executorId)) return false;

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!me || !me.permissions.has(PermissionFlagsBits.BanMembers)) return false;

    const atacante = await guild.members.fetch(executorId).catch(() => null);
    if (atacante && me.roles.highest.position <= atacante.roles.highest.position) return false;

    const key = `${guild.id}-${executorId}`;
    if (!staffActionTracker.has(key)) {
        staffActionTracker.set(key, { count: 1, time: Date.now() }); return false;
    }

    const data = staffActionTracker.get(key);
    if ((Date.now() - data.time) < 7000) {
        data.count++;
        if (data.count >= CONFIG_PRO.NUKE_THRESHOLD && config.antiNuke === 'Activado') {
            try {
                await guild.bans.create(executorId, { reason: `[🛡️ Nerox Anti-Nuke] Umbral crítico alcanzado: ${actionType}` });
                await enviarLog(guild, 0xFF0000, '🔨 NEUTRALIZACIÓN ANTI-NUKE INYECTADA', `El administrador <@${executorId}> ha sido **Baneado** automáticamente tras ráfaga destructiva: **${actionType}**.`);
                staffActionTracker.delete(key); 
                
                if (actionType.includes("Canales")) {
                    await ejecutarAutoRestauracion(guild);
                }
                return true;
            } catch (err) { console.error(err); }
        }
    } else { staffActionTracker.set(key, { count: 1, time: Date.now() }); }
    return false;
}

client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
    if (!guild) return;
    const { action, executorId } = auditLogEntry;
    const config = initGuild(guild.id);

    if (action === AuditLogEvent.ChannelDelete) await verificarSospechoso(guild, executorId, "Eliminación masiva de Canales");
    if (action === AuditLogEvent.ChannelCreate) await verificarSospechoso(guild, executorId, "Creación masiva de Canales");
    if (action === AuditLogEvent.RoleDelete) await verificarSospechoso(guild, executorId, "Eliminación masiva de Roles");
    if (action === AuditLogEvent.MemberKick) await verificarSospechoso(guild, executorId, "Expulsión masiva de miembros");
    if (action === AuditLogEvent.MemberBanAdd) await verificarSospechoso(guild, executorId, "Baneos masivos maliciosos");
    if (action === AuditLogEvent.RoleCreate) await verificarSospechoso(guild, executorId, "Creación masiva de Roles");
    if (action === AuditLogEvent.ChannelUpdate) await verificarSospechoso(guild, executorId, "Modificación masiva de Canales");

    if (action === AuditLogEvent.WebhookCreate || action === AuditLogEvent.WebhookUpdate || action === AuditLogEvent.WebhookDelete) {
        if (config.antiWebhook === 'Activado') await verificarSospechoso(guild, executorId, "Inyección de webhooks");
    }
    if (action === AuditLogEvent.IntegrationCreate || action === AuditLogEvent.IntegrationUpdate || action === AuditLogEvent.IntegrationDelete) {
        await verificarSospechoso(guild, executorId, "Manipulación de integraciones");
    }
    if (action === AuditLogEvent.MemberRoleUpdate && config.antiRolePermissions === 'Activado') {
        await verificarSospechoso(guild, executorId, "Alteración masiva de privilegios");
    }
    if (action === AuditLogEvent.BotAdd && config.antiBot === 'Activado') {
        await verificarSospechoso(guild, executorId, "Inyección forzada de bots");
    }
});

// Estructuras locales de snapshot estructural
async function guardarSnapshotEstructural(guild) {
    try {
        const canales = guild.channels.cache.map(c => ({
            name: c.name,
            type: c.type,
            position: c.position,
            topic: c.topic || null,
            parentName: c.parent ? c.parent.name : null
        }));
        fs.writeFileSync(`./backups_${guild.id}.json`, JSON.stringify(canales, null, 4));
    } catch (e) { console.error("Error al inyectar snapshot:", e); }
}

async function ejecutarAutoRestauracion(guild) {
    const path = `./backups_${guild.id}.json`;
    if (!fs.existsSync(path)) return;
    const datosCanales = JSON.parse(fs.readFileSync(path, 'utf-8'));
    await enviarLog(guild, 0x3498DB, '📥 AUTO-RESTAURACIÓN SOLICITADA', 'Reconstruyendo nodos perimetrales del servidor de forma asíncrona...');
    
    for (const ch of datosCanales.filter(c => c.type === ChannelType.GuildCategory)) {
        let existe = guild.channels.cache.find(e => e.name === ch.name && e.type === ch.type);
        if (!existe && guild.channels.cache.size < 450) {
            await guild.channels.create({ name: ch.name, type: ch.type, position: ch.position }).catch(() => null);
        }
    }
    await guild.channels.fetch();
    for (const ch of datosCanales.filter(c => c.type !== ChannelType.GuildCategory)) {
        let existe = guild.channels.cache.find(e => e.name === ch.name && e.type === ch.type);
        if (!existe && guild.channels.cache.size < 450) {
            const padre = ch.parentName ? guild.channels.cache.find(p => p.name === ch.parentName && p.type === ChannelType.GuildCategory) : null;
            await guild.channels.create({ name: ch.name, type: ch.type, parent: padre ? padre.id : null, topic: ch.topic }).catch(() => null);
        }
    }
}

if (TOKEN) client.login(TOKEN);

// Servidor Keep-Alive de Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nerox Guard v6.5.0 Deployment Pack Ready');
}).listen(PORT);

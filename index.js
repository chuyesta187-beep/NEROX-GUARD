const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ActivityType,
    StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const express = require('express'); 
require('dotenv').config();

// 🧪 CAPTURA CENTRAL DE EXCEPCIONES EN PROCESO
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [Unhandled Rejection]:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error('❌ [Uncaught Exception]:', err, 'en:', origin);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent
    ]
});

const CENTRAL_REPORTS_CHANNEL_ID = "1521762536586743868";
const BOT_OWNER_ID = process.env.OWNER_ID || "339462207909265408"; 

if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
if (!fs.existsSync('./server_backups')) fs.mkdirSync('./server_backups');

let db = { configs: {}, whitelists: {}, warns: {}, globalBlacklist: [], reports: {}, appeals: [], maintenance: false };
if (fs.existsSync('./database.json')) {
    try { db = JSON.parse(fs.readFileSync('./database.json', 'utf-8')); } catch (e) { console.error("Error BD:", e); }
}

function saveDB() {
    try { fs.writeFileSync('./database.json', JSON.stringify(db, null, 2)); } catch (e) { console.error("Error al escribir DB:", e); }
}

function checkGuildDB(guildId) {
    let changed = false;
    if (!db.configs[guildId]) {
        db.configs[guildId] = { 
            logsChannel: null, verifyChannel: null, verifyRole: null, lockdown: false, panicMode: false,
            antiWebhook: true, antiSpam: true, antiLink: true, antiAlt: true, antiRaid: true, antiMassMention: true,
            automodWords: [], automodAction: 'timeout' 
        };
        changed = true;
    }
    if (!db.whitelists[guildId]) { db.whitelists[guildId] = []; changed = true; }
    if (!db.warns[guildId]) { db.warns[guildId] = {}; changed = true; }
    if (changed) saveDB();
}

const recentActions = new Map();
const activeCaptchas = new Map(); 

function isUserBotBanned(userId) {
    return db.globalBlacklist.some(entry => entry.id === userId);
}

async function verificarNuke(guild, executorId, actionType) {
    if (executorId === client.user.id || db.whitelists[guild.id]?.includes(executorId) || executorId === guild.ownerId) return false;
    const key = `${guild.id}-${executorId}-${actionType}`;
    const now = Date.now();

    if (!recentActions.has(key)) recentActions.set(key, []);
    const actions = recentActions.get(key);
    actions.push(now);
    const recent = actions.filter(t => now - t < 10000);
    recentActions.set(key, recent);

    if (recent.length > 2) { 
        const member = await guild.members.fetch(executorId).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: `🚨 Nerox Pro Nuke Shield: Mitigación inmediata [${actionType}]` });
            enviarLog(guild, '🚨 PROTOCOLO DE EXTERMINIO', `El miembro del staff <@${executorId}> disparó los límites y fue **BANEADO**.`);
            return true;
        }
    }
    return false;
}

const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Muestra la latencia del bot'),
    new SlashCommandBuilder().setName('help').setDescription('Muestra el índice de comandos del bot'),
    new SlashCommandBuilder().setName('stats').setDescription('Muestra las métricas operativas internas'),
    new SlashCommandBuilder().setName('maintenance').setDescription('Alterna el bloqueo global por desarrollo técnico del bot').addStringOption(o => o.setName('estado').setDescription('on / off').setRequired(true)),
    new SlashCommandBuilder().setName('setlogs').setDescription('Enlaza el flujo de registros de auditoría a un canal').addChannelOption(o => o.setName('canal').setDescription('Canal de destino').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setverify').setDescription('Establece los flujos para el Captcha por ecuaciones').addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)).addRoleOption(o => o.setName('rol').setDescription('Rol verificado').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setup').setDescription('Abre la matriz interactiva de parametrización').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('backup-export').setDescription('Exporta la base de datos de configuración actual en formato JSON').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('whitelist').setDescription('Administra el personal con inmunidad técnica').addUserOption(o => o.setName('user').setDescription('Miembro').setRequired(true)).addStringOption(o => o.setName('accion').setDescription('add o remove').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('warn').setDescription('Aplica un aviso formal a un infractor').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Causa del aviso')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('warns').setDescription('Consulta el historial punitivo de un usuario').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('resetwarns').setDescription('Limpia el historial de infracciones de un ID').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('timeout').setDescription('Aísla a un usuario del chat').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).addIntegerOption(o => o.setName('tiempo').setDescription('Minutos de duración').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('purge').setDescription('Eliminación forzada de logs de texto').addIntegerOption(o => o.setName('cantidad').setDescription('Mensajes').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('lock').setDescription('Cierre manual o preventivo de canales').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('Apertura manual de canales').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Muestra los datos del servidor'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Muestra el perfil de un usuario').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)),
    new SlashCommandBuilder().setName('botinfo').setDescription('Muestra datos técnicos del sistema'),
    new SlashCommandBuilder().setName('report').setDescription('Genera un reporte global contra un sospechoso').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Razón').setRequired(true)),
    new SlashCommandBuilder().setName('report-view').setDescription('Consulta el registro de reportes de un ID').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
    new SlashCommandBuilder().setName('report-clear').setDescription('Limpia todos los reportes acumulados de un usuario').addStringOption(o => o.setName('id').setDescription('ID de usuario').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('botban').setDescription('Baneo global de Nerox Guard').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('motivo').setDescription('Razón').setRequired(true)),
    new SlashCommandBuilder().setName('botunban').setDescription('Remueve el baneo global').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
    new SlashCommandBuilder().setName('botbanlist').setDescription('Visualiza el registro de expulsiones globales'),
    new SlashCommandBuilder().setName('publicacion').setDescription('Envía una notificación a todos los servidores conectados').addStringOption(o => o.setName('mensaje').setDescription('Contenido').setRequired(true)),
    new SlashCommandBuilder().setName('appeal').setDescription('Envía una apelación al Staff central').addStringOption(o => o.setName('argumento').setDescription('Explicación').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Banea a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    
    // ⚔️ INCORPORACIONES TÁCTICAS
    new SlashCommandBuilder().setName('unban').setDescription('🛡️ Revoca el baneo de un ID en el servidor').addStringOption(o => o.setName('id').setDescription('ID de usuario desbaneado').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder().setName('lockall').setDescription('🛡️ Cierre masivo inmediato de todos los canales de texto').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('unlockall').setDescription('🛡️ Reapertura total de todos los canales de texto del servidor').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('slowmode').setDescription('🛡️ Modifica la tasa de refresco (Modo Lento) del canal actual').addIntegerOption(o => o.setName('segundos').setDescription('Tiempo en segundos (0 para deshabilitar)').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('avatar').setDescription('🛡️ Extrae la foto de perfil de un usuario').addUserOption(o => o.setName('usuario').setDescription('Objetivo')),
    new SlashCommandBuilder().setName('roleinfo').setDescription('🛡️ Análisis de metadatos y permisos de un rol').addRoleOption(o => o.setName('rol').setDescription('Rol a inspeccionar').setRequired(true)),
    new SlashCommandBuilder().setName('channelinfo').setDescription('🛡️ Análisis analítico de un canal específico').addChannelOption(o => o.setName('canal').setDescription('Canal a verificar').setRequired(true)),
    new SlashCommandBuilder().setName('serverbackup').setDescription('🛡️ Gestión de copias estructurales del servidor')
        .addSubcommand(sub => sub.setName('create').setDescription('Genera una instantánea de los canales y roles'))
        .addSubcommand(sub => sub.setName('load').setDescription('Restaura la configuración estructural desde el backup local')),
    new SlashCommandBuilder().setName('automod').setDescription('🛡️ Motor perimetral de filtrado de palabras')
        .addStringOption(o => o.setName('accion').setDescription('add / remove / list').setRequired(true))
        .addStringOption(o => o.setName('palabra').setDescription('Término afectado (para add/remove)')),
    new SlashCommandBuilder().setName('antinuke').setDescription('🛡️ Gestión de contención antinuke')
        .addSubcommand(sub => sub.setName('status').setDescription('Visualiza el estado operativo de todos los blindajes activos')),
    new SlashCommandBuilder().setName('panic').setDescription('🚨 PROTOCOLO DE CONSERVACIÓN EXTREMA: Bloquea el servidor de forma inmediata').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

client.once('ready', async () => {
    console.log(`🛡️ BOT INICIADO CON ÉXITO: ${client.user.tag}`);
    client.user.setPresence({ status: 'dnd', activities: [{ name: '/help | Seguridad Máxima 🛡️', type: ActivityType.Watching }] });
    
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try { 
        console.log('🔄 Registrando comandos globales...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); 
        console.log('✅ Comandos cargados correctamente.');
    } catch (e) { 
        console.error('❌ Error al registrar comandos:', e); 
    }
});

client.on('interactionCreate', async interaction => {
    // 🛡️ CONTROL DE CONTINGENCIA GLOBAL TRYCATCH
    try {
        const isCommand = interaction.isCommand() || interaction.isChatInputCommand();
        const commandName = isCommand ? interaction.commandName : null;

        // Corregido: Si no es en un servidor y no es el comando /appeal, rechazar inmediatamente
        if (!interaction.guild) {
            if (isCommand && commandName === 'appeal') {
                // Permitir que continúe el flujo exclusivamente para /appeal en DM
            } else if (isCommand) {
                return interaction.reply({ content: '❌ Los comandos de **Nerox Guard** solo se pueden ejecutar dentro de un servidor.', ephemeral: true });
            } else {
                return; // Ignorar botones o componentes en DM que no correspondan
            }
        }

        const { options, user, guild, channel } = interaction;
        if (guild) checkGuildDB(guild.id);

        if (interaction.isChatInputCommand()) {
            const esEfemeral = ['backup-export', 'setup', 'botbanlist', 'help', 'antinuke', 'roleinfo', 'channelinfo', 'avatar'].includes(commandName);
            await interaction.deferReply({ ephemeral: esEfemeral });

            if (isUserBotBanned(user.id) && commandName !== 'appeal') {
                return interaction.editReply({ content: '❌ **Acceso denegado.** Te encuentras en la Blacklist Global de Nerox Guard.' });
            }
            if (db.maintenance && user.id !== BOT_OWNER_ID) {
                return interaction.editReply({ content: '⚙️ **Modo Mantenimiento Activo.** El bot se está actualizando.' });
            }

            // --- COMANDOS EN RUTAS COMPARTIDAS / DM VALIDADOS ---
            if (commandName === 'appeal') {
                if (!isUserBotBanned(user.id)) return interaction.editReply({ content: '❌ No requerido. No estás baneado de la red global del bot.' });
                const ownerObj = await client.users.fetch(BOT_OWNER_ID).catch(() => null);
                if (ownerObj) ownerObj.send(`📥 **Apelación de ${user.tag}:** *${options.getString('argumento')}*`).catch(() => {});
                return interaction.editReply({ content: '✅ Apelación enviada con éxito al Administrador Central.' });
            }

            // --- COMANDOS RECIÉN IMPLEMENTADOS ---
            if (commandName === 'unban') {
                const userId = options.getString('id');
                await guild.members.unban(userId, `Revocado por ${user.tag}`).then(() => {
                    interaction.editReply({ content: `✅ El baneo para el ID \`${userId}\` fue revocado exitosamente.` });
                    enviarLog(guild, '🔓 Desbaneo Forzado', `**ID afectado:** \`${userId}\`\n**Moderador:** ${user.tag}`);
                }).catch(err => interaction.editReply({ content: '❌ No se pudo procesar el desbaneo. ID inválido o no listado.' }));
                return;
            }

            if (commandName === 'lockall') {
                const canales = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
                for (const [id, chan] of canales) {
                    await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
                }
                enviarLog(guild, '🔒 LOCKDOWN COMPLETO', `Iniciado por el Administrador: ${user.tag}`);
                return interaction.editReply({ content: '🔒 **Lockdown Generalizado:** Todos los canales de texto han sido bloqueados.' });
            }

            if (commandName === 'unlockall') {
                const canales = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
                for (const [id, chan] of canales) {
                    await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true }).catch(() => {});
                }
                enviarLog(guild, '🔓 UNLOCKDOWN COMPLETO', `Iniciado por el Administrador: ${user.tag}`);
                return interaction.editReply({ content: '🔓 **Reapertura Generalizada:** Todos los canales de texto han sido restaurados.' });
            }

            if (commandName === 'slowmode') {
                const segs = options.getInteger('segundos');
                await channel.setRateLimitPerUser(segs, `Configurado por ${user.tag}`);
                return interaction.editReply({ content: `⏳ Modo lento configurado en **${segs}** segundos para este canal.` });
            }

            if (commandName === 'avatar') {
                const tgt = options.getUser('usuario') || user;
                const embed = new EmbedBuilder()
                    .setTitle(`Avatar de ${tgt.tag}`)
                    .setImage(tgt.displayAvatarURL({ dynamic: true, size: 1024 }))
                    .setColor('#2b2d31');
                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'roleinfo') {
                const role = options.getRole('rol');
                const embed = new EmbedBuilder()
                    .setTitle(`Análisis de Rol: ${role.name}`)
                    .setDescription(`• **ID:** \`${role.id}\`\n• **Color (Hex):** \`${role.hexColor}\`\n• **Posición:** \`${role.position}\`\n• **Mencionable:** \`${role.mentionable ? 'Sí' : 'No'}\`\n• **Permisos clave:** \`${role.permissions.has(PermissionFlagsBits.Administrator) ? 'ADMINISTRADOR' : 'Estándar'}\``)
                    .setColor(role.hexColor);
                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'channelinfo') {
                const chan = options.getChannel('canal');
                const embed = new EmbedBuilder()
                    .setTitle(`Análisis de Canal: #${chan.name}`)
                    .setDescription(`• **ID:** \`${chan.id}\`\n• **Tipo:** \`${chan.type}\`\n• **Creado el:** <t:${Math.floor(chan.createdTimestamp / 1000)}:R>`)
                    .setColor('#2b2d31');
                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'serverbackup') {
                const sub = options.getSubcommand();
                const backupPath = `./server_backups/backup-${guild.id}.json`;

                if (sub === 'create') {
                    if (user.id !== guild.ownerId && !db.whitelists[guild.id].includes(user.id)) return interaction.editReply({ content: '❌ Acción restringida a Propietarios / Personal Whitelist.' });
                    
                    const estructura = {
                        roles: guild.roles.cache.map(r => ({ name: r.name, color: r.color, permissions: r.permissions.bitfield.toString(), hoist: r.hoist, mentionable: r.mentionable })),
                        canales: guild.channels.cache.map(c => ({ name: c.name, type: c.type, parentName: c.parent ? c.parent.name : null }))
                    };
                    fs.writeFileSync(backupPath, JSON.stringify(estructura, null, 2));
                    return interaction.editReply({ content: `✅ **Snapshot Estructural Guardado.** Copia local lista en el servidor central de Nerox.` });
                }

                if (sub === 'load') {
                    if (user.id !== guild.ownerId) return interaction.editReply({ content: '❌ **Alerta de Seguridad:** Solo el dueño real de la Guild puede restaurar snapshots estructurales.' });
                    if (!fs.existsSync(backupPath)) return interaction.editReply({ content: '❌ No se encontró ningún backup previo para este servidor.' });

                    interaction.editReply({ content: '⚠️ **Restaurando estructura del servidor...** Creando canales y roles respaldados.' });
                    const rawData = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));

                    for (const r of rawData.roles) {
                        if (r.name !== '@everyone') await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable }).catch(() => {});
                    }
                    for (const c of rawData.canales) {
                        await guild.channels.create({ name: c.name, type: c.type }).catch(() => {});
                    }
                    return channel.send('✅ **Proceso estructural finalizado.**');
                }
            }

            if (commandName === 'automod') {
                const acc = options.getString('accion');
                const word = options.getString('palabra');
                const conf = db.configs[guild.id];

                if (acc === 'add') {
                    if (!word) return interaction.editReply({ content: '❌ Debes especificar la palabra.' });
                    if (!conf.automodWords.includes(word.toLowerCase())) conf.automodWords.push(word.toLowerCase());
                    saveDB();
                    return interaction.editReply({ content: `✅ Añadida **"${word}"** al diccionario de AutoMod.` });
                }
                if (acc === 'remove') {
                    if (!word) return interaction.editReply({ content: '❌ Debes especificar la palabra.' });
                    conf.automodWords = conf.automodWords.filter(w => w !== word.toLowerCase());
                    saveDB();
                    return interaction.editReply({ content: `🗑️ Removida **"${word}"** de la lista de filtrado.` });
                }
                if (acc === 'list') {
                    if (conf.automodWords.length === 0) return interaction.editReply({ content: '🕊️ No hay palabras prohibidas listadas en este servidor.' });
                    return interaction.editReply({ content: `📝 **Palabras bajo monitorización de AutoMod:**\n\`${conf.automodWords.join(', ')}\`` });
                }
            }

            if (commandName === 'antinuke' && options.getSubcommand() === 'status') {
                const conf = db.configs[guild.id];
                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ Estado de Contingencia - Nerox Guard Pro`)
                    .setDescription(`A continuación verás el estado en tiempo real de los módulos perimetrales:`)
                    .addFields([
                        { name: '🛑 Shield Anti-Raid', value: conf.antiRaid ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true },
                        { name: '🖇️ Escáner Anti-Links', value: conf.antiLink ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true },
                        { name: '🤖 Filtro Anti-Alts', value: conf.antiAlt ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true },
                        { name: '⚓ Blindaje Anti-Webhooks', value: conf.antiWebhook ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true },
                        { name: '💬 Anti-Spam Estricto', value: conf.antiSpam ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true },
                        { name: '🔊 Control de Menciones', value: conf.antiMassMention ? '🟢 EN LÍNEA' : '🔴 APAGADO', inline: true }
                    ])
                    .setColor('#2b2d31');
                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'panic') {
                if (user.id !== guild.ownerId && !db.whitelists[guild.id].includes(user.id)) return interaction.editReply({ content: '❌ Acceso denegado. Se requieren credenciales de rango superior.' });
                const conf = db.configs[guild.id];
                
                conf.panicMode = !conf.panicMode;
                conf.lockdown = conf.panicMode;
                saveDB();

                if (conf.panicMode) {
                    const canales = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
                    for (const [id, chan] of canales) {
                        await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
                    }
                    enviarLog(guild, '🚨 EMERGENCY PANIC PROTOCOL', `MODO DE CRISIS GLOBAL ACTIVADO POR <@${user.id}>. El servidor ha sido sellado.`);
                    return interaction.editReply({ content: '🚨 **[PANIC MODE: ACTIVADO]** El servidor ha entrado en aislamiento crítico inmediato. Todos los canales bloqueados y mensajes de no-whitelist serán destruidos.' });
                } else {
                    return interaction.editReply({ content: '🛡️ **Panic Mode Desactivado.** Utiliza `/unlockall` para restaurar los accesos de escritura.' });
                }
            }

            // --- REPERTORIO CLÁSICO ---
            if (commandName === 'ping') return interaction.editReply({ content: `🏓 Latencia Core: **${client.ws.ping}ms**` });
            if (commandName === 'help') {
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Central Operativa - Nerox Guard').setDescription('Utiliza `/setup` para ver los paneles interactivos.\n\n**Comandos de Protección Activa:**\n`/panic` `/antinuke status` `/automod` `/serverbackup` `/lockall` `/unlockall` `/slowmode` `/setlogs` `/setverify` `/whitelist` `/ban` `/unban` `/timeout` `/purge`').setColor('#2b2d31')] });
            }
            if (commandName === 'stats') return interaction.editReply({ content: `📊 **Métricas Avanzadas:**\n• Servidores: \`${client.guilds.cache.size}\` \n• Latencia Core: \`${client.ws.ping}ms\`` });
            
            if (commandName === 'maintenance') {
                if (user.id !== BOT_OWNER_ID) return interaction.editReply({ content: '❌ Restringido al Desarrollador Central.' });
                db.maintenance = (options.getString('estado') === 'on'); saveDB();
                return interaction.editReply({ content: `⚙️ Modo mantenimiento conmutado a: **${db.maintenance ? 'ACTIVADO' : 'DESACTIVADO'}**.` });
            }
            if (commandName === 'backup-export') {
                if (user.id !== guild.ownerId && !db.whitelists[guild.id].includes(user.id)) return interaction.editReply({ content: '❌ No autorizado.' });
                const dataExport = JSON.stringify(db.configs[guild.id] || {}, null, 2);
                const path = `./export-${guild.id}.json`; fs.writeFileSync(path, dataExport);
                await interaction.editReply({ content: '📦 Configuración exportada:', files: [path] });
                return fs.unlinkSync(path);
            }
            if (commandName === 'setlogs') {
                db.configs[guild.id].logsChannel = options.getChannel('canal').id; saveDB();
                return interaction.editReply({ content: `✅ Sistema de logs configurado.` });
            }
            if (commandName === 'setverify') {
                const vChan = options.getChannel('canal'); const vRole = options.getRole('rol');
                db.configs[guild.id].verifyChannel = vChan.id; db.configs[guild.id].verifyRole = vRole.id; saveDB();
                const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('trigger_captcha_process').setLabel('🛡️ Verificar Identidad').setStyle(ButtonStyle.Primary));
                await vChan.send({ embeds: [new EmbedBuilder().setTitle('🔐 Control de Acceso').setDescription('Presiona el botón para resolver el captcha de entrada.').setColor('#2b2d31')], components: [buttonRow] });
                return interaction.editReply({ content: '✅ Sistema de Captcha desplegado.' });
            }
            if (commandName === 'whitelist') {
                const target = options.getUser('user');
                if (options.getString('accion') === 'add') {
                    if (!db.whitelists[guild.id].includes(target.id)) db.whitelists[guild.id].push(target.id);
                } else {
                    db.whitelists[guild.id] = db.whitelists[guild.id].filter(id => id !== target.id);
                }
                saveDB(); return interaction.editReply({ content: `🛡️ Whitelist actualizada para <@${target.id}>.` });
            }
            if (commandName === 'warn') {
                const target = options.getUser('target'); const r = options.getString('razon') || 'Sin especificar';
                if (!db.warns[guild.id][target.id]) db.warns[guild.id][target.id] = [];
                db.warns[guild.id][target.id].push(r); saveDB();
                return interaction.editReply({ content: `⚠️ Warn asignado a <@${target.id}>.` });
            }
            if (commandName === 'warns') {
                const historial = db.warns[guild.id][options.getUser('target').id] || [];
                if (historial.length === 0) return interaction.editReply({ content: '🕊️ Historial limpio.' });
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Warns').setDescription(historial.map((r, i) => `\`${i+1}.\` ${r}`).join('\n')).setColor('#2b2d31')] });
            }
            if (commandName === 'resetwarns') {
                db.warns[guild.id][options.getUser('target').id] = []; saveDB();
                return interaction.editReply({ content: '🗑️ Historial purgado.' });
            }
            if (commandName === 'timeout') {
                const member = await guild.members.fetch(options.getUser('target').id).catch(() => null);
                if (!member) return interaction.editReply({ content: '❌ No encontrado.' });
                await member.timeout(options.getInteger('tiempo') * 60000, `Aislamiento por ${user.tag}`);
                return interaction.editReply({ content: `⏳ El usuario ha sido aislado.` });
            }
            if (commandName === 'purge') {
                const qty = options.getInteger('cantidad'); await channel.bulkDelete(qty, true);
                return interaction.editReply({ content: `🗑️ Mensajes purgados.` });
            }
            if (commandName === 'lock') {
                db.configs[guild.id].lockdown = true; saveDB();
                await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
                return interaction.editReply({ content: '🔒 Canal cerrado.' });
            }
            if (commandName === 'unlock') {
                db.configs[guild.id].lockdown = false; saveDB();
                await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true });
                return interaction.editReply({ content: '🔓 Canal reabierto.' });
            }
            if (commandName === 'serverinfo') return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`${guild.name}`).setDescription(`ID: \`${guild.id}\` | Miembros: **${guild.memberCount}**`).setColor('#2b2d31')] });
            if (commandName === 'userinfo') return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`${options.getUser('target').tag}`).setDescription(`ID: \`${options.getUser('target').id}\``).setColor('#2b2d31')] });
            if (commandName === 'botinfo') return interaction.editReply({ content: `⚙️ **Nerox Guard Core** v14.` });
            
            if (commandName === 'report') {
                const target = options.getUser('usuario'); const reason = options.getString('motivo');
                if (target.id === user.id || target.bot) return interaction.editReply({ content: '❌ Invalido.' });
                if (!db.reports[target.id]) db.reports[target.id] = [];
                db.reports[target.id].push({ reporter: user.tag, reason, date: new Date().toISOString() }); saveDB();
                const acceptDenyRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`report_accept_${target.id}`).setLabel('🔨 Ban Global').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('report_reject_click').setLabel('🗑️ Desestimar').setStyle(ButtonStyle.Secondary)
                );
                const centralChannel = client.channels.cache.get(CENTRAL_REPORTS_CHANNEL_ID);
                if (centralChannel) centralChannel.send({ embeds: [new EmbedBuilder().setTitle('📩 REPORTE GLOBAL').setDescription(`**Sospechoso:** <@${target.id}>\n**Razón:** ${reason}`).setColor('#ff3333')], components: [acceptDenyRow] }).catch(() => {});
                return interaction.editReply({ content: '✅ Reporte enviado a la central.' });
            }
            if (commandName === 'report-view') {
                const historial = db.reports[options.getUser('usuario').id] || [];
                if (historial.length === 0) return interaction.editReply({ content: '🕊️ Sin reportes.' });
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Reportes').setDescription(historial.map((r, i) => `\`${i+1}.\` **${r.reporter}**: ${r.reason}`).join('\n')).setColor('#ffaa00')] });
            }
            if (commandName === 'report-clear') {
                db.reports[options.getString('id')] = []; saveDB(); return interaction.editReply({ content: '✅ Reportes limpiados.' });
            }
            if (commandName === 'botban') {
                if (user.id !== BOT_OWNER_ID) return interaction.editReply({ content: '❌ Restringido.' });
                const target = options.getUser('usuario');
                if (!isUserBotBanned(target.id)) db.globalBlacklist.push({ id: target.id, tag: target.tag, reason: options.getString('motivo') });
                saveDB(); return interaction.editReply({ content: `🔨 **${target.tag}** en Blacklist Global.` });
            }
            if (commandName === 'botunban') {
                if (user.id !== BOT_OWNER_ID) return interaction.editReply({ content: '❌ Restringido.' });
                db.globalBlacklist = db.globalBlacklist.filter(u => u.id !== options.getUser('usuario').id);
                saveDB(); return interaction.editReply({ content: '✅ Restricciones globales removidas.' });
            }
            if (commandName === 'botbanlist') {
                if (db.globalBlacklist.length === 0) return interaction.editReply({ content: '🕊️ Sin vetos activos.' });
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔨 Vetos Globales').setDescription(db.globalBlacklist.map((e, i) => `\`${i+1}.\` **${e.tag}** - *${e.reason}*`).join('\n')).setColor('#2b2d31')] });
            }
            if (commandName === 'publicacion') {
                if (user.id !== BOT_OWNER_ID) return interaction.editReply({ content: '❌ Restringido.' });
                client.guilds.cache.forEach(g => {
                    const c = g.channels.cache.get(db.configs[g.id]?.logsChannel);
                    if (c) c.send({ embeds: [new EmbedBuilder().setTitle('📢 COMUNICADO').setDescription(options.getString('mensaje')).setColor('#00ff55')] }).catch(() => {});
                });
                return interaction.editReply({ content: '✅ Transmisión completada.' });
            }
            if (commandName === 'ban') {
                const member = await guild.members.fetch(options.getUser('target').id).catch(() => null);
                if (member && member.bannable) { await member.ban({ reason: `Por ${user.tag}` }); return interaction.editReply({ content: '🔨 Baneado.' }); }
                return interaction.editReply({ content: '❌ Error de jerarquía.' });
            }
            if (commandName === 'kick') {
                const member = await guild.members.fetch(options.getUser('target').id).catch(() => null);
                if (member && member.kickable) { await member.kick(`Por ${user.tag}`); return interaction.editReply({ content: '👢 Expulsado.' }); }
                return interaction.editReply({ content: '❌ Error.' });
            }
            if (commandName === 'setup') {
                const menuDropdown = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('setup_category_selector').setPlaceholder('Módulo del Sistema').addOptions([{ label: '🛡️ Seguridad', value: 'sc_security' }, { label: '📜 Logs', value: 'sc_logs' }]));
                return interaction.editReply({ content: '⚙️ **Matriz Nerox Guard Pro:**', components: [menuDropdown] });
            }
        }

        // INTERCEPCIÓN DE MENÚS DESPLEGABLES
        if (interaction.isStringSelectMenu() && interaction.customId === 'setup_category_selector') {
            const conf = db.configs[guild.id];
            if (interaction.values[0] === 'sc_security') {
                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tg_antiRaid').setLabel(`Anti-Raid: ${conf.antiRaid ? 'ON' : 'OFF'}`).setStyle(conf.antiRaid ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('tg_antiWebhook').setLabel(`Anti-Webhook: ${conf.antiWebhook ? 'ON' : 'OFF'}`).setStyle(conf.antiWebhook ? ButtonStyle.Success : ButtonStyle.Danger)
                );
                return interaction.reply({ content: '🛡️ **Filtros Antinuke:**', components: [buttons], ephemeral: true });
            }
            if (interaction.values[0] === 'sc_logs') return interaction.reply({ content: `📜 Logs dirigidos a <#${conf.logsChannel || 'No configurado'}>`, ephemeral: true });
        }

        // INTERCEPCIÓN DE BOTONES
        if (interaction.isButton()) {
            const conf = db.configs[guild.id];
            if (interaction.customId.startsWith('tg_')) {
                const prop = interaction.customId.replace('tg_', '');
                if (prop in conf) { conf[prop] = !conf[prop]; saveDB(); return interaction.reply({ content: `Cambiado a **${conf[prop] ? 'ON' : 'OFF'}**`, ephemeral: true }); }
            }
            if (interaction.customId === 'trigger_captcha_process') {
                const n1 = Math.floor(Math.random() * 8) + 2; const n2 = Math.floor(Math.random() * 8) + 2;
                activeCaptchas.set(user.id, n1 + n2);
                
                // Corregido: Array de botones mapeado por separado y estructurado con operador Spread (...)
                const botones = [n1+n2, n1+n2+2, n1+n2-1, n1+n2+3]
                    .sort(() => Math.random() - 0.5)
                    .map(op => new ButtonBuilder()
                        .setCustomId(`ans_captcha_${op}`)
                        .setLabel(`${op}`)
                        .setStyle(ButtonStyle.Secondary)
                    );

                const rRow = new ActionRowBuilder().addComponents(...botones);
                return interaction.reply({ content: `🛡️ **CAPTCHA:** ¿Cuánto es **${n1} + ${n2}**?`, components: [rRow], ephemeral: true });
            }
            if (interaction.customId.startsWith('ans_captcha_')) {
                const res = parseInt(interaction.customId.split('_')[2]);
                if (res === activeCaptchas.get(user.id)) {
                    const rObj = guild.roles.cache.get(conf.verifyRole);
                    if (rObj) { const m = await guild.members.fetch(user.id).catch(() => null); if (m) await m.roles.add(rObj); }
                    return interaction.reply({ content: '✅ Verificado.', ephemeral: true });
                }
                return interaction.reply({ content: '❌ Inválido.', ephemeral: true });
            }
        }

    } catch (err) {
        // 🔥 GESTIÓN CRÍTICA DE ERRORES EN INTERACCIONES
        console.error("🚨 [Error crítico detectado en InteractionCreate]:", err);
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: '❌ Ocurrió un error inesperado al procesar este comando.' }).catch(() => {});
            } else {
                await interaction.reply({ content: '❌ Ocurrió un error interno al ejecutar esta acción.', ephemeral: true }).catch(() => {});
            }
        } catch (subError) {
            console.error("No se pudo notificar el error al usuario:", subError);
        }
    }
});

// EVENTOS INTERNOS (ANTINUKE / AUTOMOD / PANIC)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const conf = db.configs[message.guild.id];
    if (!conf) return;

    if (conf.lockdown && !db.whitelists[message.guild.id].includes(message.author.id) && message.author.id !== message.guild.ownerId) {
        return message.delete().catch(() => {});
    }

    if (conf.automodWords.length > 0 && !db.whitelists[message.guild.id].includes(message.author.id) && message.author.id !== message.guild.ownerId) {
        const txt = message.content.toLowerCase();
        if (conf.automodWords.some(w => txt.includes(w))) {
            await message.delete().catch(() => {});
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member) member.timeout(300000, 'Palabra prohibida detectada por AutoMod').catch(() => {});
            return;
        }
    }

    if (conf.antiMassMention && message.mentions.users.size > 4 && !db.whitelists[message.guild.id].includes(message.author.id)) {
        await message.delete().catch(() => {});
        const m = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (m && m.bannable) await m.ban({ reason: 'Nerox Automod: Menciones Masivas' });
    }
});

// INTERCEPTORES DE CONSERVACIÓN ESTRUCTURAL
client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const log = audit?.entries.first();
    if (log) {
        await verificarNuke(channel.guild, log.executorId, 'channel_delete');
        if (channel.type !== ChannelType.GuildCategory) await channel.clone().then(c => c.setPosition(channel.rawPosition));
    }
});

client.on('roleDelete', async role => {
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const log = audit?.entries.first();
    if (log) {
        await verificarNuke(role.guild, log.executorId, 'role_delete');
        await role.guild.roles.create({ name: role.name, color: role.color, permissions: role.permissions, hoist: role.hoist, mentionable: role.mentionable });
    }
});

client.on('webhookUpdate', async channel => {
    if (!channel.guild) return; checkGuildDB(channel.guild.id);
    if (!db.configs[channel.guild.id].antiWebhook) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1 }).catch(() => null);
    const log = audit?.entries.first();
    if (log && log.executorId !== client.user.id && !db.whitelists[channel.guild.id].includes(log.executorId)) {
        await verificarNuke(channel.guild, log.executorId, 'webhook_sabotage');
        const hooks = await channel.fetchWebhooks().catch(() => []);
        for (const h of hooks.values()) if (h.owner?.id === log.executorId) await h.delete();
    }
});

function enviarLog(guild, titulo, descripcion) {
    const channelId = db.configs[guild.id]?.logsChannel; if (!channelId) return;
    const targetChannel = guild.channels.cache.get(channelId); if (!targetChannel) return;
    const embed = new EmbedBuilder().setTitle(titulo).setDescription(descripcion).setColor('#2b2d31').setTimestamp();
    targetChannel.send({ embeds: [embed] }).catch(() => {});
}

const app = express(); app.get('/', (r, s) => s.send('Nerox Core Operational.')); app.listen(3000);
client.login(process.env.TOKEN);

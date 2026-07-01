const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ActivityType,
    StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const express = require('express'); 
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent
    ]
});

// VARIABLES CENTRALIZADAS E INFRAESTRUCTURA GLOBAL
const CENTRAL_REPORTS_CHANNEL_ID = "1521762536586743868";
const BOT_OWNER_ID = process.env.OWNER_ID || "339462207909265408"; 

// CREACIÓN DE CARPETAS REQUERIDAS
if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');

// PERSISTENCIA DE DATOS
let db = { configs: {}, whitelists: {}, warns: {}, globalBlacklist: [], reports: {}, appeals: [], maintenance: false };
if (fs.existsSync('./database.json')) {
    try { db = JSON.parse(fs.readFileSync('./database.json', 'utf-8')); } catch (e) { console.error("Error BD:", e); }
}

function saveDB() {
    fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

// COPIAS DE SEGURIDAD AUTOMÁTICAS E INDEPENDIENTES EN CARPETA backups/
setInterval(() => {
    const path = `./backups/backup-${Date.now()}.json`;
    fs.writeFileSync(path, JSON.stringify(db, null, 2));
    console.log(`💾 [Backup] Copia de seguridad guardada con éxito en ${path}`);
}, 1000 * 60 * 60 * 6); // Cada 6 horas

function checkGuildDB(guildId) {
    let changed = false;
    if (!db.configs[guildId]) {
        db.configs[guildId] = { 
            logsChannel: null, verifyChannel: null, verifyRole: null, lockdown: false,
            antiWebhook: true, antiSpam: true, antiLink: true, antiAlt: true, antiRaid: true, antiMassMention: true
        };
        changed = true;
    }
    if (!db.whitelists[guildId]) { db.whitelists[guildId] = []; changed = true; }
    if (!db.warns[guildId]) { db.warns[guildId] = {}; changed = true; }
    if (!db.reports) { db.reports = {}; changed = true; }
    if (!db.appeals) { db.appeals = []; changed = true; }
    if (changed) saveDB();
}

// CACHES OPERATIVOS EN CALIENTE
const antiSpamCache = new Map();
const recentActions = new Map();
const joinJoinCache = new Map(); 
const activeCaptchas = new Map(); 

function isUserBotBanned(userId) {
    return db.globalBlacklist.some(entry => entry.id === userId);
}

// INTERCEPTOR ANTINUKE MÁXIMO (PUNALIZACIÓN INMEDIATA)
async function verificarNuke(guild, executorId, actionType) {
    if (executorId === client.user.id || db.whitelists[guild.id]?.includes(executorId) || executorId === guild.ownerId) return false;
    const key = `${guild.id}-${executorId}-${actionType}`;
    const now = Date.now();

    if (!recentActions.has(key)) recentActions.set(key, []);
    const actions = recentActions.get(key);
    actions.push(now);
    const recent = actions.filter(t => now - t < 10000); // Ráfagas en menos de 10 segundos
    recentActions.set(key, recent);

    if (recent.length > 2) { 
        const member = await guild.members.fetch(executorId).catch(() => {});
        if (member && member.bannable) {
            await member.ban({ reason: `🚨 Nerox Pro Nuke Shield: Mitigación inmediata de brecha técnica [${actionType}]` }).catch(() => {});
            enviarLog(guild, '🚨 PROTOCOLO DE EXTERMINIO EJECUTADO', `El miembro del staff <@${executorId}> disparó los límites críticos de modificaciones y ha sido **BANEADO** de la red.`);
            return true;
        }
    }
    return false;
}

// COMPILACIÓN ESTRUCTURADA DE COMANDOS SLASHS (CON LOS COMANDOS REQUERIDOS)
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
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
].map(c => c.toJSON());

client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard Kernel Pro inicializado con éxito.`);
    client.user.setPresence({ status: 'dnd', activities: [{ name: '/help | Protegiendo servidores 🛡️', type: ActivityType.Watching }] });
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) { console.error(e); }
});

// INTERCEPTOR MAESTRO DE COMANDOS INTERACTIVOS
client.on('interactionCreate', async interaction => {
    if (!interaction.guild) return;
    const { commandName, options, user, guild, channel } = interaction;
    checkGuildDB(guild.id);

    // Filtro global de Blacklist
    if (isUserBotBanned(user.id) && commandName !== 'appeal') {
        return interaction.reply({ content: '❌ **Acceso denegado.** Te encuentras en la Blacklist Global de Nerox Guard.', ephemeral: true });
    }

    // Filtro global de Mantenimiento
    if (db.maintenance && user.id !== BOT_OWNER_ID && interaction.isCommand()) {
        return interaction.reply({ content: '⚙️ **Modo Mantenimiento Activo:** Nerox Guard está actualizando sus bases centrales. Inténtalo más tarde.', ephemeral: true });
    }

    if (interaction.isChatInputCommand()) {
        if (commandName === 'ping') return interaction.reply(`🏓 Latencia Core: **${client.ws.ping}ms**`);
        
        if (commandName === 'help') {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🛡️ Asistencia Operativa - Nerox Guard').setDescription('Utiliza `/setup` para ver la matriz interactiva.\n\n**Comandos clave:**\n`/setlogs` `/setverify` `/whitelist` `/warn` `/warns` `/resetwarns` `/timeout` `/purge` `/lock` `/unlock` `/serverinfo` `/userinfo` `/botinfo` `/report` `/report-view` `/report-clear` `/backup-export`').setColor('#2b2d31')] });
        }

        if (commandName === 'stats') {
            return interaction.reply({ content: `📊 **Métricas Avanzadas Nerox Guard:**\n• Clústeres: \`${client.guilds.cache.size}\` servidores\n• Cobertura: \`${client.users.cache.size}\` usuarios\n• Latencia WebSocket: \`${client.ws.ping}ms\`\n• Estado del Kernel: \`Estable / DND\`\n• Copias en Disco: \`Activas\`` });
        }

        if (commandName === 'maintenance') {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ Restringido.', ephemeral: true });
            const estado = options.getString('estado');
            db.maintenance = (estado === 'on');
            saveDB();
            return interaction.reply(`⚙️ El modo de mantenimiento global ha sido conmutado a: **${db.maintenance ? 'ACTIVADO' : 'DESACTIVADO'}**.`);
        }

        if (commandName === 'backup-export') {
            await interaction.deferReply({ ephemeral: true });
            const dataExport = JSON.stringify(db.configs[guild.id] || {}, null, 2);
            const path = `./export-${guild.id}.json`;
            fs.writeFileSync(path, dataExport);
            await interaction.editReply({ content: '📦 Archivo de configuración exportado con éxito:', files: [path] });
            return fs.unlinkSync(path);
        }

        if (commandName === 'setlogs') {
            const chan = options.getChannel('canal');
            db.configs[guild.id].logsChannel = chan.id;
            saveDB();
            return interaction.reply({ content: `✅ Sistema de logs dirigido a ${chan}.`, ephemeral: true });
        }

        if (commandName === 'setverify') {
            const vChan = options.getChannel('canal');
            const vRole = options.getRole('rol');
            db.configs[guild.id].verifyChannel = vChan.id;
            db.configs[guild.id].verifyRole = vRole.id;
            saveDB();

            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('trigger_captcha_process').setLabel('🛡️ Verificar Identidad').setStyle(ButtonStyle.Primary)
            );
            await vChan.send({
                embeds: [new EmbedBuilder().setTitle('🔐 Control de Acceso Perimetral').setDescription('Para evitar el ingreso de bots y cuentas automatizadas, presiona el botón inferior para resolver un reto matemático.').setColor('#2b2d31')],
                components: [buttonRow]
            }).catch(() => {});
            return interaction.reply({ content: '✅ Sistema de Captcha desplegado exitosamente.', ephemeral: true });
        }

        if (commandName === 'whitelist') {
            const target = options.getUser('user');
            const action = options.getString('accion');
            if (action === 'add') {
                if (!db.whitelists[guild.id].includes(target.id)) db.whitelists[guild.id].push(target.id);
                interaction.reply(`🛡️ Se añadieron inmunidades tácticas para <@${target.id}>.`);
            } else {
                db.whitelists[guild.id] = db.whitelists[guild.id].filter(id => id !== target.id);
                interaction.reply(`❌ Inmunidades revocadas para <@${target.id}>.`);
            }
            return saveDB();
        }

        if (commandName === 'warn') {
            const target = options.getUser('target');
            const razon = options.getString('razon') || 'Sin especificar';
            if (!db.warns[guild.id][target.id]) db.warns[guild.id][target.id] = [];
            db.warns[guild.id][target.id].push(razon);
            saveDB();
            enviarLog(guild, '⚠️ Advertencia Aplicada (Warn)', `**Usuario:** <@${target.id}>\n**Moderador:** ${user.tag}\n**Razón:** ${razon}`);
            return interaction.reply(`⚠️ Registro punitivo asignado a <@${target.id}>.`);
        }

        if (commandName === 'warns') {
            const target = options.getUser('target');
            const historial = db.warns[guild.id][target.id] || [];
            if (historial.length === 0) return interaction.reply('🕊️ El usuario mantiene un historial limpio.');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Historial de Infracciones: ${target.tag}`).setDescription(historial.map((r, i) => `\`${i+1}.\` ${r}`).join('\n')).setColor('#2b2d31')] });
        }

        if (commandName === 'resetwarns') {
            const target = options.getUser('target');
            db.warns[guild.id][target.id] = [];
            saveDB();
            return interaction.reply(`🗑️ Se ha purgado el historial de advertencias de <@${target.id}>.`);
        }

        if (commandName === 'timeout') {
            const target = options.getUser('target');
            const time = options.getInteger('tiempo');
            const member = await guild.members.fetch(target.id).catch(() => {});
            if (!member) return interaction.reply('❌ Miembro no encontrado.');
            await member.timeout(time * 60000, `Aislamiento por comando de ${user.tag}`).catch(() => {});
            enviarLog(guild, '⏳ Aislamiento Aplicado (Timeout)', `**Usuario:** <@${target.id}>\n**Moderador:** ${user.tag}\n**Duración:** ${time} minutos`);
            return interaction.reply(`⏳ El usuario <@${target.id}> ha sido aislado por ${time} minutos.`);
        }

        if (commandName === 'purge') {
            const qty = options.getInteger('cantidad');
            await channel.bulkDelete(qty, true).catch(() => {});
            return interaction.reply({ content: `🗑️ Se purgaron \`${qty}\` mensajes de este canal.`, ephemeral: true });
        }

        // REAL SISTEMA DE LOCKDOWN COMPLETO MÚLTIPLE CANAL
        if (commandName === 'lock') {
            db.configs[guild.id].lockdown = true;
            saveDB();
            await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
            return interaction.reply('🔒 **Lockdown Activado:** Este canal ha sido cerrado preventivamente. Transmisión bloqueada.');
        }

        if (commandName === 'unlock') {
            db.configs[guild.id].lockdown = false;
            saveDB();
            await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true }).catch(() => {});
            return interaction.reply('u001f513 **Lockdown Desactivado:** El canal ha sido reabierto.');
        }

        if (commandName === 'serverinfo') {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Servidor: ${guild.name}`).setDescription(`ID: \`${guild.id}\` | Miembros: **${guild.memberCount}**`).setColor('#2b2d31')] });
        }

        if (commandName === 'userinfo') {
            const target = options.getUser('target');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Usuario: ${target.tag}`).setDescription(`ID: \`${target.id}\``).setColor('#2b2d31')] });
        }

        if (commandName === 'botinfo') {
            return interaction.reply({ content: `⚙️ **Nerox Guard Core:** Engine Operativo v14 | Latencia API: ${client.ws.ping}ms` });
        }

        if (commandName === 'report') {
            const target = options.getUser('usuario');
            const reason = options.getString('motivo');

            if (target.id === user.id || target.bot) return interaction.reply({ content: '❌ Operación inválida en los parámetros del reporte.', ephemeral: true });

            if (!db.reports[target.id]) db.reports[target.id] = [];
            db.reports[target.id].push({ reporter: user.tag, reason, date: new Date().toISOString() });
            saveDB();

            const acceptDenyRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`report_accept_${target.id}`).setLabel('🔨 Procesar Ban Global').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('report_reject_click').setLabel('🗑️ Desestimar').setStyle(ButtonStyle.Secondary)
            );

            const centralChannel = client.channels.cache.get(CENTRAL_REPORTS_CHANNEL_ID);
            if (centralChannel) {
                await centralChannel.send({
                    embeds: [new EmbedBuilder().setTitle('📩 REPORTE GLOBAL RECIBIDO').setDescription(`**Sospechoso:** <@${target.id}> (\`${target.id}\`)\n**Delator:** ${user.tag}\n**Razón:** ${reason}`).setColor('#ff3333')],
                    components: [acceptDenyRow]
                }).catch(() => {});
            }

            const botOwnerUser = await client.users.fetch(BOT_OWNER_ID).catch(() => {});
            if (botOwnerUser) botOwnerUser.send(`🚨 **Notificación Crítica:** Nuevo reporte contra ${target.tag}. Razón: ${reason}`).catch(() => {});

            return interaction.reply({ content: '✅ Reporte enviado a los analistas centrales de Nerox Guard.', ephemeral: true });
        }

        if (commandName === 'report-view') {
            const target = options.getUser('usuario');
            const historial = db.reports[target.id] || [];
            if (historial.length === 0) return interaction.reply('🕊️ El usuario no posee reportes en la base de datos central.');
            
            const out = historial.map((r, i) => `\`${i+1}.\` Por **${r.reporter}**: ${r.reason} (${new Date(r.date).toLocaleDateString()})`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Reportes Centrales de ${target.tag}`).setDescription(out).setColor('#ffaa00')] });
        }

        if (commandName === 'report-clear') {
            const idClear = options.getString('id');
            db.reports[idClear] = [];
            saveDB();
            return interaction.reply(`✅ Se limpiaron los reportes de la base de datos central para el ID \`${idClear}\`.`);
        }

        if (commandName === 'botban') {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ Restringido.', ephemeral: true });
            const target = options.getUser('usuario');
            const reason = options.getString('motivo');
            if (isUserBotBanned(target.id)) return interaction.reply({ content: '⚠️ El usuario ya se encuentra penalizado.', ephemeral: true });

            db.globalBlacklist.push({ id: target.id, tag: target.tag, reason });
            saveDB();
            return interaction.reply(`🔨 **${target.tag}** agregado a la Blacklist Global.`);
        }

        if (commandName === 'botunban') {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ Restringido.', ephemeral: true });
            const target = options.getUser('usuario');
            db.globalBlacklist = db.globalBlacklist.filter(u => u.id !== target.id);
            saveDB();
            return interaction.reply(`✅ Removidas las restricciones globales para **${target.tag}**.`);
        }

        if (commandName === 'botbanlist') {
            if (db.globalBlacklist.length === 0) return interaction.reply('🕊️ No hay registros penales globales activos.');
            const listOut = db.globalBlacklist.map((e, i) => `\`${i+1}.\` **${e.tag}** (\`${e.id}\`) - *${e.reason}*`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔨 Historial de Vetos Globales').setDescription(listOut).setColor('#2b2d31')], ephemeral: true });
        }

        if (commandName === 'appeal') {
            if (!isUserBotBanned(user.id)) return interaction.reply({ content: '❌ No requieres apelar.', ephemeral: true });
            const arg = options.getString('argumento');
            const ownerObj = await client.users.fetch(BOT_OWNER_ID).catch(() => {});
            if (ownerObj) ownerObj.send(`📥 **Nueva Solicitud de Apelación:**\nUsuario: **${user.tag}** (\`${user.id}\`)\nArgumento: *${arg}*`).catch(() => {});
            return interaction.reply({ content: '✅ Tu apelación ha sido enviada en privado al Desarrollador.', ephemeral: true });
        }

        if (commandName === 'publicacion') {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ Restringido.', ephemeral: true });
            const m = options.getString('mensaje');
            client.guilds.cache.forEach(g => {
                const cId = db.configs[g.id]?.logsChannel;
                if (cId) {
                    const c = g.channels.cache.get(cId);
                    if (c) c.send({ embeds: [new EmbedBuilder().setTitle('📢 COMUNICADO INTEGRAL').setDescription(m).setColor('#00ff55')] }).catch(() => {});
                }
            });
            return interaction.reply('✅ Transmisión general completada.');
        }

        if (commandName === 'ban') {
            const target = options.getUser('target');
            const member = await guild.members.fetch(target.id).catch(() => {});
            if (member && member.bannable) {
                await member.ban({ reason: `Sanción por ${user.tag}` }).catch(() => {});
                return interaction.reply(`🔨 <@${target.id}> ha sido expulsado del servidor.`);
            }
            return interaction.reply('❌ No se puede banear a este usuario.');
        }

        if (commandName === 'kick') {
            const target = options.getUser('target');
            const member = await guild.members.fetch(target.id).catch(() => {});
            if (member && member.kickable) {
                await member.kick(`Sanción por ${user.tag}`).catch(() => {});
                return interaction.reply(`👢 <@${target.id}> ha sido expulsado del servidor.`);
            }
            return interaction.reply('❌ No se puede expulsar a este usuario.');
        }

        if (commandName === 'setup') {
            const menuDropdown = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('setup_category_selector')
                    .setPlaceholder('Seleccionar Módulo del Sistema')
                    .addOptions([
                        { label: '🛡️ Filtros de Seguridad', description: 'Anti-Raid, Menciones, Webhooks', value: 'sc_security' },
                        { label: '📜 Logs de Auditoría', description: 'Canales de Registro e Interceptores', value: 'sc_logs' }
                    ])
            );
            return interaction.reply({ content: '⚙️ **Matriz de Control Nerox Guard Pro:**', components: [menuDropdown] });
        }
    }

    // INTERCEPCIÓN DE COMPONENTES INTERACTIVOS
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'setup_category_selector') {
            const conf = db.configs[guild.id];
            const chosen = interaction.values[0];

            if (chosen === 'sc_security') {
                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tg_antiRaid').setLabel(`Anti-Raid: ${conf.antiRaid ? 'ON' : 'OFF'}`).setStyle(conf.antiRaid ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('tg_antiMassMention').setLabel(`Menciones: ${conf.antiMassMention ? 'ON' : 'OFF'}`).setStyle(conf.antiMassMention ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('tg_antiAlt').setLabel(`Anti-Alt: ${conf.antiAlt ? 'ON' : 'OFF'}`).setStyle(conf.antiAlt ? ButtonStyle.Success : ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('tg_antiWebhook').setLabel(`Anti-Webhook: ${conf.antiWebhook ? 'ON' : 'OFF'}`).setStyle(conf.antiWebhook ? ButtonStyle.Success : ButtonStyle.Danger)
                );
                return interaction.reply({ content: '🛡️ **Parámetros de Contención de Amenazas:**', components: [buttons], ephemeral: true });
            }
            if (chosen === 'sc_logs') {
                return interaction.reply({ content: `📜 **Parámetros del Sistema de Logs:**\nCanal Asignado Actual: <#${conf.logsChannel || 'No configurado'}>\nUtiliza \`/setlogs\` para cambiar los flujos de auditoría de red.`, ephemeral: true });
            }
        }
    }

    if (interaction.isButton()) {
        const conf = db.configs[guild.id];

        if (interaction.customId.startsWith('report_accept_')) {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
            const idToBan = interaction.customId.split('_')[2];
            if (!db.globalBlacklist.some(e => e.id === idToBan)) {
                db.globalBlacklist.push({ id: idToBan, tag: `ID: ${idToBan}`, reason: 'Validado por central.' });
                saveDB();
            }
            return interaction.reply({ content: `🔨 ID \`${idToBan}\` agregado a la Blacklist Global con éxito.` });
        }
        if (interaction.customId === 'report_reject_click') {
            if (user.id !== BOT_OWNER_ID) return interaction.reply({ content: '❌ No autorizado.', ephemeral: true });
            return interaction.reply({ content: '🗑️ Reporte desestimado.' });
        }

        if (interaction.customId.startsWith('tg_')) {
            const prop = interaction.customId.replace('tg_', '');
            if (prop in conf) {
                conf[prop] = !conf[prop];
                saveDB();
                return interaction.reply({ content: `Filtro **${prop}** cambiado a: **${conf[prop] ? 'ACTIVADO' : 'DESACTIVADO'}**`, ephemeral: true });
            }
        }

        // CORRECCIÓN CAPTCHA MATEMÁTICO SIN 0 NI REPETIDOS (RESPUESTAS ALEATORIAS Y ÚNICAS)
        if (interaction.customId === 'trigger_captcha_process') {
            const n1 = Math.floor(Math.random() * 8) + 2; // Evita el 0 y 1
            const n2 = Math.floor(Math.random() * 8) + 2; 
            const resultadoCorrecto = n1 + n2;

            activeCaptchas.set(user.id, resultadoCorrecto);

            const setOpciones = new Set([resultadoCorrecto]);
            while (setOpciones.size < 4) {
                const falso = resultadoCorrecto + (Math.floor(Math.random() * 7) - 3); // Desviación de -3 a +3
                if (falso > 0 && falso !== resultadoCorrecto) {
                    setOpciones.add(falso);
                }
            }
            const opcionesFinales = Array.from(setOpciones).sort(() => Math.random() - 0.5);

            const rowCaptcha = new ActionRowBuilder().addComponents(
                opcionesFinales.map(op => 
                    new ButtonBuilder().setCustomId(`ans_captcha_${op}`).setLabel(`${op}`).setStyle(ButtonStyle.Secondary)
                )
            );

            return interaction.reply({
                content: `🚨 **RETO CAPTCHA ANTI-BOTS:**\nPara acceder, responde correctamente:\n➡️ **¿Cuánto es $${n1} + ${n2}$?**`,
                components: [rowCaptcha],
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith('ans_captcha_')) {
            const respuestaRecibida = parseInt(interaction.customId.split('_')[2]);
            const respuestaCorrecta = activeCaptchas.get(user.id);

            if (!respuestaCorrecta) return interaction.reply({ content: '❌ Reto expirado. Presiona de nuevo.', ephemeral: true });

            if (respuestaRecibida === respuestaCorrecta) {
                activeCaptchas.delete(user.id);
                const roleObj = guild.roles.cache.get(conf.verifyRole);
                if (roleObj) {
                    const member = await guild.members.fetch(user.id).catch(() => {});
                    if (member) await member.roles.add(roleObj).catch(() => {});
                }
                return interaction.reply({ content: '✅ **Identidad Confirmada.** Rol de acceso otorgado.', ephemeral: true });
            } else {
                activeCaptchas.delete(user.id);
                return interaction.reply({ content: '❌ **Fallo en el Captcha.** Filtro de seguridad perimetral activado.', ephemeral: true });
            }
        }
    }
});

// LOGS ADICIONALES: DETECCIÓN DE MENSAJES EDITADOS Y ELIMINADOS
client.on('messageDelete', async message => {
    if (!message.guild || message.author?.bot) return;
    enviarLog(message.guild, '🗑️ Mensaje Eliminado', `**Autor:** ${message.author.tag} (\`${message.author.id}\`)\n**Canal:** <#${message.channel.id}>\n**Contenido:** ${message.content || '*Archivos o Incrustaciones*'}`);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot || oldMessage.content === newMessage.content) return;
    enviarLog(oldMessage.guild, '📝 Mensaje Editado', `**Autor:** ${oldMessage.author.tag}\n**Canal:** <#oldMessage.channel.id>\n**Antes:** ${oldMessage.content}\n**Después:** ${newMessage.content}`);
});

// MOTOR AUTOMOD INTERCEPTOR (ANTI-SPAM, ANTI-LINK Y CORRECCIÓN ANTI-MASS MENTION REAL)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || isUserBotBanned(message.author.id)) return;
    const conf = db.configs[message.guild.id];
    if (!conf) return;

    // LÓGICA ACTIVA ANTI-MASS MENTION (Detección real superior a 4 menciones)
    if (conf.antiMassMention && message.mentions.users.size > 4) {
        if (!db.whitelists[message.guild.id].includes(message.author.id)) {
            await message.delete().catch(() => {});
            const member = await message.guild.members.fetch(message.author.id).catch(() => {});
            if (member && member.bannable) {
                await member.ban({ reason: '🚨 Nerox Pro: Inyección masiva de menciones detectada' }).catch(() => {});
                enviarLog(message.guild, '🚨 MITIGACIÓN POR ANTI-MASS MENTION', `El usuario ${message.author.tag} ha sido expulsado por enviar menciones masivas.`);
            }
            return;
        }
    }

    if (conf.antiSpam) {
        const now = Date.now();
        if (!antiSpamCache.has(message.author.id)) antiSpamCache.set(message.author.id, []);
        const times = antiSpamCache.get(message.author.id);
        times.push(now);
        const filtered = times.filter(t => now - t < 3000);
        antiSpamCache.set(message.author.id, filtered);

        if (filtered.length > 5) {
            await message.delete().catch(() => {});
            const m = await message.guild.members.fetch(message.author.id).catch(() => {});
            if (m) await m.timeout(600000, 'Spam masivo detectado').catch(() => {});
            return;
        }
    }

    if (conf.antiLink && /(discord\.gg|discord\.com\/invite|https?:\/\/[^\s]+)/g.test(message.content)) {
        if (!db.whitelists[message.guild.id].includes(message.author.id)) {
            await message.delete().catch(() => {});
        }
    }
});

// REAL INTERCEPTOR LOCKDOWN (Evita envío de mensajes si está activo)
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const conf = db.configs[message.guild.id];
    if (conf && conf.lockdown) {
        if (!db.whitelists[message.guild.id].includes(message.author.id) && message.author.id !== message.guild.ownerId) {
            await message.delete().catch(() => {});
        }
    }
});

// LÓGICA ACTIVA CORREGIDA ANTI-ALT (Expulsión inmediata de cuentas nuevas de menos de 7 días)
client.on('guildMemberAdd', async member => {
    checkGuildDB(member.guild.id);
    const conf = db.configs[member.guild.id];

    if (conf.antiAlt) {
        const diasCreacion = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
        if (diasCreacion < 7) { // Menos de 7 días de creación en Discord
            await member.kick('🚨 Nerox Pro: Filtro de seguridad Anti-Alt activo (cuenta sospechosa de reciente creación).').catch(() => {});
            enviarLog(member.guild, '🚨 CUENTA SUSPICACIA FILTRADA (Anti-Alt)', `La cuenta de ${member.user.tag} (\`${member.id}\`) fue expulsada por tener menos de 7 días de antigüedad.`);
            return;
        }
    }

    // Control Anti-Raid
    if (conf.antiRaid) {
        const now = Date.now();
        if (!joinJoinCache.has(member.guild.id)) joinJoinCache.set(member.guild.id, []);
        const gJoins = joinJoinCache.get(member.guild.id);
        gJoins.push(now);
        const filtered = gJoins.filter(t => now - t < 5000);
        joinJoinCache.set(member.guild.id, filtered);

        if (filtered.length > 5) {
            conf.lockdown = true;
            saveDB();
            enviarLog(member.guild, '🚨 ANTI-RAID DISPARADO', 'Ataque de bots o ingresos masivos concurrentes. Servidor bloqueado en Lockdown.');
        }
    }
});

// LÓGICAS ANTINUKE AVANZADAS: CREACIÓN, EDICIÓN Y REVERSIÓN

// Anti-Channel Create & Delete
client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        const trigger = await verificarNuke(channel.guild, log.executorId, 'channel_create');
        if (trigger) await channel.delete().catch(() => {}); // Borra el canal creado maliciosamente
    }
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        await verificarNuke(channel.guild, log.executorId, 'channel_delete');
        if (channel.type !== ChannelType.GuildCategory) {
            await channel.clone().then(clon => clon.setPosition(channel.rawPosition)).catch(() => {});
        }
    }
});

// Anti-Role Create & Delete
client.on('roleCreate', async role => {
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        const trigger = await verificarNuke(role.guild, log.executorId, 'role_create');
        if (trigger) await role.delete().catch(() => {}); // Revoca el rol creado
    }
});

client.on('roleDelete', async role => {
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        await verificarNuke(role.guild, log.executorId, 'role_delete');
        await role.guild.roles.create({
            name: role.name, color: role.color, permissions: role.permissions, hoist: role.hoist, mentionable: role.mentionable
        }).catch(() => {});
    }
});

// Anti-Guild Update (Reversión completa ante cambios estéticos sospechosos)
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => {});
    const log = audit?.entries.first();
    if (log && log.executorId !== client.user.id && !db.whitelists[newGuild.id]?.includes(log.executorId)) {
        await verificarNuke(newGuild, log.executorId, 'guild_update');
        
        // Reversión táctica instantánea del sabotaje
        if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name).catch(() => {});
        if (oldGuild.icon !== newGuild.icon) await newGuild.setIcon(oldGuild.iconURL()).catch(() => {});
        
        enviarLog(newGuild, '🚨 INTENTO DE ALTERACIÓN DEL SERVIDOR REVERTIDO', `Se detuvo el intento de cambiar las propiedades estéticas del gremio por <@${log.executorId}>.`);
    }
});

// Anti-Webhook Avanzado (Detección total de Creación, Edición y Eliminación)
client.on('webhookUpdate', async channel => {
    if (!channel.guild) return;
    checkGuildDB(channel.guild.id);
    if (!db.configs[channel.guild.id].antiWebhook) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1 }).catch(() => {});
    const log = audit?.entries.first();
    if (log && log.executorId !== client.user.id && !db.whitelists[channel.guild.id].includes(log.executorId)) {
        await verificarNuke(channel.guild, log.executorId, 'webhook_sabotage');
        const hooks = await channel.fetchWebhooks().catch(() => []);
        for (const h of hooks.values()) {
            if (h.owner?.id === log.executorId) await h.delete().catch(() => {});
        }
        enviarLog(channel.guild, '🛡️ FILTRO ANTI-WEBHOOK OPERATIVO', `Se mitigó una acción sobre webhooks en <#${channel.id}> por parte de <@${log.executorId}>.`);
    }
});

// Anti-Nuke de Emojis (Creación y Eliminación)
client.on('emojiCreate', async emoji => {
    const audit = await emoji.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.EmojiCreate }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        const trigger = await verificarNuke(emoji.guild, log.executorId, 'emoji_create');
        if (trigger) await emoji.delete().catch(() => {});
    }
});

client.on('emojiDelete', async emoji => {
    const audit = await emoji.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.EmojiDelete }).catch(() => {});
    const log = audit?.entries.first();
    if (log) {
        await verificarNuke(emoji.guild, log.executorId, 'emoji_delete');
    }
});

// LOGS ADICIONALES REQUERIDOS DE INFRAESTRUCTURA (BANS, UNBANS)
client.on('guildBanAdd', async ban => {
    enviarLog(ban.guild, '🔨 Miembro Baneado', `**Usuario:** ${ban.user.tag} (\`${ban.user.id}\`)`);
});

client.on('guildBanRemove', async ban => {
    enviarLog(ban.guild, '🔓 Miembro Desbaneado', `**Usuario:** ${ban.user.tag} (\`${ban.user.id}\`)`);
});

// EMISOR CENTRALIZADO DE LOGS
function enviarLog(guild, titulo, descripcion) {
    const channelId = db.configs[guild.id]?.logsChannel;
    if (!channelId) return;
    const targetChannel = guild.channels.cache.get(channelId);
    if (!targetChannel) return;

    const embed = new EmbedBuilder().setTitle(titulo).setDescription(descripcion).setColor('#2b2d31').setTimestamp();
    targetChannel.send({ embeds: [embed] }).catch(() => {});
}

// SERVIDOR WEB
const app = express();
app.get('/', (r, s) => s.send('Nerox Core Operational.'));
app.listen(3000);

client.login(process.env.TOKEN);

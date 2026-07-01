const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType
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

// PERSISTENCIA DE DATOS (Base de datos local optimizada)
let db = { configs: {}, whitelists: {}, warns: {} };
if (fs.existsSync('./database.json')) {
    try { db = JSON.parse(fs.readFileSync('./database.json', 'utf-8')); } catch (e) { console.error("Error leyendo BD:", e); }
}

function saveDB() {
    fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

function checkGuildDB(guildId) {
    let changed = false;
    if (!db.configs[guildId]) {
        db.configs[guildId] = { logsChannel: null, securityLevel: 'high', lockdown: false, antiWebhook: true, antiSpam: true, antiLink: true, antiAlt: true };
        changed = true;
    }
    if (!db.whitelists[guildId]) { db.whitelists[guildId] = []; changed = true; }
    if (!db.warns[guildId]) { db.warns[guildId] = {}; changed = true; }
    if (changed) saveDB();
}

const antiSpamCache = new Map();
const recentActions = new Map();

// REGISTRO OFICIAL DE COMANDOS SLASHS
const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Muestra el panel de ayuda e información del bot'),
    new SlashCommandBuilder().setName('ping').setDescription('Muestra la latencia'),
    new SlashCommandBuilder().setName('stats').setDescription('Muestra las estadísticas globales de Nerox Guard'),
    new SlashCommandBuilder().setName('setlogs').setDescription('Establece el canal de alertas y logs').addChannelOption(o => o.setName('canal').setDescription('Canal de destino').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('setup').setDescription('Panel interactivo de configuración extendida').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('whitelist').setDescription('Administra la lista blanca').addUserOption(o => o.setName('user').setDescription('Miembro').setRequired(true)).addStringOption(o => o.setName('accion').setDescription('add/remove').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('warn').setDescription('Sanciona a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Razón')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('warns').setDescription('Consulta el historial de advertencias de un usuario').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('resetwarns').setDescription('Limpia el historial de advertencias de un usuario').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('ban').setDescription('Banea a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsa a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder().setName('timeout').setDescription('Aísla a un miembro').addUserOption(o => o.setName('target').setDescription('Miembro').setRequired(true)).addIntegerOption(o => o.setName('tiempo').setDescription('Minutos').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('purge').setDescription('Borra mensajes en masa').addIntegerOption(o => o.setName('cantidad').setDescription('Mensajes').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('lock').setDescription('Bloquea el canal').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('Desbloquea el canal').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map(c => c.toJSON());

// EVENTO READY CENTRAL (Máxima compatibilidad en Hosting)
client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard Pro totalmente operativo como ${client.user.tag}`);

    client.user.setPresence({
        status: 'dnd',
        activities: [{ name: '/help | Protegiendo servidores 🛡️', type: 3 }]
    });

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) { console.error(e); }
});

// MOTOR CENTRAL DE CONTROL ANTI-NUKE CON SANCIONAMIENTO FULMINANTE
async function verificarNuke(guild, executorId, actionType) {
    if (executorId === client.user.id || db.whitelists[guild.id]?.includes(executorId) || executorId === guild.ownerId) return false;
    const key = `${guild.id}-${executorId}-${actionType}`;
    const now = Date.now();

    if (!recentActions.has(key)) recentActions.set(key, []);
    const actions = recentActions.get(key);
    actions.push(now);
    const recent = actions.filter(t => now - t < 10000);
    recentActions.set(key, recent);

    if (recent.length > 3) { 
        const member = await guild.members.fetch(executorId).catch(() => {});
        if (member && member.bannable) {
            await member.ban({ reason: `🚨 Nerox Anti-Nuke: Umbral excedido en módulo [${actionType}]` }).catch(() => {});
            enviarLog(guild, '🚨 SISTEMA ANTI-NUKE DETECTADO', `El usuario <@${executorId}> superó los límites permitidos de ejecución y fue **BANEADO** fulminantemente.`);
            return true;
        }
    }
    return false;
}

// NUEVO MÓDULO AGREGADO: ANTI-ADMIN (Previene filtración de Permisos de Staff)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    checkGuildDB(newMember.guild.id);
    
    // Detecta si el nuevo estado del miembro posee permisos de administrador que antes no tenía
    if (newMember.permissions.has(PermissionFlagsBits.Administrator) && !oldMember.permissions.has(PermissionFlagsBits.Administrator)) {
        const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(() => {});
        const entry = logs?.entries.first();
        if (!entry) return;

        const detono = await verificarNuke(newMember.guild, entry.executorId, 'admin_give');
        if (detono) {
            // Remueve de inmediato la totalidad de roles otorgados para contener la brecha
            await newMember.roles.set([]).catch(() => {});
            enviarLog(newMember.guild, '🚨 INTENTO DE ASIGNACIÓN DE ADMINISTRADOR', `El usuario <@${entry.executorId}> intentó otorgar permisos de administrador a ${newMember}. Roles revocados.`);
        }
    }
});

// NUEVO MÓDULO AGREGADO: ANTI-RENAME DE CANALES
client.on('channelUpdate', async (oldChannel, newChannel) => {
    checkGuildDB(newChannel.guild.id);
    if (oldChannel.name === newChannel.name) return;

    const logs = await newChannel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelUpdate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && entry.executorId !== client.user.id) {
        const detono = await verificarNuke(newChannel.guild, entry.executorId, 'channel_rename');
        if (detono) {
            await newChannel.setName(oldChannel.name).catch(() => {});
            enviarLog(newChannel.guild, '🏷️ Intento de Renombrado de Canal Bloqueado', `Se bloqueó el cambio de nombre de **#${oldChannel.name}** realizado por <@${entry.executorId}>. Revertido.`);
        }
    }
});

// NUEVO MÓDULO AGREGADO: ANTI-RENAME DE ROLES
client.on('roleUpdate', async (oldRole, newRole) => {
    checkGuildDB(newRole.guild.id);
    if (oldRole.name === newRole.name) return;

    const logs = await newRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && entry.executorId !== client.user.id) {
        const detono = await verificarNuke(newRole.guild, entry.executorId, 'role_rename');
        if (detono) {
            await newRole.setName(oldRole.name).catch(() => {});
            enviarLog(newRole.guild, '🛡️ Intento de Renombrado de Rol Bloqueado', `Se revirtió el cambio de nombre del rol **${oldRole.name}** hecho por <@${entry.executorId}>.`);
        }
    }
});

// CONTROLADOR DE INTERACCIONES COMANDOS Y BOTONES
client.on('interactionCreate', async interaction => {
    const { guild } = interaction;
    if (!guild) return;
    checkGuildDB(guild.id);

    if (interaction.isChatInputCommand()) {
        const { commandName, options, channel } = interaction;

        if (commandName === 'ping') return interaction.reply(`🏓 Latencia: ${client.ws.ping}ms`);

        if (commandName === 'stats') {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📊 Estadísticas de Nerox Guard')
                        .addFields(
                            { name: '🌐 Servidores', value: `${client.guilds.cache.size}`, inline: true },
                            { name: '👥 Usuarios Vigilados', value: `${client.users.cache.size}`, inline: true },
                            { name: '⚡ Latencia API', value: `${client.ws.ping}ms`, inline: true }
                        ).setColor('#2b2d31')
                ]
            });
        }

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Nerox Guard - Panel de Ayuda')
                .setDescription(
                    '¡Hola! Soy **Nerox Guard**, un sistema avanzado contra raiders.\n\n' +
                    '🛡️ **Anti-Nuke Completo** • Protección de canales, roles, emojis, admin-gives y webhooks.\n' +
                    '🚫 **Automod Pro** • Control drástico de spam, flood, invitaciones y links.\n' +
                    '🔒 **Filtro de Entradas** • Expulsión automática de bots maliciosos y cuentas fake/alts.\n\n' +
                    '**¿Necesitas soporte técnico inmediato?**'
                ).setColor('#2b2d31');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('🛡️ SOPORTE NEROX GUARD').setStyle(ButtonStyle.Link).setURL('https://discord.gg/fR2qf5GspN'),
                new ButtonBuilder().setLabel('➕ Invitar al Bot').setStyle(ButtonStyle.Link).setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=8`)
            );
            return interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'setlogs') {
            const targetChannel = options.getChannel('canal');
            db.configs[guild.id].logsChannel = targetChannel.id;
            saveDB();
            return interaction.reply(`✅ Canal de logs configurado exitosamente en ${targetChannel}`);
        }

        if (commandName === 'setup') {
            const conf = db.configs[guild.id];
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_antiWebhook').setLabel(`Webhook: ${conf.antiWebhook ? '✅' : '❌'}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_antiSpam').setLabel(`Spam: ${conf.antiSpam ? '✅' : '❌'}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_antiLink').setLabel(`Links: ${conf.antiLink ? '✅' : '❌'}`).setStyle(ButtonStyle.Primary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_antiAlt').setLabel(`Alts: ${conf.antiAlt ? '✅' : '❌'}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_lockdown').setLabel(`Emergencia: ${conf.lockdown ? '🚨 ON' : '🛑 OFF'}`).setStyle(conf.lockdown ? ButtonStyle.Danger : ButtonStyle.Secondary)
            );
            return interaction.reply({ 
                embeds: [new EmbedBuilder().setTitle('🛡️ Configuración de Módulos').setDescription('Gestiona los sistemas de protección activa.').setColor('#2b2d31')], 
                components: [row1, row2] 
            });
        }

        if (commandName === 'whitelist') {
            const target = options.getUser('user');
            const action = options.getString('accion');
            let wl = db.whitelists[guild.id];
            if (action === 'add') {
                if (!wl.includes(target.id)) wl.push(target.id);
                interaction.reply(`🛡️ ${target.tag} añadido a la whitelist.`);
            } else {
                db.whitelists[guild.id] = wl.filter(id => id !== target.id);
                interaction.reply(`❌ ${target.tag} removido de la whitelist.`);
            }
            saveDB();
            return;
        }

        if (commandName === 'warn') {
            const user = options.getUser('target');
            const razon = options.getString('razon') || 'Sin especificar';
            if (!db.warns[guild.id][user.id]) db.warns[guild.id][user.id] = [];
            db.warns[guild.id][user.id].push(razon);
            saveDB();
            return interaction.reply(`⚠️ Warn aplicado a **${user.tag}**. Historial: ${db.warns[guild.id][user.id].length}`);
        }

        if (commandName === 'warns') {
            const user = options.getUser('target');
            const lista = db.warns[guild.id][user.id] || [];
            if (lista.length === 0) return interaction.reply(`✅ **${user.tag}** no tiene advertencias.`);
            const embed = new EmbedBuilder().setTitle(`⚠️ Historial de: ${user.tag}`).setColor('#2b2d31')
                .setDescription(lista.map((r, i) => `${i + 1}. ${r}`).join('\n'));
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'resetwarns') {
            const user = options.getUser('target');
            db.warns[guild.id][user.id] = [];
            saveDB();
            return interaction.reply(`🗑️ Historial de advertencias borrado para **${user.tag}**.`);
        }

        if (commandName === 'ban') {
            const user = options.getUser('target');
            await guild.members.ban(user, { reason: 'Comando Directo /ban' });
            return interaction.reply(`✅ **${user.tag}** fue baneado.`);
        }

        if (commandName === 'kick') {
            const user = options.getUser('target');
            const member = await guild.members.fetch(user.id).catch(() => {});
            if (!member) return interaction.reply('❌ Miembro no encontrado.');
            await member.kick('Comando Directo /kick');
            return interaction.reply(`✅ **${user.tag}** fue expulsado.`);
        }

        if (commandName === 'timeout') {
            const user = options.getUser('target');
            const tiempo = options.getInteger('tiempo');
            const member = await guild.members.fetch(user.id).catch(() => {});
            if (!member) return interaction.reply('❌ Miembro no encontrado.');
            await member.timeout(tiempo * 60000, 'Comando Directo /timeout');
            return interaction.reply(`✅ Sancionado por ${tiempo} minutos.`);
        }

        if (commandName === 'purge') {
            const cantidad = options.getInteger('cantidad');
            await channel.bulkDelete(cantidad, true);
            return interaction.reply({ content: `🗑️ Borrados ${cantidad} mensajes.`, ephemeral: true });
        }

        if (commandName === 'lock' || commandName === 'unlock') {
            const lock = commandName === 'lock';
            await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: !lock });
            return interaction.reply(lock ? '🔒 Canal Cerrado.' : '🔓 Canal Abierto.');
        }
    }

    if (interaction.isButton()) {
        const prop = interaction.customId.replace('btn_', '');
        const conf = db.configs[guild.id];
        if (conf && prop in conf) {
            conf[prop] = !conf[prop];
            saveDB();
            return interaction.reply({ content: `Ajuste **${prop}** actualizado a: **${conf[prop] ? 'ACTIVADO' : 'DESACTIVADO'}**`, ephemeral: true });
        }
    }
});

// AUTOMOD (MESSAGES)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    checkGuildDB(message.guild.id);
    const conf = db.configs[message.guild.id];

    if (conf.lockdown && !db.whitelists[message.guild.id].includes(message.author.id) && message.author.id !== message.guild.ownerId) {
        await message.delete().catch(() => {});
        return;
    }

    if (db.whitelists[message.guild.id].includes(message.author.id)) return;

    if (conf.antiSpam) {
        const now = Date.now();
        if (!antiSpamCache.has(message.author.id)) antiSpamCache.set(message.author.id, []);
        const times = antiSpamCache.get(message.author.id);
        times.push(now);
        const filtered = times.filter(t => now - t < 3000);
        antiSpamCache.set(message.author.id, filtered);

        if (filtered.length > 5 || message.mentions.everyone || message.mentions.users.size > 5) {
            await message.delete().catch(() => {});
            const m = await message.guild.members.fetch(message.author.id).catch(() => {});
            if (m) await m.timeout(600000, 'Filtro Anti-Spam Activo').catch(() => {});
            return;
        }
    }

    if (conf.antiLink && /(discord\.gg|discord\.com\/invite|https?:\/\/[^\s]+)/g.test(message.content)) {
        await message.delete().catch(() => {});
    }
});

// COMPLEMENTO DEL MOTOR ANTI-NUKE ORIGINAL
client.on('channelDelete', async channel => {
    checkGuildDB(channel.guild.id);
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry) {
        await verificarNuke(channel.guild, entry.executorId, 'channel_delete');
        if (channel.type !== ChannelType.GuildCategory) {
            await channel.clone().catch(() => {});
        }
        enviarLog(channel.guild, '📁 Canal Eliminado (Restaurado)', `El canal **#${channel.name}** fue borrado por <@${entry.executorId}> y se ha restaurado.`);
    }
});

client.on('channelCreate', async channel => {
    checkGuildDB(channel.guild.id);
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry) {
        const detono = await verificarNuke(channel.guild, entry.executorId, 'channel_create');
        if (detono) await channel.delete('Raid de canales detectado').catch(() => {});
    }
});

client.on('roleDelete', async role => {
    checkGuildDB(role.guild.id);
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry) {
        await verificarNuke(role.guild, entry.executorId, 'role_delete');
        await role.guild.roles.create({
            name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions, mentionable: role.mentionable, position: role.rawPosition
        }).catch(() => {});
        enviarLog(role.guild, '🛡️ Rol Eliminado (Restaurado)', `El rol **${role.name}** borrado por <@${entry.executorId}> fue reestablecido.`);
    }
});

client.on('roleCreate', async role => {
    checkGuildDB(role.guild.id);
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry) {
        const detono = await verificarNuke(role.guild, entry.executorId, 'role_create');
        if (detono) await role.delete('Raid de roles detectado').catch(() => {});
    }
});

client.on('emojiDelete', async emoji => {
    checkGuildDB(emoji.guild.id);
    const logs = await emoji.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.EmojiDelete }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry) {
        await verificarNuke(emoji.guild, entry.executorId, 'emoji_delete');
        enviarLog(emoji.guild, '🖼️ Emoji Eliminado', `El emoji \`${emoji.name}\` fue eliminado por <@${entry.executorId}>.`);
    }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    checkGuildDB(newGuild.id);
    const logs = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && entry.executorId !== client.user.id) {
        await verificarNuke(newGuild, entry.executorId, 'server_update');
        if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name).catch(() => {});
        enviarLog(newGuild, '⚙️ Ajustes del Servidor Modificados', `Se intentaron cambiar los ajustes del servidor por <@${entry.executorId}>. Cambios revertidos.`);
    }
});

client.on('guildMemberRemove', async member => {
    checkGuildDB(member.guild.id);
    const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && entry.target.id === member.id && Date.now() - entry.createdTimestamp < 8000) {
        await verificarNuke(member.guild, entry.executorId, 'mass_kick');
        enviarLog(member.guild, '👢 Miembro Expulsado', `El miembro **${member.user.tag}** fue echado por <@${entry.executorId}>.`);
    }
});

client.on('guildBanAdd', async ban => {
    checkGuildDB(ban.guild.id);
    const logs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 8000) {
        await verificarNuke(ban.guild, entry.executorId, 'mass_ban');
        enviarLog(ban.guild, '🔨 Miembro Baneado', `El miembro **${ban.user.tag}** fue bloqueado por <@${entry.executorId}>.`);
    }
});

client.on('webhookUpdate', async channel => {
    checkGuildDB(channel.guild.id);
    if (!db.configs[channel.guild.id].antiWebhook) return;
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.WebhookCreate }).catch(() => {});
    const entry = logs?.entries.first();
    if (entry && !db.whitelists[channel.guild.id].includes(entry.executorId) && entry.executorId !== client.user.id) {
        const hooks = await channel.fetchWebhooks().catch(() => []);
        for (const h of hooks.values()) {
            if (h.owner?.id === entry.executorId || Date.now() - h.createdTimestamp < 5000) {
                await h.delete('Anti-Webhook System Malicious Prevention').catch(() => {});
            }
        }
        enviarLog(channel.guild, '🛡️ Webhook Bloqueado', `Se eliminó un webhook en <#${channel.id}> creado por <@${entry.executorId}>.`);
    }
});

client.on('guildMemberAdd', async member => {
    checkGuildDB(member.guild.id);
    const conf = db.configs[member.guild.id];

    if (member.user.bot) {
        const logs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => {});
        const entry = logs?.entries.first();
        if (entry && !db.whitelists[member.guild.id].includes(entry.executorId)) {
            await member.kick('Bot no autorizado').catch(() => {});
            enviarLog(member.guild, '🤖 Bot Bloqueado', `El bot ${member} invitado por <@${entry.executorId}> fue expulsado automáticamente.`);
        }
    }

    if (conf.antiAlt && (Date.now() - member.user.createdTimestamp < 1000 * 60 * 60 * 24 * 3)) {
        await member.kick('Cuenta muy reciente').catch(() => {});
        enviarLog(member.guild, '🔒 Cuenta Nueva Bloqueada', `La cuenta ${member.user.tag} fue expulsada (creada hace menos de 3 días).`);
    }
});

// EMISIÓN DE LOGS CENTRALIZADA
function enviarLog(guild, titulo, descripcion) {
    const config = db.configs[guild.id];
    if (!config || !config.logsChannel) return;
    const canal = guild.channels.cache.get(config.logsChannel);
    if (!canal) return;

    const embed = new EmbedBuilder().setTitle(titulo).setDescription(descripcion).setColor('#2b2d31').setTimestamp();
    canal.send({ embeds: [embed] }).catch(() => {});
}

// HOSTING KEEP-ALIVE EXPRESS
const app = express();
app.get('/', (req, res) => res.send('🛡️ Nerox Guard está en línea y vigilando.'));
app.get('/status', (req, res) => {
    res.json({ status: 'online', ping: client.ws.ping || 0, guilds: client.guilds.cache.size, users: client.users.cache.size });
});
app.listen(3000, () => console.log('🌐 Servidor Express iniciado en el puerto 3000.'));

client.login(process.env.TOKEN);

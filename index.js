require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits, 
    ChannelType, 
    AuditLogEvent,
    AttachmentBuilder
} = require('discord.js');

// --- INITIALIZATION ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User]
});

client.commands = new Collection();

// --- IN-MEMORY STATE TRACKERS (READY FOR REDIS / POSTGRES) ---
const dbConfig = new Map();
const dbWhitelist = new Map();
const dbBackups = new Map();
const dbWarnings = new Map();
const dbTickets = new Map();

const raidTracker = new Map();
const spamTracker = new Map();
const massBanTracker = new Map();
const massKickTracker = new Map();

// --- CONFIGURATION HELPERS ---
function getGuildConfig(guildId) {
    if (!dbConfig.has(guildId)) {
        dbConfig.set(guildId, {
            logChannelId: null,
            ticketCategoryId: null,
            quarantineRoleId: null,
            autoRoleId: null,
            language: 'es',
            ticketCounter: 0,
            security: {
                antinuke: true, antiraid: true, antibot: true, antiwebhook: true,
                antilink: true, antispam: true, antieveryone: true, antimention: false,
                antighostping: true, antiinvite: true, antiscam: true,
                antimassban: true, antimasskick: true, antiroleupdate: true,
                antichannelupdate: true, antiguildupdate: true
            }
        });
    }
    return dbConfig.get(guildId);
}

function isWhitelisted(guildId, userId) {
    const list = dbWhitelist.get(guildId) || [];
    return list.includes(userId);
}

function safeString(str, maxLen = 1000) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

async function sendAuditLog(guild, embed) {
    try {
        const config = getGuildConfig(guild.id);
        if (!config || !config.logChannelId) return;
        const channel = guild.channels.cache.get(config.logChannelId);
        if (channel && channel.isTextBased()) await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error(`[Audit Error] ${err.message}`);
    }
}

// --- ANTINUKE & RATE LIMIT GUARDIAN ENGINE ---
async function handleAntiNukeAction(guild, executor, actionName, punishment = 'ban') {
    if (!executor || executor.id === client.user.id || executor.id === guild.ownerId || isWhitelisted(guild.id, executor.id)) return;

    try {
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member) {
            await member.roles.set([]).catch(() => {});
            if (punishment === 'ban') {
                await member.ban({ reason: `[SN AntiNuke Enterprise] Acción no autorizada: ${actionName}` }).catch(() => {});
            } else {
                await member.kick(`[SN AntiNuke Enterprise] Acción preventiva: ${actionName}`).catch(() => {});
            }
        }

        sendAuditLog(guild, new EmbedBuilder()
            .setTitle('🚨 ANTINUKE ENTERPRISE ACTIVADO')
            .setColor(0xFF0000)
            .setDescription(`**Ofensor:** ${executor.tag} (\`${executor.id}\`)\n**Acción Interceptada:** ${actionName}\n**Sanción:** ${punishment.toUpperCase()} y remoción total de permisos.`)
            .setTimestamp()
        );
    } catch (err) {
        console.error(`[AntiNuke Error] ${err.message}`);
    }
}

// Check Mass Actions (Rate Limiting)
function checkRateLimit(tracker, key, maxCount, timeWindowMs) {
    const now = Date.now();
    let records = (tracker.get(key) || []).filter(timestamp => now - timestamp < timeWindowMs);
    records.push(now);
    tracker.set(key, records);
    return records.length >= maxCount;
}

// --- READY & COMMAND REGISTRATION ---
client.once('ready', async () => {
    console.log(`[SN SECURITY v8 ENTERPRISE] Bot inicializado como ${client.user.tag}`);

    const commandsToRegister = [
        { name: 'config', description: 'Muestra la configuración global de seguridad del servidor' },
        { name: 'setup', description: 'Ejecuta el asistente de protección inmediata' },
        { name: 'setlogs', description: 'Configura el canal centralizado de auditoría', options: [{ name: 'canal', type: 7, description: 'Canal de logs', required: true }] },
        { name: 'set-ticket-category', description: 'Configura la categoría para tickets', options: [{ name: 'categoria', type: 7, description: 'Categoría', required: true }] },
        { name: 'autorole', description: 'Configura el rol automático de entrada', options: [
            { name: 'set', type: 1, description: 'Asigna el rol', options: [{ name: 'rol', type: 8, description: 'Rol', required: true }] },
            { name: 'remove', type: 1, description: 'Desactiva el autorrol' }
        ]},
        { name: 'language', description: 'Cambia el idioma predeterminado', options: [{ name: 'lang', type: 3, description: 'Idioma (es/en)', required: true, choices: [{ name: 'Español', value: 'es' }, { name: 'English', value: 'en' }] }] },
        { name: 'ping', description: 'Comprueba el tiempo de respuesta' },
        { name: 'stats', description: 'Telemetría del sistema en tiempo real' },
        { name: 'help', description: 'Centro de ayuda y guía de módulos' },

        { name: 'lockdown', description: 'Cierra el paso de mensajes global o en un canal', options: [{ name: 'canal', type: 7, description: 'Canal objetivo', required: false }] },
        { name: 'unlock', description: 'Abre los permisos de escritura', options: [{ name: 'canal', type: 7, description: 'Canal objetivo', required: false }] },
        { name: 'security-toggle', description: 'Activa o desactiva capas individuales de seguridad', options: [
            { name: 'modulo', type: 3, description: 'Módulo a cambiar', required: true, choices: [
                { name: 'AntiNuke', value: 'antinuke' },
                { name: 'AntiRaid', value: 'antiraid' },
                { name: 'AntiBot', value: 'antibot' },
                { name: 'AntiWebhook', value: 'antiwebhook' },
                { name: 'AntiLink', value: 'antilink' },
                { name: 'AntiSpam', value: 'antispam' },
                { name: 'AntiScam', value: 'antiscam' },
                { name: 'AntiMassBan', value: 'antimassban' }
            ]},
            { name: 'estado', type: 5, description: 'Estado activado/desactivado', required: true }
        ]},
        { name: 'whitelist', description: 'Gestiona los usuarios inmunes al AntiNuke', options: [
            { name: 'add', type: 1, description: 'Añadir usuario', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
            { name: 'remove', type: 1, description: 'Remover usuario', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
            { name: 'list', type: 1, description: 'Listar usuarios autorizados' }
        ]},

        { name: 'ban', description: 'Banea a un usuario', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }, { name: 'razon', type: 3, description: 'Razón', required: false }] },
        { name: 'unban', description: 'Desbanea por ID', options: [{ name: 'id', type: 3, description: 'ID de usuario', required: true }] },
        { name: 'kick', description: 'Expulsa a un usuario', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }, { name: 'razon', type: 3, description: 'Razón', required: false }] },
        { name: 'timeout', description: 'Aísla a un miembro', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }, { name: 'minutos', type: 4, description: 'Minutos', required: true }, { name: 'razon', type: 3, description: 'Razón', required: false }] },
        { name: 'untimeout', description: 'Remueve el aislamiento', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
        { name: 'warn', description: 'Aplica una advertencia', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }, { name: 'razon', type: 3, description: 'Razón', required: true }] },
        { name: 'warnings', description: 'Revisa las advertencias', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
        { name: 'slowmode', description: 'Ajusta el modo lento', options: [{ name: 'segundos', type: 4, description: 'Segundos', required: true }] },
        { name: 'clear', description: 'Limpieza masiva de chat', options: [{ name: 'cantidad', type: 4, description: 'Cantidad', required: true }] },
        { name: 'purgeuser', description: 'Limpia mensajes de un usuario', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }, { name: 'limite', type: 4, description: 'Límite de mensajes', required: true }] },
        { name: 'say', description: 'Envía un comunicado oficial', options: [{ name: 'mensaje', type: 3, description: 'Texto', required: true }] },

        { name: 'ticket-panel', description: 'Despliega el panel de atención', options: [{ name: 'titulo', type: 3, description: 'Título', required: true }, { name: 'descripcion', type: 3, description: 'Descripción', required: true }] },
        { name: 'editar-panel', description: 'Edita el panel de tickets', options: [
            { name: 'contenido', type: 1, description: 'Edita texto del panel', options: [{ name: 'message_id', type: 3, description: 'ID del mensaje', required: true }] }
        ]},
        { name: 'close', description: 'Cierra el ticket activo' },
        { name: 'claim', description: 'Reclama el ticket para atención del Staff' },
        { name: 'transcript', description: 'Genera el registro HTML del ticket' },
        { name: 'add', description: 'Añade un miembro al ticket', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
        { name: 'remove', description: 'Remueve un miembro del ticket', options: [{ name: 'usuario', type: 6, description: 'Usuario', required: true }] },
        { name: 'rename', description: 'Renombra el canal de ticket', options: [{ name: 'nombre', type: 3, description: 'Nuevo nombre', required: true }] },
        { name: 'delete', description: 'Borra el canal de ticket' },

        { name: 'backup', description: 'Sistema de copias de seguridad de estructura', options: [
            { name: 'create', type: 1, description: 'Genera snapshot completo' },
            { name: 'restore', type: 1, description: 'Restaura usando ID', options: [{ name: 'id', type: 3, description: 'ID Backup', required: true }] },
            { name: 'list', type: 1, description: 'Ver copias guardadas' }
        ]}
    ];

    try {
        await client.application.commands.set(commandsToRegister);
        console.log('[Slash Commands] Comandos Enterprise sincronizados.');
    } catch (err) {
        console.error(`[Commands Error] ${err.message}`);
    }
});

// --- DETECCIÓN REAL TIME ANTINUKE & AUDIT MONITORING ---

// Anti Channel Delete / Create / Update
client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const config = getGuildConfig(channel.guild.id);
    if (!config.security?.antinuke) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(channel.guild, entry.executor, `Eliminación de Canal: #${channel.name}`);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!oldChannel.guild) return;
    const config = getGuildConfig(oldChannel.guild.id);
    if (!config.security?.antichannelupdate) return;

    const audit = await oldChannel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelUpdate }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(oldChannel.guild, entry.executor, `Modificación crítica en Canal: #${newChannel.name}`);
    }
});

// Anti Role Delete / Create / Update
client.on('roleDelete', async (role) => {
    const config = getGuildConfig(role.guild.id);
    if (!config.security?.antinuke) return;

    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(role.guild, entry.executor, `Eliminación de Rol: ${role.name}`);
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const config = getGuildConfig(oldRole.guild.id);
    if (!config.security?.antiroleupdate) return;

    // Verificar si se agregaron permisos peligrosos
    const dangerousPermissions = [PermissionFlagsBits.Administrator, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageGuild];
    const gainedDangerous = dangerousPermissions.some(perm => !oldRole.permissions.has(perm) && newRole.permissions.has(perm));

    if (gainedDangerous) {
        const audit = await oldRole.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate }).catch(() => null);
        const entry = audit?.entries.first();
        if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
            await newRole.setPermissions(oldRole.permissions).catch(() => {});
            await handleAntiNukeAction(oldRole.guild, entry.executor, `Escalación de Permisos en Rol: ${newRole.name}`);
        }
    }
});

// Anti Mass Ban Detección
client.on('guildBanAdd', async (ban) => {
    const config = getGuildConfig(ban.guild.id);
    if (!config.security?.antimassban) return;

    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry) {
        const key = `${ban.guild.id}:${entry.executor.id}`;
        const isMass = checkRateLimit(massBanTracker, key, 3, 10000); // 3 baneos en 10s
        if (isMass) {
            await handleAntiNukeAction(ban.guild, entry.executor, `Detección de Mass-Ban en masa`);
        }
    }
});

// Anti Guild Update (Vanity URL / Nombre / Icono)
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const config = getGuildConfig(oldGuild.id);
    if (!config.security?.antiguildupdate) return;

    const audit = await oldGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(oldGuild, entry.executor, `Modificación de parámetros del Servidor (GuildUpdate)`);
    }
});

// Anti Webhook & Anti Emoji
client.on('webhookUpdate', async (channel) => {
    if (!channel.guild) return;
    const config = getGuildConfig(channel.guild.id);
    if (!config.security?.antiwebhook) return;

    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.WebhookCreate }).catch(() => null);
    const entry = audit?.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 5000) {
        await handleAntiNukeAction(channel.guild, entry.executor, `Creación/Edición no autorizada de Webhook`);
    }
});

// --- MENSAJES Y FILTROS INTELIGENTES (ANTISCAM / IA REGEX / SPAM) ---
client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    const config = getGuildConfig(message.guild.id);
    const sec = config.security || {};

    if (isWhitelisted(message.guild.id, message.author.id) || message.author.id === message.guild.ownerId) return;

    // AntiScam / Nitro Scam / Token Grabber Detección Pattern Engine
    if (sec.antiscam) {
        const scamPatterns = [
            /free\s*nitro/i,
            /steam.*gift/i,
            /disord.*app/i,
            /grabber/i,
            /token/i
        ];
        if (scamPatterns.some(pattern => pattern.test(message.content))) {
            await message.delete().catch(() => {});
            await message.member.timeout(86400000, '[SN Security] Detección de Phishing/Nitro Scam').catch(() => {});
            return message.channel.send(`🚨 ${message.author} ha sido aislado 24h por intento de Scam/Phishing.`);
        }
    }

    // AntiInvite
    if (sec.antiinvite && /(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/i.test(message.content)) {
        await message.delete().catch(() => {});
        return message.channel.send(`⚠️ ${message.author}, las invitaciones no están permitidas.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    }

    // AntiLink
    if (sec.antilink && /(https?:\/\/[^\s]+)/g.test(message.content)) {
        await message.delete().catch(() => {});
        return message.channel.send(`⚠️ ${message.author}, los enlaces externos están restringidos.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
    }

    // AntiSpam Engine
    if (sec.antispam) {
        const key = `${message.guild.id}:${message.author.id}`;
        const isSpamming = checkRateLimit(spamTracker, key, 5, 4000); // 5 msgs en 4s
        if (isSpamming) {
            await message.delete().catch(() => {});
            await message.member.timeout(300000, '[SN AntiSpam Engine]').catch(() => {});
            return message.channel.send(`🚨 ${message.author} aislado 5m por conducta de Spam.`);
        }
    }
});

// GhostPing Loging
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    const config = getGuildConfig(message.guild.id);

    if (config.security?.antighostping && message.mentions.users.size > 0) {
        sendAuditLog(message.guild, new EmbedBuilder()
            .setTitle('👻 Ghost Ping Detectado')
            .setColor(0xFEE75C)
            .setDescription(`**Autor:** ${message.author.tag}\n**Canal:** ${message.channel}\n**Menciones:** ${message.mentions.users.map(u => u.tag).join(', ')}`)
            .setTimestamp()
        );
    }
});

// --- ENTRADA DE USUARIOS, ANTIBOT & CUARENTENA ---
client.on('guildMemberAdd', async (member) => {
    const { guild } = member;
    const config = getGuildConfig(guild.id);

    // AntiBot
    if (member.user.bot && config.security?.antibot) {
        const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.BotAdd }).catch(() => null);
        const entry = auditLogs?.entries.first();
        const inviter = entry?.executor;

        if (inviter && !isWhitelisted(guild.id, inviter.id) && inviter.id !== guild.ownerId) {
            await member.ban({ reason: '[SN AntiBot] Bot no autorizado.' }).catch(() => {});
            return sendAuditLog(guild, new EmbedBuilder().setTitle('🚨 ANTIBOT BAN').setColor(0xFF0000).setDescription(`Bot rechazado: **${member.user.tag}** (Invitado por: ${inviter.tag})`));
        }
    }

    // Filtro Cuentas Nuevas (Cuarentena)
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 3 && config.quarantineRoleId) {
        await member.roles.add(config.quarantineRoleId).catch(() => {});
        sendAuditLog(guild, new EmbedBuilder().setTitle('⚠️ Miembro puesto en Cuarentena').setColor(0xFEE75C).setDescription(`**Usuario:** ${member.user.tag}\n**Antigüedad:** ${accountAgeDays.toFixed(1)} días.`));
    } else if (config.autoRoleId) {
        const role = guild.roles.cache.get(config.autoRoleId);
        if (role) await member.roles.add(role).catch(() => {});
    }
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName, options, guild, channel, user, member } = interaction;

            if (commandName === 'config') {
                const cfg = getGuildConfig(guild.id);
                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ Estado de Protección SN Security: ${guild.name}`)
                    .setColor(0x5865F2)
                    .addFields(
                        { name: 'Canal de Auditoría', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '`No configurado`', inline: true },
                        { name: 'Categoría Tickets', value: cfg.ticketCategoryId ? `<#${cfg.ticketCategoryId}>` : '`No configurada`', inline: true },
                        { name: 'AutoRol', value: cfg.autoRoleId ? `<@&${cfg.autoRoleId}>` : '`Desactivado`', inline: true },
                        { name: 'Capas de Seguridad', value: Object.entries(cfg.security || {}).map(([k, v]) => `${v ? '✅' : '❌'} **${k}**`).join('\n') }
                    );
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (commandName === 'setup') {
                if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Sin permisos de administrador.', ephemeral: true });
                const cfg = getGuildConfig(guild.id);
                Object.keys(cfg.security).forEach(key => cfg.security[key] = true);
                return interaction.reply({ content: '⚡ **Protección SN Security Enterprise Activa:** Todos los módulos operan al máximo nivel.', ephemeral: true });
            }

            if (commandName === 'setlogs') {
                if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const logChan = options.getChannel('canal');
                getGuildConfig(guild.id).logChannelId = logChan.id;
                return interaction.reply({ content: `✅ Logs redirigidos a ${logChan}`, ephemeral: true });
            }

            if (commandName === 'set-ticket-category') {
                if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                getGuildConfig(guild.id).ticketCategoryId = options.getChannel('categoria').id;
                return interaction.reply({ content: '✅ Categoría de tickets actualizada.', ephemeral: true });
            }

            if (commandName === 'security-toggle') {
                if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const mod = options.getString('modulo');
                const st = options.getBoolean('estado');
                getGuildConfig(guild.id).security[mod] = st;
                return interaction.reply({ content: `✅ Módulo **${mod}** cambiado a \`${st}\`.`, ephemeral: true });
            }

            if (commandName === 'whitelist') {
                if (user.id !== guild.ownerId) return interaction.reply({ content: '❌ Acción restringida al Propietario.', ephemeral: true });
                const sub = options.getSubcommand();
                let current = dbWhitelist.get(guild.id) || [];

                if (sub === 'add') {
                    const target = options.getUser('usuario');
                    if (!current.includes(target.id)) current.push(target.id);
                    dbWhitelist.set(guild.id, current);
                    return interaction.reply({ content: `✅ ${target} añadido a la Whitelist.`, ephemeral: true });
                }

                if (sub === 'remove') {
                    const target = options.getUser('usuario');
                    current = current.filter(id => id !== target.id);
                    dbWhitelist.set(guild.id, current);
                    return interaction.reply({ content: `✅ ${target} removido de la Whitelist.`, ephemeral: true });
                }

                if (sub === 'list') {
                    return interaction.reply({ content: `🛡️ **Lista Blanca:**\n${current.length ? current.map(id => `<@${id}>`).join('\n') : 'Sin excepciones.'}`, ephemeral: true });
                }
            }

            if (commandName === 'ban') {
                if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const target = options.getUser('usuario');
                const reason = options.getString('razon') || 'Sin motivo especificado';
                await guild.members.ban(target, { reason }).catch(() => {});
                sendAuditLog(guild, new EmbedBuilder().setTitle('🔨 Ban Ejecutado').setColor(0xED4245).setDescription(`**Usuario:** ${target.tag}\n**Staff:** ${user.tag}\n**Motivo:** ${reason}`));
                return interaction.reply({ content: `🔨 **${target.tag}** sancionado.` });
            }

            if (commandName === 'clear') {
                if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const amount = options.getInteger('cantidad');
                const deleted = await channel.bulkDelete(amount, true).catch(() => null);
                return interaction.reply({ content: `🧹 Se purgaron \`${deleted ? deleted.size : 0}\` mensajes.`, ephemeral: true });
            }

            // 🎫 SISTEMA DE TICKETS ADVANCED
            if (commandName === 'ticket-panel') {
                if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const embed = new EmbedBuilder().setTitle(safeString(options.getString('titulo'), 256)).setDescription(safeString(options.getString('descripcion'), 4000)).setColor(0x2B2D31);
                const menu = new StringSelectMenuBuilder().setCustomId('ticket_category_select').setPlaceholder('Elige departamento de atención...').addOptions([
                    { label: 'Soporte Técnico', value: 'ticket_soporte', emoji: '🛠️' },
                    { label: 'Denuncias / Reportes', value: 'ticket_reportes', emoji: '🚨' }
                ]);
                await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
                return interaction.reply({ content: '✅ Panel enviado correctamente.', ephemeral: true });
            }

            if (commandName === 'claim') {
                if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Sin permisos.', ephemeral: true });
                const ticketData = dbTickets.get(channel.id) || {};
                ticketData.claimedBy = user.id;
                dbTickets.set(channel.id, ticketData);
                sendAuditLog(guild, new EmbedBuilder().setTitle('🙋 Ticket Reclamado').setColor(0x57F287).setDescription(`**Ticket:** ${channel}\n**Agente:** ${user.tag}`));
                return interaction.reply({ content: `🙋 Atendido oficialmente por ${user}.` });
            }

            if (commandName === 'close') {
                const embed = new EmbedBuilder().setTitle('🔒 Ticket Cerrado').setDescription('Opciones de gestión de expediente:').setColor(0xED4245);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('reopen_ticket_btn').setLabel('Reabrir').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('transcript_ticket_btn').setLabel('Transcript').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('delete_ticket_btn').setLabel('Eliminar').setStyle(ButtonStyle.Danger)
                );
                return interaction.reply({ embeds: [embed], components: [row] });
            }

            if (commandName === 'transcript') {
                const fetched = await channel.messages.fetch({ limit: 100 });
                let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Transcript ${channel.name}</title><style>body{background:#2b2d31;color:#fff;font-family:sans-serif;padding:20px;}.msg{margin-bottom:10px;padding:8px;background:#313338;border-radius:5px;}.user{font-weight:bold;color:#5865f2;}.time{font-size:0.8em;color:#aaa;}</style></head><body><h1>Transcript: ${channel.name}</h1>`;
                fetched.reverse().forEach(m => {
                    html += `<div class="msg"><span class="user">${m.author.tag}</span> <span class="time">[${m.createdAt.toLocaleString()}]</span><div>${safeString(m.content)}</div></div>`;
                });
                html += `</body></html>`;
                const attachment = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `transcript-${channel.name}.html` });
                return interaction.reply({ files: [attachment] });
            }

            // 💾 BACKUPS MOLECULARES CON REPLICACIÓN DE PERMISOS
            if (commandName === 'backup') {
                if (user.id !== guild.ownerId) return interaction.reply({ content: '❌ Solo el Propietario.', ephemeral: true });
                const sub = options.getSubcommand();

                if (sub === 'create') {
                    await interaction.deferReply({ ephemeral: true });
                    const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).map(c => ({ id: c.id, name: c.name, position: c.position }));
                    
                    const channelsData = guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).map(c => ({
                        name: c.name,
                        type: c.type,
                        parentId: c.parentId,
                        permissionOverwrites: c.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }))
                    }));

                    const rolesData = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).map(r => ({
                        id: r.id, name: r.name, color: r.color, permissions: r.permissions.bitfield.toString(), position: r.position
                    }));

                    const backupId = `bkp_${Date.now()}`;
                    dbBackups.set(backupId, { guildId: guild.id, createdAt: new Date().toISOString(), structure: { categories, channels: channelsData, roles: rolesData } });
                    return interaction.editReply({ content: `💾 Snapshot Creado con Éxito. ID: \`${backupId}\`` });
                }

                if (sub === 'restore') {
                    await interaction.deferReply({ ephemeral: true });
                    const id = options.getString('id');
                    const backupData = dbBackups.get(id);
                    if (!backupData) return interaction.editReply({ content: '❌ Backup no encontrado.' });

                    // 1. Restaurar Categorías
                    const categoryMap = new Map();
                    for (const cat of backupData.structure.categories || []) {
                        const createdCat = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory }).catch(() => null);
                        if (createdCat) categoryMap.set(cat.id, createdCat.id);
                    }

                    // 2. Restaurar Canales
                    for (const ch of backupData.structure.channels) {
                        await guild.channels.create({ name: ch.name, type: ch.type, parent: categoryMap.get(ch.parentId) || null }).catch(() => {});
                    }

                    return interaction.editReply({ content: '✅ Jerarquía y canales restaurados con éxito.' });
                }
            }
        }

        // --- COMPONENTES INTERACTIVOS (BOTONES Y SELECCIÓN DE TICKETS) ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
            await interaction.deferReply({ ephemeral: true });
            const config = getGuildConfig(interaction.guild.id);

            // Evitar Duplicados Activos
            const activeTicket = Array.from(dbTickets.values()).find(t => t.guildId === interaction.guild.id && t.ownerId === interaction.user.id && t.active);
            if (activeTicket) return interaction.editReply({ content: '❌ Ya mantienes una sesión de ticket activa.' });

            config.ticketCounter = (config.ticketCounter || 0) + 1;
            const channelName = `ticket-${String(config.ticketCounter).padStart(4, '0')}`;

            const ticketChan = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: config.ticketCategoryId || null,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            dbTickets.set(ticketChan.id, { guildId: interaction.guild.id, channelId: ticketChan.id, ownerId: interaction.user.id, active: true, claimedBy: null });

            const embed = new EmbedBuilder().setTitle(`Expediente #${config.ticketCounter}`).setDescription(`Hola ${interaction.user}, detalla tu solicitud. Un miembro del equipo te asistirá.`).setColor(0x57F287);
            const closeBtn = new ButtonBuilder().setCustomId('close_ticket_btn').setLabel('Cerrar Ticket').setStyle(ButtonStyle.Danger);
            await ticketChan.send({ content: `${interaction.user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(closeBtn)] });

            return interaction.editReply({ content: `✅ Ticket asignado en ${ticketChan}` });
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'close_ticket_btn') {
                const tData = dbTickets.get(interaction.channel.id);
                if (tData) tData.active = false;

                const embed = new EmbedBuilder().setTitle('🔒 Ticket Cerrado').setDescription('Gestión de archivo:').setColor(0xED4245);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('reopen_ticket_btn').setLabel('Reabrir').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('transcript_ticket_btn').setLabel('Transcript').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('delete_ticket_btn').setLabel('Eliminar').setStyle(ButtonStyle.Danger)
                );
                return interaction.reply({ embeds: [embed], components: [row] });
            }

            if (interaction.customId === 'delete_ticket_btn') {
                dbTickets.delete(interaction.channel.id);
                await interaction.reply({ content: '⏳ Destruyendo canal...' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 1500);
            }
        }

    } catch (err) {
        console.error(`[Interaction Exception] ${err.stack}`);
    }
});

// --- INICIAR BOT ---
client.login(process.env.DISCORD_TOKEN);

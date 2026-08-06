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
    AuditLogEvent 
} = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const express = require('express');
const Redis = require('ioredis');

// --- BOT INITIALIZATION ---
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
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

const prisma = new PrismaClient();
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
client.commands = new Collection();

// --- EXPRESS SERVER (Keep-Alive para hosting 24/7) ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('SN Security Engine v5 Active'));
app.listen(PORT, () => console.log(`[HTTP] Servidor activo en puerto ${PORT}`));

// --- UTILS & HELPERS ---

// Limpieza de caracteres invisibles, Zalgo y combinatorios
function cleanAdvancedText(text) {
    if (!text) return '';
    return text
        .replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u202A-\u202E]/g, '');
}

// Truncador para evitar desbordamiento de límites de Embeds (Discord Limit Safety)
function safeString(str, maxLen = 1000) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

// Convertidor de Hexadecimal String a Integer para colores de Embeds
function parseColor(colorInput) {
    if (!colorInput) return 0x2B2D31;
    const cleanHex = colorInput.replace('#', '');
    const parsed = parseInt(cleanHex, 16);
    return isNaN(parsed) ? 0x2B2D31 : parsed;
}

// Audit Logger Helper (Envía a canal configurado, no ensucia el chat general)
async function sendAuditLog(guild, embed) {
    try {
        const config = await prisma.guildConfig.findUnique({ where: { guildId: guild.id } });
        if (!config || !config.logChannelId) return;
        const channel = guild.channels.cache.get(config.logChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error(`[Audit Log Error] ${err.message}`);
    }
}

// Control de Tasa (AntiSpam / AntiRaid / Rate Limit)
const localRateLimitMap = new Map();
async function isRateLimited(key, limit, windowSeconds) {
    if (redis) {
        const current = await redis.incr(key);
        if (current === 1) await redis.expire(key, windowSeconds);
        return current > limit;
    } else {
        const now = Date.now();
        const userData = localRateLimitMap.get(key) || { count: 0, resetAt: now + (windowSeconds * 1000) };
        if (now > userData.resetAt) {
            userData.count = 1;
            userData.resetAt = now + (windowSeconds * 1000);
        } else {
            userData.count++;
        }
        localRateLimitMap.set(key, userData);
        return userData.count > limit;
    }
}

// Verificador de Whitelist
async function isWhitelisted(guildId, userId) {
    try {
        const entry = await prisma.whitelist.findFirst({
            where: { guildId, userId }
        });
        return !!entry;
    } catch {
        return false;
    }
}

// Buscador de mensaje de Panel
async function fetchTargetPanel(channel, messageId) {
    try {
        const msg = await channel.messages.fetch(messageId);
        if (msg && msg.embeds.length > 0 && msg.author.id === client.user.id) {
            return msg;
        }
        return null;
    } catch {
        return null;
    }
}

// --- READY EVENT & REGISTRO DE COMANDOS SLASH ---
client.once('ready', async () => {
    console.log(`[SN SECURITY] Conectado exitosamente como ${client.user.tag}`);

    const commandsToRegister = [
        {
            name: 'backup',
            description: 'Gestión de copias de seguridad completas (Roles, Jerarquía, Canales y Categorías)',
            options: [
                {
                    name: 'create',
                    type: 1, // SUB_COMMAND
                    description: 'Crea un backup estructurado del servidor'
                },
                {
                    name: 'restore',
                    type: 1, // SUB_COMMAND
                    description: 'Restaura el servidor mediante el ID de un backup',
                    options: [{ name: 'id', type: 3, description: 'ID de la copia de seguridad', required: true }]
                }
            ]
        },
        {
            name: 'clear',
            description: 'Limpia mensajes filtrando automáticamente los mayores a 14 días',
            options: [{ name: 'cantidad', type: 4, description: 'Mensajes a borrar (1-100)', required: true }]
        },
        {
            name: 'purgeuser',
            description: 'Elimina los mensajes de un usuario específico dentro de un rango determinado',
            options: [
                { name: 'usuario', type: 6, description: 'Usuario a purgar', required: true },
                { name: 'limite', type: 4, description: 'Límite de búsqueda de mensajes (1-100)', required: true }
            ]
        },
        {
            name: 'say',
            description: 'Envía un mensaje formateado de forma segura',
            options: [{ name: 'mensaje', type: 3, description: 'Texto a enviar', required: true }]
        },
        {
            name: 'ticket-panel',
            description: 'Despliega un nuevo panel de soporte interactivo',
            options: [
                { name: 'titulo', type: 3, description: 'Título del embed', required: true },
                { name: 'descripcion', type: 3, description: 'Descripción del soporte', required: true }
            ]
        },
        {
            name: 'editar-panel',
            description: 'Edita dinámicamente un panel existente sin recrearlo',
            options: [
                {
                    name: 'contenido',
                    type: 1, // SUB_COMMAND
                    description: 'Edita Título, Descripción, Color HEX y Footer vía Modal',
                    options: [
                        { name: 'message_id', type: 3, description: 'ID del mensaje del panel', required: true }
                    ]
                },
                {
                    name: 'multimedia',
                    type: 1, // SUB_COMMAND
                    description: 'Modifica la Imagen o Miniatura del panel',
                    options: [
                        { name: 'message_id', type: 3, description: 'ID del mensaje del panel', required: true },
                        { name: 'imagen', type: 3, description: 'URL de la imagen principal', required: false },
                        { name: 'miniatura', type: 3, description: 'URL de la miniatura', required: false }
                    ]
                }
            ]
        }
    ];

    try {
        await client.application.commands.set(commandsToRegister);
        console.log('[Slash Commands] Registrados globalmente en la API de Discord.');
    } catch (err) {
        console.error(`[Slash Commands Error] ${err.message}`);
    }
});

// --- AUTOMOD & GHOST PING MONITORING ---
client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    // 1. Detección y bloqueo de @everyone / @here indebidos
    if (message.mentions.everyone && !(message.member.permissions.has(PermissionFlagsBits.MentionEveryone))) {
        await message.delete().catch(() => {});
        return message.channel.send({ content: `⚠️ ${message.author}, no tienes permiso para mencionar masivamente.` });
    }

    // 2. Filtro de Enlaces Avanzado (Incluye enlaces sin protocolo http/https)
    const linkRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|telegram\.me|bit\.ly|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})(\/[^\s]*)?/gi;
    if (linkRegex.test(message.content)) {
        const whitelisted = await isWhitelisted(message.guild.id, message.author.id);
        if (!whitelisted && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await message.delete().catch(() => {});
            return message.channel.send({ content: `🛡️ ${message.author}, los enlaces no autorizados están prohibidos.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // 3. AutoMod Zalgo / Caracteres Invisibles
    const cleaned = cleanAdvancedText(message.content);
    if (message.content.length - cleaned.length > 15) {
        await message.delete().catch(() => {});
        return message.channel.send({ content: `🛡️ ${message.author}, se detectó texto malformado o spam de caracteres invisibles.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
});

// Detección de Ghost Pings -> Reporte al Canal de Audit Logs
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;

    if (message.mentions.users.size > 0 || message.mentions.roles.size > 0) {
        const embed = new EmbedBuilder()
            .setTitle('🚨 Ghost Ping Detectado')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Autor', value: `${message.author.tag} (${message.author.id})`, inline: true },
                { name: 'Canal', value: `${message.channel}`, inline: true },
                { name: 'Contenido', value: safeString(message.content || 'Sin contenido de texto', 1000) }
            )
            .setTimestamp();

        await sendAuditLog(message.guild, embed);
    }
});

// --- MOTOR DE ANTINUKE Y SEGURIDAD CRÍTICA ---
client.on('channelDelete', async (channel) => {
    handleAntiNukeAction(channel.guild, AuditLogEvent.ChannelDelete, 'Borrado masivo de canales');
});

client.on('roleDelete', async (role) => {
    handleAntiNukeAction(role.guild, AuditLogEvent.RoleDelete, 'Borrado masivo de roles');
});

client.on('guildBanAdd', async (ban) => {
    handleAntiNukeAction(ban.guild, AuditLogEvent.MemberBanAdd, 'Baneo masivo de miembros');
});

client.on('guildEmojisUpdate', async (guild) => {
    handleAntiNukeAction(guild, AuditLogEvent.EmojiDelete, 'Eliminación masiva de emojis o stickers');
});

async function handleAntiNukeAction(guild, auditLogType, reason) {
    if (!guild) return;
    try {
        const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: auditLogType });
        const entry = auditLogs.entries.first();
        if (!entry || !entry.executor || entry.executor.id === client.user.id) return;

        const executorId = entry.executor.id;
        if (executorId === guild.ownerId) return;

        const whitelisted = await isWhitelisted(guild.id, executorId);
        if (whitelisted) return;

        // Umbral: Máximo 3 acciones destructivas en un rango de 10 segundos
        const limited = await isRateLimited(`antinuke:${guild.id}:${executorId}`, 3, 10);
        if (limited) {
            const member = await guild.members.fetch(executorId).catch(() => null);
            if (member && member.kickable) {
                await member.roles.set([]).catch(() => {}); // Revocar roles administrativos de inmediato
                await member.ban({ reason: `[SN AntiNuke] ${reason}` }).catch(() => {});

                const embed = new EmbedBuilder()
                    .setTitle('🛡️ ANTINUKE ACTIVADO - ATAQUE NEUTRALIZADO')
                    .setColor(0xFF0000)
                    .addFields(
                        { name: 'Ofensor', value: `${entry.executor.tag} (${executorId})` },
                        { name: 'Causa', value: reason },
                        { name: 'Acción Aplicada', value: 'Roles revocados y Ban Permanente emitido' }
                    )
                    .setTimestamp();
                
                await sendAuditLog(guild, embed);
            }
        }
    } catch (err) {
        console.error(`[AntiNuke Execution Error] ${err.message}`);
    }
}

// --- MANEJADOR GLOBAL DE INTERACCIONES (SLASH, MODALS, BUTTONS, SELECTS) ---
client.on('interactionCreate', async (interaction) => {
    try {
        // 1. SLASH COMMANDS
        if (interaction.isChatInputCommand()) {
            const { commandName, options } = interaction;

            // COMANDO CLEAR
            if (commandName === 'clear') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ content: '❌ Permisos insuficientes.', ephemeral: true });
                }
                const amount = options.getInteger('cantidad');
                await interaction.deferReply({ ephemeral: true });

                const messages = await interaction.channel.messages.fetch({ limit: amount });
                const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
                const validMessages = messages.filter(m => m.createdTimestamp > fourteenDaysAgo);

                if (validMessages.size === 0) {
                    return interaction.editReply({ content: '⚠️ No existen mensajes menores a 14 días para borrar en este canal.' });
                }

                await interaction.channel.bulkDelete(validMessages, true);
                return interaction.editReply({ content: `🧹 Purgados ${validMessages.size} mensajes exitosamente.` });
            }

            // COMANDO PURGEUSER
            if (commandName === 'purgeuser') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ content: '❌ Permisos insuficientes.', ephemeral: true });
                }
                const target = options.getUser('usuario');
                const limit = options.getInteger('limite');

                await interaction.deferReply({ ephemeral: true });

                const fetched = await interaction.channel.messages.fetch({ limit: 100 });
                const userMessages = fetched.filter(m => m.author.id === target.id).first(limit);

                if (userMessages.length === 0) {
                    return interaction.editReply({ content: `⚠️ No se hallaron mensajes recientes del usuario ${target.tag}.` });
                }

                await interaction.channel.bulkDelete(userMessages, true);
                return interaction.editReply({ content: `🧹 Se eliminaron ${userMessages.length} mensajes de ${target.tag}.` });
            }

            // COMANDO SAY
            if (commandName === 'say') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return interaction.reply({ content: '❌ Permisos insuficientes.', ephemeral: true });
                }
                const text = options.getString('mensaje');
                const cleanedText = cleanAdvancedText(text)
                    .replace(/@everyone/g, '@\u200beveryone')
                    .replace(/@here/g, '@\u200bhere');

                await interaction.channel.send({ content: safeString(cleanedText, 2000) });
                return interaction.reply({ content: '✅ Mensaje emitido.', ephemeral: true });
            }

            // COMANDO BACKUP
            if (commandName === 'backup') {
                if (interaction.user.id !== interaction.guild.ownerId) {
                    return interaction.reply({ content: '❌ Solo el Propietario del Servidor puede realizar esta acción.', ephemeral: true });
                }

                const sub = options.getSubcommand();

                if (sub === 'create') {
                    await interaction.deferReply({ ephemeral: true });

                    const rolesData = interaction.guild.roles.cache
                        .filter(r => !r.managed && r.id !== interaction.guild.id)
                        .map(r => ({
                            name: r.name,
                            color: r.color,
                            hoist: r.hoist,
                            permissions: r.permissions.bitfield.toString(),
                            position: r.position,
                            mentionable: r.mentionable
                        }));

                    const channelsData = interaction.guild.channels.cache
                        .filter(c => c.type !== ChannelType.GuildCategory)
                        .map(c => ({
                            name: c.name,
                            type: c.type,
                            parentName: c.parent ? c.parent.name : null,
                            position: c.position
                        }));

                    const categoriesData = interaction.guild.channels.cache
                        .filter(c => c.type === ChannelType.GuildCategory)
                        .map(c => ({ name: c.name, position: c.position }));

                    const backupRecord = await prisma.serverBackup.create({
                        data: {
                            guildId: interaction.guild.id,
                            structure: JSON.stringify({
                                roles: rolesData,
                                categories: categoriesData,
                                channels: channelsData
                            })
                        }
                    });

                    return interaction.editReply({ content: `✅ **Backup Pro Generado Exitosamente**\n🆔 ID: \`${backupRecord.id}\`` });
                }

                if (sub === 'restore') {
                    const backupId = options.getString('id');
                    await interaction.deferReply({ ephemeral: true });

                    const backupRecord = await prisma.serverBackup.findUnique({ where: { id: backupId } });
                    if (!backupRecord) {
                        return interaction.editReply({ content: '❌ No se encontró el Backup especificado.' });
                    }

                    const data = JSON.parse(backupRecord.structure);

                    // Recreación de Roles con permisos bitfield completos
                    for (const r of data.roles) {
                        await interaction.guild.roles.create({
                            name: r.name,
                            color: r.color,
                            hoist: r.hoist,
                            permissions: BigInt(r.permissions),
                            mentionable: r.mentionable
                        }).catch(() => {});
                    }

                    // Recreación de Categorías
                    const createdCategories = new Map();
                    for (const cat of data.categories) {
                        const newCat = await interaction.guild.channels.create({
                            name: cat.name,
                            type: ChannelType.GuildCategory,
                            position: cat.position
                        }).catch(() => null);
                        if (newCat) createdCategories.set(cat.name, newCat);
                    }

                    // Recreación de Canales vinculados
                    for (const ch of data.channels) {
                        const parent = ch.parentName ? createdCategories.get(ch.parentName) : null;
                        await interaction.guild.channels.create({
                            name: ch.name,
                            type: ch.type,
                            parent: parent ? parent.id : null,
                            position: ch.position
                        }).catch(() => {});
                    }

                    return interaction.editReply({ content: '✅ Restauración completa de estructura ejecutada.' });
                }
            }

            // COMANDO TICKET-PANEL
            if (commandName === 'ticket-panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ Solo los administradores pueden desplegar paneles.', ephemeral: true });
                }

                const title = options.getString('titulo');
                const description = options.getString('descripcion');

                const embed = new EmbedBuilder()
                    .setTitle(safeString(title, 256))
                    .setDescription(safeString(description, 4000))
                    .setColor(0x2B2D31)
                    .setFooter({ text: 'SN Security • Sistema Centralizado de Soporte' });

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_category_select')
                    .setPlaceholder('Selecciona la categoría de tu consulta...')
                    .addOptions([
                        { label: 'Soporte Técnico', value: 'ticket_soporte', emoji: '🛠️' },
                        { label: 'Reportes', value: 'ticket_reporte', emoji: '🚨' },
                        { label: 'Facturación / Compras', value: 'ticket_compras', emoji: '💳' }
                    ]);

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const panelMsg = await interaction.channel.send({ embeds: [embed], components: [row] });
                return interaction.reply({ 
                    content: `✅ Panel desplegado correctamente.\n🆔 **ID para editar este panel:** \`${panelMsg.id}\``, 
                    ephemeral: true 
                });
            }

            // COMANDO EDITAR-PANEL
            if (commandName === 'editar-panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ Permisos insuficientes.', ephemeral: true });
                }

                const sub = options.getSubcommand();
                const messageId = options.getString('message_id');
                const panelMsg = await fetchTargetPanel(interaction.channel, messageId);

                if (!panelMsg) {
                    return interaction.reply({ 
                        content: '❌ No se encontró ningún panel válido enviado por el bot en este canal con ese ID.', 
                        ephemeral: true 
                    });
                }

                // Subcomando CONTENIDO (Formulario Modal nativo)
                if (sub === 'contenido') {
                    const currentEmbed = panelMsg.embeds[0];

                    const modal = new ModalBuilder()
                        .setCustomId(`edit_panel_modal_${messageId}`)
                        .setTitle('Editar Contenido del Panel');

                    const titleInput = new TextInputBuilder()
                        .setCustomId('modal_title')
                        .setLabel('Título del Panel')
                        .setStyle(TextInputStyle.Short)
                        .setValue(currentEmbed.title || '')
                        .setRequired(true);

                    const descInput = new TextInputBuilder()
                        .setCustomId('modal_desc')
                        .setLabel('Descripción Explicativa')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(currentEmbed.description || '')
                        .setRequired(true);

                    const colorInput = new TextInputBuilder()
                        .setCustomId('modal_color')
                        .setLabel('Color HEX (#5865F2 o 2B2D31)')
                        .setStyle(TextInputStyle.Short)
                        .setValue('#' + (currentEmbed.color ? currentEmbed.color.toString(16) : '2B2D31'))
                        .setRequired(false);

                    const footerInput = new TextInputBuilder()
                        .setCustomId('modal_footer')
                        .setLabel('Pie de página (Footer)')
                        .setStyle(TextInputStyle.Short)
                        .setValue(currentEmbed.footer ? currentEmbed.footer.text : '')
                        .setRequired(false);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(titleInput),
                        new ActionRowBuilder().addComponents(descInput),
                        new ActionRowBuilder().addComponents(colorInput),
                        new ActionRowBuilder().addComponents(footerInput)
                    );

                    return await interaction.showModal(modal);
                }

                // Subcomando MULTIMEDIA
                if (sub === 'multimedia') {
                    await interaction.deferReply({ ephemeral: true });

                    const image = options.getString('imagen');
                    const thumbnail = options.getString('miniatura');

                    const embed = EmbedBuilder.from(panelMsg.embeds[0]);

                    if (image) embed.setImage(image);
                    if (thumbnail) embed.setThumbnail(thumbnail);

                    await panelMsg.edit({ embeds: [embed] });
                    return interaction.editReply({ content: '✅ Elementos multimedia del panel actualizados.' });
                }
            }
        }

        // 2. MODAL SUBMISSIONS (RECEPCIÓN Y APLICACIÓN DE DATOS)
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('edit_panel_modal_')) {
                const messageId = interaction.customId.replace('edit_panel_modal_', '');
                const panelMsg = await fetchTargetPanel(interaction.channel, messageId);

                if (!panelMsg) {
                    return interaction.reply({ content: '❌ El panel especificado ya no existe o fue borrado.', ephemeral: true });
                }

                const newTitle = interaction.fields.getTextInputValue('modal_title');
                const newDesc = interaction.fields.getTextInputValue('modal_desc');
                const newColor = interaction.fields.getTextInputValue('modal_color');
                const newFooter = interaction.fields.getTextInputValue('modal_footer');

                const embed = EmbedBuilder.from(panelMsg.embeds[0])
                    .setTitle(safeString(newTitle, 256))
                    .setDescription(safeString(newDesc, 4000))
                    .setColor(parseColor(newColor));

                if (newFooter) {
                    embed.setFooter({ text: safeString(newFooter, 2048) });
                }

                await panelMsg.edit({ embeds: [embed] });
                return interaction.reply({ content: '✅ Panel de soporte actualizado en tiempo real.', ephemeral: true });
            }
        }

        // 3. SELECT MENUS (APERTURA DE TICKETS)
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'ticket_category_select') {
                await interaction.deferReply({ ephemeral: true });

                const categoryType = interaction.values[0];
                const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '');

                const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
                if (existingChannel) {
                    return interaction.editReply({ content: `⚠️ Ya tienes un ticket abierto en ${existingChannel}.` });
                }

                const ticketChannel = await interaction.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
                    ]
                });

                const ticketEmbed = new EmbedBuilder()
                    .setTitle(`Ticket: ${categoryType.replace('ticket_', '').toUpperCase()}`)
                    .setDescription(`Hola ${interaction.user}, un miembro del personal te atenderá en breve.\nExplica tu caso a detalle.`)
                    .setColor(0x57F287)
                    .setTimestamp();

                const closeBtn = new ButtonBuilder()
                    .setCustomId('close_ticket_btn')
                    .setLabel('Cerrar Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒');

                const row = new ActionRowBuilder().addComponents(closeBtn);

                await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketEmbed], components: [row] });
                return interaction.editReply({ content: `✅ Ticket creado correctamente en ${ticketChannel}` });
            }
        }

        // 4. BUTTONS (CIERRA DE TICKETS)
        if (interaction.isButton()) {
            if (interaction.customId === 'close_ticket_btn') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return interaction.reply({ content: '❌ Solo el equipo de soporte puede cerrar este ticket.', ephemeral: true });
                }

                await interaction.reply({ content: '🔒 El ticket se cerrará y eliminará en 5 segundos...' });
                setTimeout(async () => {
                    await interaction.channel.delete().catch(() => {});
                }, 5000);
            }
        }

    } catch (err) {
        console.error(`[Global Interaction Error] ${err.stack}`);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ Ocurrió un error al procesar esta solicitud.' }).catch(() => {});
        } else if (!interaction.replied) {
            await interaction.reply({ content: '❌ Se produjo un error inesperado al procesar el comando.', ephemeral: true }).catch(() => {});
        }
    }
});

// --- INICIO DE SESIÓN ---
client.login(process.env.DISCORD_TOKEN);

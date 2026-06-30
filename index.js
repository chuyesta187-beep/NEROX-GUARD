// =====================================================================
// 🛡️ NEROX GUARD — APOCALYPSE SECURITY, AUTOMOD & AUDIT CORE v5.5
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
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    AuditLogEvent,
    AutoModRuleTriggerType,
    AutoModRuleEventType,
    AutoModRuleActionType,
    ChannelType,
    Partials
} = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildAutoModerationConfiguration,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const TOKEN = process.env.TOKEN || "TU_BOT_TOKEN_AQUÍ";
const CLIENT_ID = "1520579136609976432";

const DB_FILE = './database.json';
let db = {};
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { db = {}; }
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4)); }

const staffActionTracker = new Map();
const recentJoins = new Map();
const antiSpamTracker = new Map();

function initGuild(guildId) {
    if (!db[guildId]) {
        db[guildId] = {
            antiNuke: 'Activado',
            antiRaid: 'Activado',
            antiLink: 'Activado',
            antiInvite: 'Activado',
            antiSpam: 'Activado',
            antiBot: 'Activado',
            antiWebhook: 'Activado',
            antiRolePermissions: 'Activado',
            antiServerUpdate: 'Activado',
            modoEmergencia: 'Desactivado',
            logsChannel: null,
            whitelist: []
        };
        saveDB();
    }
    if (!db[guildId].whitelist) db[guildId].whitelist = [];
    return db[guildId];
}

// Emisor de logs premium estilo AMOLED/Black
async function enviarLog(guild, embedColor, titulo, descripcion, iconoUrl = null) {
    const config = initGuild(guild.id);
    if (!config.logsChannel) return;
    const canal = guild.channels.cache.get(config.logsChannel);
    if (!canal) return;

    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Auditoría — ${titulo}`)
        .setDescription(descripcion)
        .setColor(embedColor)
        .setTimestamp()
        .setFooter({ text: 'Nerox Guard Intelligence System', iconURL: client.user.displayAvatarURL() });

    if (iconoUrl) embed.setThumbnail(iconoUrl);
    await canal.send({ embeds: [embed] }).catch(() => {});
}

function generarPanelEmbed(config, guildName) {
    const e = (modulo) => config[modulo] === 'Activado' ? '🟢 `Activado`' : '🔴 `Desactivado`';
    return new EmbedBuilder()
        .setColor(config.modoEmergencia === 'Activado' ? 0xFF0000 : 0x0B0B0B)
        .setTitle('🛡️ CENTRAL DE CONTROL MAESTRA — NEROX GUARD v5.5')
        .setDescription(`Panel de administración global para la protección activa de **${guildName}**.`)
        .addFields(
            { name: '🎛️ Núcleo Anti-Nuke y Servidor', value: `• **Anti-Nuke Status:** ${e('antiNuke')}\n• **Anti-Server Update:** ${e('antiServerUpdate')}\n• **Anti-Role Perms:** ${e('antiRolePermissions')}\n• **Modo Emergencia:** ${config.modoEmergencia === 'Activado' ? '🚨 `EMERGENCIA ACTIVA` 🚨' : '🟢 `OPERACIÓN NORMAL`'}`, inline: false },
            { name: '🛡️ Filtros Activos de Chat & Perímetro', value: `• **Anti-Links:** ${e('antiLink')}\n• **Anti-Invites:** ${e('antiInvite')}\n• **Anti-Spam Mensajes:** ${e('antiSpam')}\n• **Anti-Bot Extractor:** ${e('antiBot')}\n• **Anti-Webhooks:** ${e('antiWebhook')}`, inline: false },
            { name: '📦 Logística & Listas Blancas', value: `• **Usuarios Whitelist:** \`[ ${config.whitelist.length} Miembros ]\`\n• **Canal de Auditoría:** ${config.logsChannel ? `<#${config.logsChannel}>` : '❌ `SIN CONFIGURAR`'}`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Nerox Guard Enterprise Edition', iconURL: client.user.displayAvatarURL() });
}

function construirComponentesPanel(config) {
    const e = (modulo) => config[modulo] === 'Activado' ? '🟢' : '🔴';
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_antiNuke').setLabel(`${e('antiNuke')} Anti-Nuke`).setStyle(config.antiNuke === 'Activado' ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('btn_antiRaid').setLabel(`${e('antiRaid')} Anti-Raid`).setStyle(config.antiRaid === 'Activado' ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('btn_modoEmergencia').setLabel(config.modoEmergencia === 'Activado' ? '⚡ Emergencia: ON' : '⚪ Emergencia: OFF').setStyle(config.modoEmergencia === 'Activado' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('menu_protecciones')
                .setPlaceholder('🛡️ Alternar Módulos de Defensa Activa')
                .addOptions([
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiNuke')} Anti-Nuke Global`).setValue('toggle_antiNuke'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiRaid')} Anti-Raid Joins`).setValue('toggle_antiRaid'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiLink')} Anti-Links Activo`).setValue('toggle_antiLink'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiInvite')} Anti-Invites Activo`).setValue('toggle_antiInvite'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiSpam')} Anti-Spam Reactor`).setValue('toggle_antiSpam'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiBot')} Anti-Bot No Verificado`).setValue('toggle_antiBot'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiWebhook')} Anti-Webhook Inject`).setValue('toggle_antiWebhook'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiRolePermissions')} Anti-Role Modification`).setValue('toggle_antiRolePermissions'),
                    new StringSelectMenuOptionBuilder().setLabel(`${e('antiServerUpdate')} Anti-Server Alteration`).setValue('toggle_antiServerUpdate')
                ])
        ),
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('menu_configuracion')
                .setPlaceholder('⚙️ Gestión de Infraestructura y Respaldos')
                .addOptions([
                    new StringSelectMenuOptionBuilder().setLabel('📜 Enlazar Canal de Logs Actual').setValue('setup_logs').setEmoji('📜'),
                    new StringSelectMenuOptionBuilder().setLabel('💾 Crear Backup de Precisión Total').setValue('setup_backup_create').setEmoji('💾'),
                    new StringSelectMenuOptionBuilder().setLabel('📥 Inyectar / Cargar Backup Completo').setValue('setup_backup_load').setEmoji('📥'),
                    new StringSelectMenuOptionBuilder().setLabel('⚡ Sincronizar Reglas de AutoMod').setValue('setup_automod').setEmoji('⚡')
                ])
        )
    ];
}

const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('🛡️ Abre el panel central de configuración de Nerox Guard.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('whitelist').setDescription('🔒 Administra los usuarios exentos de las mitigaciones del bot.')
        .addSubcommand(sub => sub.setName('add').setDescription('Añadir un miembro a la lista blanca.').addUserOption(opt => opt.setName('usuario').setDescription('Usuario a eximir').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remover un miembro de la lista blanca.').addUserOption(opt => opt.setName('usuario').setDescription('Usuario a revocar').setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard Enterprise v5.5 completamente operativo para: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
});

client.on('interactionCreate', async interaction => {
    const { guildId, guild, commandName, customId, member, options } = interaction;
    if (!guildId) return;
    const config = initGuild(guildId);

    if (interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu()) {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Acceso denegado: Requieres **Administrador**.', ephemeral: true });
        }
    }

    if (interaction.isChatInputCommand()) {
        if (commandName === 'setup') {
            return interaction.reply({ embeds: [generarPanelEmbed(config, guild.name)], components: construirComponentesPanel(config), ephemeral: true });
        }
        if (commandName === 'whitelist') {
            const sub = options.getSubcommand();
            const objetivo = options.getUser('usuario');
            if (sub === 'add') {
                if (config.whitelist.includes(objetivo.id)) return interaction.reply({ content: `ℹ️ Ya está en la whitelist.`, ephemeral: true });
                config.whitelist.push(objetivo.id); saveDB();
                await enviarLog(guild, 0x00FF00, 'Whitelist Modificada', `El Administrador <@${member.id}> añadió a <@${objetivo.id}>.`);
                return interaction.reply({ content: `✅ <@${objetivo.id}> fue blindado.`, ephemeral: true });
            }
            if (sub === 'remove') {
                if (!config.whitelist.includes(objetivo.id)) return interaction.reply({ content: `❌ No está en la whitelist.`, ephemeral: true });
                config.whitelist = config.whitelist.filter(id => id !== objetivo.id); saveDB();
                await enviarLog(guild, 0xFF0000, 'Whitelist Modificada', `El Administrador <@${member.id}> revocó la protección de <@${objetivo.id}>.`);
                return interaction.reply({ content: `⚠️ <@${objetivo.id}> fue retirado de la whitelist.`, ephemeral: true });
            }
        }
    }

    if (interaction.isButton() && customId.startsWith('btn_')) {
        const modulo = customId.replace('btn_', '');
        if (config[modulo] !== undefined) {
            config[modulo] = config[modulo] === 'Activado' ? 'Desactivado' : 'Activado'; saveDB();
            return interaction.update({ embeds: [generarPanelEmbed(config, guild.name)], components: construirComponentesPanel(config) });
        }
    }

    if (interaction.isStringSelectMenu()) {
        const seleccion = interaction.values[0];
        if (seleccion.startsWith('toggle_')) {
            const modulo = seleccion.replace('toggle_', '');
            if (config[modulo] !== undefined) {
                config[modulo] = config[modulo] === 'Activado' ? 'Desactivado' : 'Activado'; saveDB();
                return interaction.update({ embeds: [generarPanelEmbed(config, guild.name)], components: construirComponentesPanel(config) });
            }
        }
        if (seleccion === 'setup_logs') {
            config.logsChannel = interaction.channel.id; saveDB();
            await interaction.reply({ content: `📜 Canal de logs enlazado en <#${interaction.channel.id}>.`, ephemeral: true });
            return interaction.message.edit({ embeds: [generarPanelEmbed(config, guild.name)], components: construirComponentesPanel(config) });
        }
        if (seleccion === 'setup_backup_create') {
            const tiposFiltrados = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory];
            const cacheCanales = guild.channels.cache.filter(c => tiposFiltrados.includes(c.type)).map(c => ({
                name: c.name, type: c.type, parentName: c.parent ? c.parent.name : null, position: c.position, topic: c.topic || null, nsfw: c.nsfw || false,
                permissionOverwrites: c.permissionOverwrites?.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) || []
            }));
            fs.writeFileSync(`./backups_${guild.id}.json`, JSON.stringify(cacheCanales, null, 4));
            await interaction.reply({ content: `💾 Snapshot estructural guardada localmente con éxito.`, ephemeral: true });
        }
        if (seleccion === 'setup_backup_load') {
            const path = `./backups_${guild.id}.json`;
            if (!fs.existsSync(path)) return interaction.reply({ content: `❌ No hay backups guardados para este servidor.`, ephemeral: true });
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: `❌ Falta de privilegios de API: (Manage Channels).`, ephemeral: true });
            if (guild.channels.cache.size >= 500) return interaction.reply({ content: '❌ Servidor saturado en el límite estricto de 500 canales.', ephemeral: true });

            await interaction.reply({ content: `📥 Reconstruyendo nodos de infraestructura...`, ephemeral: true });
            const datosCanales = JSON.parse(fs.readFileSync(path, 'utf-8'));

            for (const ch of datosCanales.filter(c => c.type === ChannelType.GuildCategory)) {
                let existe = guild.channels.cache.find(e => e.name === ch.name && e.type === ch.type);
                if (!existe && guild.channels.cache.size < 500) {
                    try { 
                        await guild.channels.create({ name: ch.name, type: ch.type, position: ch.position, permissionOverwrites: ch.permissionOverwrites.map(o => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })), reason: '[🛡️ Nerox Production Restore]' }); 
                    } catch (err) { console.error(err); }
                }
            }
            await guild.channels.fetch();
            for (const ch of datosCanales.filter(c => c.type !== ChannelType.GuildCategory)) {
                let existe = guild.channels.cache.find(e => e.name === ch.name && e.type === ch.type);
                if (!existe && guild.channels.cache.size < 500) {
                    try {
                        const padre = ch.parentName ? guild.channels.cache.find(p => p.name === ch.parentName && p.type === ChannelType.GuildCategory) : null;
                        await guild.channels.create({ name: ch.name, type: ch.type, topic: ch.topic, nsfw: ch.nsfw, parent: padre ? padre.id : null, permissionOverwrites: ch.permissionOverwrites.map(o => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })), reason: '[🛡️ Nerox Production Restore]' });
                    } catch (err) { console.error(err); }
                }
            }
        }
        if (seleccion === 'setup_automod') {
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '❌ Falta permiso base: Gestionar Servidor.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            try {
                const rules = await guild.autoModerationRules.fetch().catch(() => guild.autoModerationRules.cache);
                if (rules.some(r => r.name === 'Nerox Guard AutoMod — Bloqueo Ilegal')) return interaction.followUp({ content: 'ℹ️ Las directivas nativas ya se encuentran activas.' });
                await guild.autoModerationRules.create({
                    name: 'Nerox Guard AutoMod — Bloqueo Ilegal', eventType: AutoModRuleEventType.MessageSend, triggerType: AutoModRuleTriggerType.Keyword,
                    triggerMetadata: { keywordFilter: ['*raidear*', '*raid*', '*nuke*'] }, actions: [{ type: AutoModRuleActionType.BlockMessage, metadata: { customMessage: 'Acción bloqueada por los escudos defensivos de Nerox Guard.' } }]
                });
                return interaction.followUp({ content: '✅ Firewall nativo inyectado correctamente.' });
            } catch { return interaction.followUp({ content: '❌ Error al escribir directiva en los servidores de Discord.' }); }
        }
    }
});

// =====================================================================
// 🛰️ CAPTURA FLUIDA DE CHAT, REGISTRO DE ANUNCIOS Y CONTROL DE SPAM
// =====================================================================

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const config = initGuild(message.guild.id);

    // INTERCEPTOR EXCLUSIVO: ANUNCIOS OFICIALES EMITIDOS POR EL OWNER ABSOLUTO
    if (message.channel.type === ChannelType.GuildAnnouncement) {
        if (message.author.id === message.guild.ownerId) {
            return await enviarLog(
                message.guild, 
                0x5865F2, 
                '📢 Nuevo Anuncio Publicado (Owner)', 
                `👤 **Autor:** ${message.author}\n📍 **Canal:** ${message.channel}\n\n📝 **Contenido:**\n${message.content || '*Sin texto legible*'}`
            );
        }
    }

    if (config.whitelist.includes(message.author.id) || message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    if (config.antiInvite === 'Activado' && /(discord\.(gg|me|io)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9\-]+/i.test(message.content)) {
        if (message.deletable) await message.delete().catch(() => {});
        return message.channel.send({ content: `❌ <@${message.author.id}>, las invitaciones externas están restringidas.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
    if (config.antiLink === 'Activado' && /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b/i.test(message.content)) {
        if (message.deletable) await message.delete().catch(() => {});
        return message.channel.send({ content: `❌ <@${message.author.id}>, los enlaces web de origen externo están restringidos.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
    if (config.antiSpam === 'Activado' && message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        const ahora = Date.now(); const key = `${message.guild.id}-${message.author.id}`;
        let tiempos = antiSpamTracker.get(key) || []; tiempos.push(ahora);
        tiempos = tiempos.filter(t => ahora - t < 5000); antiSpamTracker.set(key, tiempos);
        if (tiempos.length >= 6) {
            antiSpamTracker.delete(key);
            await message.member.timeout(60000, '[🛡️ Nerox Anti-Spam Reactor]').catch(() => {});
            await enviarLog(message.guild, 0xFFFF00, 'Aislamiento de Spam', `El usuario <@${message.author.id}> fue silenciado temporalmente por saturar chat.`);
        }
    }
});

// Logs: Mensajes Eliminados (Soporta Partial)
client.on('messageDelete', async message => {
    if (!message.guild || message.author?.bot || message.id === db[message.guild.id]?.logsChannel) return;
    const contenido = message.content ? message.content : "*Contenido no almacenado en caché local o multimedia externa*";
    await enviarLog(message.guild, 0xFF0000, 'Mensaje Eliminado', `👤 **Usuario:** ${message.author || 'Desconocido'}\n📍 **Canal:** ${message.channel}\n💬 **Mensaje original:**\n${contenido}`);
});

// Logs: Mensajes Editados (Soporta Partial)
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
    await enviarLog(newMsg.guild, 0xFFFF00, 'Mensaje Editado', `👤 **Usuario:** ${newMsg.author}\n📍 **Canal:** ${newMsg.channel}\n\n📝 **Antes:**\n${oldMsg.content || '*Contenido no cacheado*'}\n\n📝 **Después:**\n${newMsg.content || '*Sin texto legible*'}`);
});

// Logs: Control de Flujo Perimetral e Ingreso de Miembros (Anti-Raid / Anti-Bot integrado)
client.on('guildMemberAdd', async member => {
    const config = initGuild(member.guild.id);
    await enviarLog(member.guild, 0x00FF00, 'Usuario Entró', `📥 **Miembro:** ${member.user.tag} (\`${member.id}\`)\n📅 **Creación:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`);

    if (member.user.bot && config.antiBot === 'Activado' && !config.whitelist.includes(member.id) && member.kickable) {
        await member.kick("Nerox Anti-Bot: Cuentas automatizadas no autorizadas.").catch(() => {});
        return enviarLog(member.guild, 0xFF0000, 'Filtro Anti-Bot', `Expulsado bot no verificado por la whitelist: **${member.user.tag}**.`);
    }
    if (config.antiRaid === 'Activado') {
        const ahora = Date.now(); const serverJoins = recentJoins.get(member.guild.id) || []; serverJoins.push(ahora);
        const filtrados = serverJoins.filter(t => ahora - t < 10000); recentJoins.set(member.guild.id, filtrados);
        if (filtrados.length >= 5 && config.modoEmergencia !== 'Activado') {
            config.modoEmergencia = 'Activado'; saveDB();
            await enviarLog(member.guild, 0xFF0000, '🚨 ALERTA: ANTI-RAID DETECTADO', 'Más de 5 ingresos detectados en un lapso de 10s. Modo Emergencia bloqueado automáticamente.');
        }
    }
});

client.on('guildMemberRemove', async member => {
    await enviarLog(member.guild, 0xFF3333, 'Usuario Salió', `📤 **Miembro:** ${member.user.tag} (\`${member.id}\`) abandonó o fue expulsado del servidor.`);
});

// Logs: Cambios de Apodos y Perfiles de Usuario
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
        await enviarLog(newMember.guild, 0x3498DB, 'Apodo Cambiado', `👤 **Miembro:** ${newMember.user}\n📝 **Antes:** \`${oldMember.nickname || 'Sin Apodo'}\`\n📝 **Después:** \`${newMember.nickname || 'Sin Apodo'}\``);
    }
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
        const agregados = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id)).map(r => r.name).join(', ');
        const removidos = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id)).map(r => r.name).join(', ');
        let cambios = '';
        if (agregados) cambios += `🟢 **Otorgado(s):** ${agregados}\n`;
        if (removidos) cambios += `🔴 **Revocado(s):** ${removidos}\n`;
        await enviarLog(newMember.guild, 0x9B59B6, 'Roles Actualizados (Miembro)', `👤 **Miembro:** ${newMember.user}\n${cambios}`);
    }
});

// Logs: Baneos y Desbaneos Directos de la API
client.on('guildBanAdd', async ban => {
    await enviarLog(ban.guild, 0x721C24, 'Usuario Baneado', `🔨 **Usuario:** ${ban.user.tag} (\`${ban.user.id}\`)\n📝 **Razón de API:** ${ban.reason || 'Ninguna especificada.'}`);
});

client.on('guildBanRemove', async ban => {
    await enviarLog(ban.guild, 0x28A745, 'Usuario Desbaneado', `🔓 **Usuario:** ${ban.user.tag} (\`${ban.user.id}\`) ha sido removido de la lista de vetos.`);
});

// Logs: Control Estructural de Canales
client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    await enviarLog(channel.guild, 0x2ECC71, 'Canal Creado', `📁 **Nombre:** \`${channel.name}\`\n🔠 **Tipo:** \`${channel.type}\`\n🆔 **Mención:** ${channel}`);
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    await enviarLog(channel.guild, 0xE74C3C, 'Canal Eliminado', `🗑️ **Nombre:** \`${channel.name}\`\n🆔 **ID original:** \`${channel.id}\``);
});

// Logs: Control Estructural de Roles
client.on('roleCreate', async role => {
    await enviarLog(role.guild, 0x2ECC71, 'Rol Creado', `🛡️ **Rol:** ${role} (\`${role.name}\`)\n🆔 **ID:** \`${role.id}\``);
});

client.on('roleDelete', async role => {
    await enviarLog(role.guild, 0xE74C3C, 'Rol Eliminado', `🗑️ **Nombre original:** \`${role.name}\`\n🆔 **ID original:** \`${role.id}\``);
});

// Logs: Gestión de Emojis Internos
client.on('emojiCreate', async emoji => {
    await enviarLog(emoji.guild, 0x1ABC9C, 'Emoji Añadido', `😀 **Emoji:** ${emoji} (Nombre: \`${emoji.name}\`)\n🆔 **ID:** \`${emoji.id}\``);
});

client.on('emojiDelete', async emoji => {
    await enviarLog(emoji.guild, 0x95A5A6, 'Emoji Eliminado', `🗑️ **Nombre original:** \`${emoji.name}\`\n🆔 **ID:** \`${emoji.id}\``);
});

// Logs: Telemetría de Canales de Voz
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!oldState.channelId && newState.channelId) {
        await enviarLog(newState.guild, 0x1F8B4C, 'Conexión a Voz', `🔊 ${newState.member.user} ingresó al canal de voz ${newState.channel}.`);
    } else if (oldState.channelId && !newState.channelId) {
        await enviarLog(oldState.guild, 0xE74C3C, 'Desconexión de Voz', `🔇 ${oldState.member.user} abandonó el canal de voz \`${oldState.channel?.name}\`.`);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        await enviarLog(newState.guild, 0x34495E, 'Cambio de Canal de Voz', `🔄 ${newState.member.user} se movió:\n**De:** \`${oldState.channel?.name}\`\n**A:** ${newState.channel}`);
    }
});

// =====================================================================
// 🏎️ ANALIZADOR INDUSTRIAL ANTI-NUKE CON INTERCEPTOR DE AUDITLOGS
// =====================================================================
async function verificarSospechoso(guild, executorId, actionType) {
    const config = initGuild(guild.id);
    if (executorId === client.user.id || executorId === guild.ownerId || config.whitelist.includes(executorId)) return false;
    if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) return false;

    const key = `${guild.id}-${executorId}`;
    if (!staffActionTracker.has(key)) {
        staffActionTracker.set(key, { count: 1, time: Date.now() }); return false;
    }

    const data = staffActionTracker.get(key);
    if ((Date.now() - data.time) < 7000) {
        data.count++;
        if (data.count >= 5 && config.antiNuke === 'Activado') {
            try {
                await guild.bans.create(executorId, { reason: `[🛡️ Nerox Anti-Nuke] Gatillado por: ${actionType}` });
                await enviarLog(guild, 0xFF0000, '🔨 SANCIÓN ANTI-NUKE INYECTADA', `El administrador <@${executorId}> ha sido **Baneado** de inmediato tras ejecutar múltiples acciones sospechosas de: **${actionType}**.`);
                staffActionTracker.delete(key); return true;
            } catch {}
        }
    } else { staffActionTracker.set(key, { count: 1, time: Date.now() }); }
    return false;
}

client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
    const { action, executorId, changes } = auditLogEntry;
    const config = initGuild(guild.id);

    if (action === AuditLogEvent.ChannelDelete) await verificarSospechoso(guild, executorId, "Eliminación masiva de canales");
    if (action === AuditLogEvent.ChannelCreate) await verificarSospechoso(guild, executorId, "Creación masiva de canales");
    if (action === AuditLogEvent.RoleDelete) await verificarSospechoso(guild, executorId, "Eliminación masiva de roles");
    if (action === AuditLogEvent.WebhookCreate && config.antiWebhook === 'Activado') await verificarSospechoso(guild, executorId, "Creación ilícita de webhooks");
    if (action === AuditLogEvent.MemberKick) await verificarSospechoso(guild, executorId, "Expulsión masiva de miembros");
    if (action === AuditLogEvent.MemberBanAdd) await verificarSospechoso(guild, executorId, "Baneos masivos maliciosos");
    
    if (action === AuditLogEvent.GuildUpdate) {
        const cambioNombre = changes.find(c => c.key === 'name');
        if (cambioNombre) {
            await enviarLog(guild, 0xD35400, 'Ajustes del Servidor Cambiados', `⚙️ Un administrador (\`ID: ${executorId}\`) modificó los parámetros base del servidor.\n📝 **Nombre Anterior:** \`${cambioNombre.old}\`\n📝 **Nombre Nuevo:** \`${cambioNombre.new}\``);
        }
        if (config.antiServerUpdate === 'Activado') await verificarSospechoso(guild, executorId, "Modificación de parámetros del Servidor");
    }

    if (action === AuditLogEvent.RoleUpdate) {
        const cambioPermisos = changes.find(c => c.key === 'permissions');
        if (cambioPermisos) {
            await enviarLog(guild, 0xE67E22, 'Permisos de Rol Alterados', `⚠️ Un rol estratégico fue editado por el usuario \`${executorId}\`.\nBitfield anterior: \`${cambioPermisos.old}\` -> Bitfield nuevo: \`${cambioPermisos.new}\``);
        }
        if (config.antiRolePermissions === 'Activado') await verificarSospechoso(guild, executorId, "Alteración de permisos jerárquicos");
    }
});

client.login(TOKEN);

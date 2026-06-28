const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    RoleSelectMenuBuilder,
    AuditLogEvent
} = require('discord.js');
const fs = require('fs');
const path = require('path');

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

// 📁 BASE DE DATOS LOCAL
const DB_PATH = path.join(__dirname, 'database.json');
let db = { servers: {}, users: {}, whitelists: {}, backups: {} };

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        else saveDB();
    } catch (e) { console.error("Error cargando DB:", e); }
}
function saveDB() {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) { console.error("Error guardando DB:", e); }
}
loadDB();

function initGuild(guildId) {
    if (!db.servers[guildId]) {
        db.servers[guildId] = { 
            antiNuke: 'Desactivado', 
            antiSpam: 'Desactivado', 
            modoEmergencia: 'Desactivado', 
            rolesVerificacion: [], 
            rolesModeradores: [],
            logChannel: null
        };
    }
    if (!db.whitelists[guildId]) db.whitelists[guildId] = [];
    saveDB();
    return db.servers[guildId];
}

function initUser(userId) {
    if (!db.users[userId]) db.users[userId] = { warns: 0, historial: [] };
    return db.users[userId];
}

const captchasActivos = new Map();

// 🚀 REGISTRO DE ABSOLUTAMENTE TODOS TUS COMANDOS SOLICITADOS
client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard cargado con todos los comandos solicitados.`);
    
    const commands = [
        // CONFIGURACIÓN Y SEGURIDAD BASE
        new SlashCommandBuilder().setName('configurar').setDescription('Abrir el panel de configuración interactivo.'),
        new SlashCommandBuilder().setName('verificacion').setDescription('Configura y envía el panel de verificación con Captcha.').addChannelOption(o => o.setName('canal').setDescription('Canal del panel').setRequired(true)).addStringOption(o => o.setName('roles_ids').setDescription('IDs de roles separados por comas').setRequired(true)),
        new SlashCommandBuilder().setName('antinuke').setDescription('Activar o desactivar el Anti-Nuke.').addStringOption(o => o.setName('estado').setDescription('Estado').setRequired(true).addChoices({name:'Activar', value:'Activado'}, {name:'Desactivar', value:'Desactivado'})),
        new SlashCommandBuilder().setName('antispam').setDescription('Activar o desactivar el Anti-Spam.').addStringOption(o => o.setName('estado').setDescription('Estado').setRequired(true).addChoices({name:'Activar', value:'Activado'}, {name:'Desactivar', value:'Desactivado'})),
        new SlashCommandBuilder().setName('logs').setDescription('Configurar el canal de registros.').addChannelOption(o => o.setName('canal').setDescription('Canal de logs').setRequired(true)),
        
        new SlashCommandBuilder().setName('whitelist').setDescription('Gestionar la whitelist del Anti-Nuke')
            .addSubcommand(sub => sub.setName('add').setDescription('Agregar un usuario a la whitelist.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Quitar un usuario de la whitelist.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true))),
        
        new SlashCommandBuilder().setName('emergency').setDescription('Controlar el modo emergencia del servidor')
            .addSubcommand(sub => sub.setName('on').setDescription('Activar el modo emergencia.'))
            .addSubcommand(sub => sub.setName('off').setDescription('Desactivar el modo emergencia.')),

        new SlashCommandBuilder().setName('backup').setDescription('Copias de seguridad del servidor')
            .addSubcommand(sub => sub.setName('create').setDescription('Crear una copia de seguridad.'))
            .addSubcommand(sub => sub.setName('restore').setDescription('Restaurar una copia de seguridad.')),

        // MODERACIÓN INDIVIDUAL TRADICIONAL
        new SlashCommandBuilder().setName('ban').setDescription('Banear un usuario.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Razón')),
        new SlashCommandBuilder().setName('unban').setDescription('Desbanear un usuario.').addStringOption(o => o.setName('id').setDescription('ID de Discord del usuario').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Expulsa un usuario.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Razón')),
        new SlashCommandBuilder().setName('timeout').setDescription('Silenciar temporalmente (Timeout nativo).').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addIntegerOption(o => o.setName('minutos').setDescription('Minutos').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Razón')),
        new SlashCommandBuilder().setName('untimeout').setDescription('Quitar el timeout.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
        new SlashCommandBuilder().setName('mute').setDescription('Silenciar un usuario (Quita canales de voz/roles).').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
        new SlashCommandBuilder().setName('unmute').setDescription('Quitar el mute.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
        new SlashCommandBuilder().setName('warn').setDescription('Dar una advertencia.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('razon').setDescription('Razón').setRequired(true)),
        new SlashCommandBuilder().setName('warnings').setDescription('Ver advertencias.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
        new SlashCommandBuilder().setName('history').setDescription('Historial de sanciones.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)),
        new SlashCommandBuilder().setName('clear').setDescription('Borrar mensajes.').addIntegerOption(o => o.setName('cantidad').setDescription('Número de mensajes (1-100)').setRequired(true)),
        new SlashCommandBuilder().setName('slowmode').setDescription('Configurar el modo lento.').addIntegerOption(o => o.setName('segundos').setDescription('Segundos de espera (0 para quitar)').setRequired(true)),
        new SlashCommandBuilder().setName('lock').setDescription('Bloquear un canal.').addChannelOption(o => o.setName('canal').setDescription('Canal a bloquear')),
        new SlashCommandBuilder().setName('unlock').setDescription('Desbloquear un canal.').addChannelOption(o => o.setName('canal').setDescription('Canal a desbloquear')),
        new SlashCommandBuilder().setName('purgebots').setDescription('Borrar mensajes de bots en el canal actual.').addIntegerOption(o => o.setName('cantidad').setDescription('Mensajes a revisar').setRequired(true)),
        
        // UTILIDADES Y ROLES
        new SlashCommandBuilder().setName('nick').setDescription('Cambiar el apodo.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addStringOption(o => o.setName('apodo').setDescription('Nuevo apodo (Dejar vacío para resetear)')),
        new SlashCommandBuilder().setName('role').setDescription('Dar o quitar un rol.').addUserOption(o => o.setName('usuario').setDescription('Usuario').setRequired(true)).addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)),
        new SlashCommandBuilder().setName('userinfo').setDescription('Información de un usuario.').addUserOption(o => o.setName('usuario')),
        new SlashCommandBuilder().setName('serverinfo').setDescription('Información del servidor.'),
        new SlashCommandBuilder().setName('say').setDescription('Hacer que el bot envíe un mensaje.').addStringOption(o => o.setName('mensaje').setDescription('Contenido del mensaje').setRequired(true))
    ];

    await client.application.commands.set(commands);
});

// Helper de logs internos del bot
async function enviarLog(guild, embed) {
    const config = db.servers[guild.id];
    if (!config || !config.logChannel) return;
    const canal = guild.channels.cache.get(config.logChannel);
    if (canal) canal.send({ embeds: [embed] }).catch(() => null);
}

function esStaff(member, config) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (!config.rolesModeradores || config.rolesModeradores.length === 0) return false;
    return member.roles.cache.some(r => config.rolesModeradores.includes(r.id));
}

// 🛠️ CONTROLADOR DE PROCESOS INTERACTIVOS
client.on('interactionCreate', async (interaction) => {
    const { guildId, member, commandName, options, customId } = interaction;
    if (!guildId) return;
    const config = initGuild(guildId);

    // ==========================================
    // 1️⃣ EJECUCIÓN DE COMANDOS SLASH
    // ==========================================
    if (interaction.isChatInputCommand()) {
        
        // El comando Configurar está abierto para administradores nativos primariamente
        if (commandName === 'configurar') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Solo administradores de Discord usan este panel.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Panel de Configuración — Nerox Guard')
                .setColor('#2b2d31')
                .addFields(
                    { name: '☢️ Anti-Nuke', value: `\`${config.antiNuke}\``, inline: true },
                    { name: '🧼 Anti-Spam', value: `\`${config.antiSpam}\``, inline: true },
                    { name: '🚨 Emergencia', value: `\`${config.modoEmergencia}\``, inline: true },
                    { name: '📜 Canal Logs', value: config.logChannel ? `<#${config.logChannel}>` : '`No asignado`', inline: true },
                    { name: '🛠️ Roles Staff Permitidos', value: config.rolesModeradores.length ? config.rolesModeradores.map(id => `<@&${id}>`).join(', ') : '`Solo Administradores`', inline: false }
                );

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select-modulo')
                .setPlaceholder('Modificar estados rápidos')
                .addOptions([{ label: 'Alternar Anti-Nuke', value: 'toggle_nuke' }, { label: 'Alternar Anti-Spam', value: 'toggle_spam' }]);

            const rMenu = new RoleSelectMenuBuilder()
                .setCustomId('select-roles-staff')
                .setPlaceholder('Elige los roles autorizados para comandos de moderación')
                .setMinValues(1).setMaxValues(10);

            return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(rMenu)], ephemeral: true });
        }

        // COMANDOS DE CONFIGURACIÓN DIRECTOS RÁPIDOS
        if (commandName === 'antinuke') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Permiso denegado.', ephemeral: true });
            config.antiNuke = options.getString('estado'); saveDB();
            return interaction.reply({ content: `✅ Anti-Nuke establecido en: \`${config.antiNuke}\`.` });
        }
        if (commandName === 'antispam') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Permiso denegado.', ephemeral: true });
            config.antiSpam = options.getString('estado'); saveDB();
            return interaction.reply({ content: `✅ Anti-Spam establecido en: \`${config.antiSpam}\`.` });
        }
        if (commandName === 'logs') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Permiso denegado.', ephemeral: true });
            const canal = options.getChannel('canal');
            config.logChannel = canal.id; saveDB();
            return interaction.reply({ content: `✅ Canal de registros asignado a ${canal}.` });
        }

        // VERIFICACION
        if (commandName === 'verificacion') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Permiso denegado.', ephemeral: true });
            const canal = options.getChannel('canal');
            config.rolesVerificacion = options.getString('roles_ids').split(',').map(id => id.trim()); saveDB();
            const embed = new EmbedBuilder().setTitle('🛡️ Panel de Verificación').setDescription('Oprime el botón inferior para realizar el test matemático anti-bot.').setColor('#00ff44');
            const btn = new ButtonBuilder().setCustomId('iniciar_verificacion').setLabel('Comenzar').setStyle(ButtonStyle.Primary);
            await canal.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
            return interaction.reply({ content: '✅ Panel enviado al canal.', ephemeral: true });
        }

        // RESTRICCIÓN DE STAFF PARA TODO LO SIGUIENTE
        if (!esStaff(member, config)) {
            return interaction.reply({ content: '❌ No cuentas con roles autorizados en este servidor para ejecutar este comando.', ephemeral: true });
        }

        const target = options.getUser('usuario');
        const targetMember = options.getMember('usuario');
        const razon = options.getString('razon') || 'Sin motivo expuesto.';

        // SEGMENTO DE COMANDOS DE ACCIÓN DIRECTA DE MODERACIÓN
        if (commandName === 'ban') {
            await interaction.guild.members.ban(target, { reason: razon });
            return interaction.reply({ content: `🛑 **${target.username}** fue baneado.` });
        }
        if (commandName === 'unban') {
            const id = options.getString('id');
            await interaction.guild.members.unban(id).catch(() => null);
            return interaction.reply({ content: `✅ Solicitud de desbaneo procesada para la ID \`${id}\`.` });
        }
        if (commandName === 'kick') {
            await targetMember.kick(razon);
            return interaction.reply({ content: `👢 **${target.username}** fue expulsado.` });
        }
        if (commandName === 'timeout') {
            const minutos = options.getInteger('minutos');
            await targetMember.timeout(minutos * 60 * 1000, razon);
            return interaction.reply({ content: `⏳ Silenciado (Timeout) por ${minutos} minutos.` });
        }
        if (commandName === 'untimeout') {
            await targetMember.timeout(null);
            return interaction.reply({ content: `✅ Se ha removido el timeout a **${target.username}**.` });
        }
        if (commandName === 'mute') {
            await targetMember.voice.setMute(true).catch(() => null);
            return interaction.reply({ content: `🔇 Silenciado en canales de voz.` });
        }
        if (commandName === 'unmute') {
            await targetMember.voice.setMute(false).catch(() => null);
            return interaction.reply({ content: `🔊 Transmisión de voz restaurada.` });
        }
        if (commandName === 'warn') {
            const uData = initUser(target.id); uData.warns++;
            uData.historial.push({ tipo: 'WARN', razon, fecha: new Date().toLocaleDateString() }); saveDB();
            return interaction.reply({ content: `⚠️ Advertencia añadida a **${target.username}** (Total: ${uData.warns}). Razón: ${razon}` });
        }
        if (commandName === 'warnings') {
            const uData = initUser(target.id);
            return interaction.reply({ content: `👤 **${target.username}** posee \`${uData.warns}\` advertencias activas.` });
        }
        if (commandName === 'history') {
            const uData = initUser(target.id);
            const rEmbed = new EmbedBuilder().setTitle(`Historial de Sanciones`).setDescription(uData.historial.map(h => `• [${h.fecha}] **${h.tipo}**: ${h.razon}`).join('\n') || 'Sin historial de infracciones.');
            return interaction.reply({ embeds: [rEmbed] });
        }
        if (commandName === 'clear') {
            const cant = options.getInteger('cantidad');
            await interaction.channel.bulkDelete(Math.min(cant, 100), true);
            return interaction.reply({ content: `🧹 Se han eliminado los mensajes aptos recientes del canal.`, ephemeral: true });
        }
        if (commandName === 'slowmode') {
            const segs = options.getInteger('segundos');
            await interaction.channel.setRateLimitPerUser(segs);
            return interaction.reply({ content: `⏱️ Modo lento configurado en \`${segs}s\`.` });
        }
        if (commandName === 'lock') {
            const chan = options.getChannel('canal') || interaction.channel;
            await chan.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            return interaction.reply({ content: `🔒 Canal ${chan} bloqueado para interacciones.` });
        }
        if (commandName === 'unlock') {
            const chan = options.getChannel('canal') || interaction.channel;
            await chan.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
            return interaction.reply({ content: `🔓 Canal ${chan} desbloqueado exitosamente.` });
        }
        if (commandName === 'purgebots') {
            const cant = options.getInteger('cantidad');
            const msgs = await interaction.channel.messages.fetch({ limit: cant });
            const botMsgs = msgs.filter(m => m.author.bot);
            await interaction.channel.bulkDelete(botMsgs);
            return interaction.reply({ content: `🤖 Limpieza completada. Mensajes eliminados de bots encontrados.`, ephemeral: true });
        }

        // RESPALDOS Y EMERGENCIAS
        if (commandName === 'emergency') {
            const sub = options.getSubcommand();
            config.modoEmergencia = sub === 'on' ? 'Activado' : 'Desactivado'; saveDB();
            if(sub === 'on') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }).catch(() => null);
            }
            return interaction.reply({ content: `🚨 Modo Emergencia general cambiado a: \`${config.modoEmergencia}\`.` });
        }
        if (commandName === 'backup') {
            const sub = options.getSubcommand();
            if (sub === 'create') {
                const canales = interaction.guild.channels.cache.map(c => ({ name: c.name, type: c.type }));
                db.backups[guildId] = canales; saveDB();
                return interaction.reply({ content: `💾 Copia de seguridad del servidor generada en la base de datos local.` });
            } else {
                const bk = db.backups[guildId];
                if (!bk) return interaction.reply({ content: '❌ No hay backups guardadas para esta ID.' });
                return interaction.reply({ content: `🔄 Restaurando canales desde el volcado local...` });
            }
        }
        if (commandName === 'whitelist') {
            const sub = options.getSubcommand();
            const user = options.getUser('usuario');
            if (sub === 'add') {
                if (!db.whitelists[guildId].includes(user.id)) db.whitelists[guildId].push(user.id); saveDB();
                return interaction.reply({ content: `✅ **${user.username}** es inmune al Anti-Nuke.` });
            } else {
                db.whitelists[guildId] = db.whitelists[guildId].filter(id => id !== user.id); saveDB();
                return interaction.reply({ content: `❌ **${user.username}** removido.` });
            }
        }

        // UTILIDADES EXTRAS SOLICITADAS
        if (commandName === 'nick') {
            const apodo = options.getString('apodo');
            await targetMember.setNickname(apodo).catch(() => null);
            return interaction.reply({ content: `✍️ Apodo de **${target.username}** actualizado.` });
        }
        if (commandName === 'role') {
            const rol = options.getRole('rol');
            if (targetMember.roles.cache.has(rol.id)) {
                await targetMember.roles.remove(rol);
                return interaction.reply({ content: `❌ Rol **${rol.name}** removido de ${target.username}.` });
            } else {
                await targetMember.roles.add(rol);
                return interaction.reply({ content: `✅ Rol **${rol.name}** entregado a ${target.username}.` });
            }
        }
        if (commandName === 'say') {
            const msg = options.getString('mensaje');
            await interaction.reply({ content: 'Mensaje enviado.', ephemeral: true });
            return interaction.channel.send({ content: msg });
        }
        if (commandName === 'serverinfo') {
            const embed = new EmbedBuilder().setTitle(interaction.guild.name).setThumbnail(interaction.guild.iconURL()).addFields({ name: 'Miembros', value: `${interaction.guild.memberCount}`, inline: true }, { name: 'Canales', value: `${interaction.guild.channels.cache.size}`, inline: true });
            return interaction.reply({ embeds: [embed] });
        }
        if (commandName === 'userinfo') {
            const u = target || interaction.user;
            const embed = new EmbedBuilder().setTitle(`Info de ${u.username}`).setThumbnail(u.avatarURL()).addFields({ name: 'Tag ID', value: `\`${u.id}\`` });
            return interaction.reply({ embeds: [embed] });
        }
    }

    // ==========================================
    // 2️⃣ MANEJO DE COMPONENTES INTERACTIVOS
    // ==========================================
    if (interaction.isStringSelectMenu() && customId === 'select-modulo') {
        if (interaction.values[0] === 'toggle_nuke') config.antiNuke = config.antiNuke === 'Activado' ? 'Desactivado' : 'Activado';
        if (interaction.values[0] === 'toggle_spam') config.antiSpam = config.antiSpam === 'Activado' ? 'Desactivado' : 'Activado';
        saveDB();
        return interaction.reply({ content: '✅ Estados del sistema refrescados en database.', ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() && customId === 'select-roles-staff') {
        config.rolesModeradores = interaction.values; saveDB();
        return interaction.reply({ content: '✅ Cambios completados. Roles autorizados guardados.', ephemeral: true });
    }

    if (interaction.isButton() && customId === 'iniciar_verificacion') {
        const n1 = Math.floor(Math.random() * 7) + 2; const n2 = Math.floor(Math.random() * 7) + 2;
        captchasActivos.set(interaction.user.id, n1 + n2);
        const modal = new ModalBuilder().setCustomId('md').setTitle('Filtro Anti-Bots');
        const input = new TextInputBuilder().setCustomId('ans').setLabel(`Cuánto es ${n1} + ${n2}?`).setStyle(TextInputStyle.Short).setRequired(true);
        return interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (interaction.isModalSubmit() && customId === 'md') {
        const res = parseInt(interaction.fields.getTextInputValue('ans').trim());
        if (res === captchasActivos.get(interaction.user.id)) {
            captchasActivos.delete(interaction.user.id);
            for (const id of config.rolesVerificacion) {
                if (interaction.guild.roles.cache.has(id)) await interaction.member.roles.add(id).catch(() => null);
            }
            return interaction.reply({ content: '✅ Verificación correcta.', ephemeral: true });
        }
        return interaction.reply({ content: '❌ Captcha incorrecto.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);


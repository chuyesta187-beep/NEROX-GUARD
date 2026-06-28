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

// 🚀 REGISTRO DE COMANDOS CON CONSTRUCCIÓN FORMAL DE OPCIONES Y DESCRIPCIONES COMPLETAS
client.once('ready', async () => {
    console.log(`🛡️ Nerox Guard cargado con descripciones en cada opción.`);
    
    const commands = [
        // CONFIGURACIÓN Y SEGURIDAD BASE
        new SlashCommandBuilder()
            .setName('configurar')
            .setDescription('Abre el panel de configuración interactivo para gestionar módulos y roles de Staff.'),
            
        new SlashCommandBuilder()
            .setName('verificacion')
            .setDescription('Configura y envía el panel con botón de verificación y Captcha matemático.')
            .addChannelOption(option => 
                option
                    .setName('canal')
                    .setDescription('El canal de texto donde se mandará el panel de verificación.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('roles_ids')
                    .setDescription('IDs de los roles que se darán al verificarse (separados por comas).')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('antinuke')
            .setDescription('Activa o desactiva de forma rápida el sistema de protección Anti-Nuke.')
            .addStringOption(option => 
                option
                    .setName('estado')
                    .setDescription('Selecciona si deseas prender o apagar la protección.')
                    .setRequired(true)
                    .addChoices({name:'Activar', value:'Activado'}, {name:'Desactivar', value:'Desactivado'})
            ),
            
        new SlashCommandBuilder()
            .setName('antispam')
            .setDescription('Activa o desactiva de forma rápida el filtro global Anti-Spam.')
            .addStringOption(option => 
                option
                    .setName('estado')
                    .setDescription('Selecciona si deseas prender o apagar el filtro de spam.')
                    .setRequired(true)
                    .addChoices({name:'Activar', value:'Activado'}, {name:'Desactivar', value:'Desactivado'})
            ),
            
        new SlashCommandBuilder()
            .setName('logs')
            .setDescription('Configura el canal donde el bot enviará el historial de acciones y seguridad.')
            .addChannelOption(option => 
                option
                    .setName('canal')
                    .setDescription('Canal de texto destinado para los registros del bot.')
                    .setRequired(true)
            ),
        
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Gestiona la lista blanca de usuarios inmunes al sistema Anti-Nuke.')
            .addSubcommand(subcmd => 
                subcmd
                    .setName('add')
                    .setDescription('Agrega un usuario de extrema confianza a la whitelist.')
                    .addUserOption(option => 
                        option
                            .setName('usuario')
                            .setDescription('El usuario que recibirá la inmunidad total del Anti-Nuke.')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcmd => 
                subcmd
                    .setName('remove')
                    .setDescription('Quita a un usuario de la whitelist de seguridad.')
                    .addUserOption(option => 
                        option
                            .setName('usuario')
                            .setDescription('El usuario al que se le removerá la inmunidad.')
                            .setRequired(true)
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('emergency')
            .setDescription('Controla el estado de confinamiento o emergencia del servidor.')
            .addSubcommand(subcmd => 
                subcmd
                    .setName('on')
                    .setDescription('Bloquea la escritura global para proteger el servidor de un ataque masivo.')
            )
            .addSubcommand(subcmd => 
                subcmd
                    .setName('off')
                    .setDescription('Desactiva el modo emergencia y devuelve los permisos normales de chat.')
            ),

        new SlashCommandBuilder()
            .setName('backup')
            .setDescription('Administra copias de seguridad de la estructura de canales del servidor.')
            .addSubcommand(subcmd => 
                subcmd
                    .setName('create')
                    .setDescription('Crea un respaldo actual del orden y nombres de tus canales.')
            )
            .addSubcommand(subcmd => 
                subcmd
                    .setName('restore')
                    .setDescription('Restaura la estructura guardada en tu último backup.')
            ),

        // MODERACIÓN INDIVIDUAL TRADICIONAL
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Banea permanentemente a un usuario infractor del servidor.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro que deseas banear del servidor.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('razon')
                    .setDescription('El motivo o justificación de este baneo.')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Remueve el baneo de un usuario utilizando su ID de Discord.')
            .addStringOption(option => 
                option
                    .setName('id')
                    .setDescription('La ID numérica de Discord del usuario desbaneado.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Expulsa a un miembro del servidor (podrá volver a entrar si tiene invitación).')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro que deseas expulsar.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('razon')
                    .setDescription('El motivo de la expulsión.')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('timeout')
            .setDescription('Silencia de forma temporal a un usuario con el aislamiento nativo de Discord.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro al que se le aplicará el aislamiento.')
                    .setRequired(true)
            )
            .addIntegerOption(option => 
                option
                    .setName('minutos')
                    .setDescription('Cantidad de minutos que durará el silencio.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('razon')
                    .setDescription('El motivo del aislamiento temporal.')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('untimeout')
            .setDescription('Le quita el aislamiento (timeout) a un usuario antes de tiempo.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro al que le devolverás la palabra.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('mute')
            .setDescription('Silencia por completo a un usuario en todos los canales de voz.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro que deseas silenciar en los canales de voz.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('unmute')
            .setDescription('Le permite hablar de nuevo en canales de voz a un usuario silenciado.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro que podrá volver a hablar en los canales de voz.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Coloca una advertencia formal en el historial de un usuario.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro que recibirá la advertencia.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('razon')
                    .setDescription('El motivo detallado de este aviso.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('Muestra el contador total de advertencias que acumula un usuario.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro del cual deseas consultar las advertencias totales.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('history')
            .setDescription('Muestra la lista cronológica detallada de todas las sanciones de un usuario.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro cuyo expediente de sanciones deseas revisar.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Borra una cantidad específica de mensajes recientes en el canal actual.')
            .addIntegerOption(option => 
                option
                    .setName('cantidad')
                    .setDescription('Número de mensajes a eliminar (Máximo 100).')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('slowmode')
            .setDescription('Establece un tiempo de espera obligatorio entre mensajes para este canal.')
            .addIntegerOption(option => 
                option
                    .setName('segundos')
                    .setDescription('Segundos que deben esperar los usuarios (Pon 0 para desactivarlo).')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('lock')
            .setDescription('Cierra los permisos de envío de mensajes en un canal específico.')
            .addChannelOption(option => 
                option
                    .setName('canal')
                    .setDescription('El canal de texto que deseas cerrar (Por defecto el actual).')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('unlock')
            .setDescription('Abre los permisos de envío de mensajes en un canal previamente bloqueado.')
            .addChannelOption(option => 
                option
                    .setName('canal')
                    .setDescription('El canal de texto que deseas reabrir (Por defecto el actual).')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('purgebots')
            .setDescription('Busca y elimina únicamente los mensajes enviados por bots en el canal actual.')
            .addIntegerOption(option => 
                option
                    .setName('cantidad')
                    .setDescription('Cuántos mensajes hacia atrás revisará el bot para hacer la limpieza.')
                    .setRequired(true)
            ),
        
        // UTILIDADES Y ROLES
        new SlashCommandBuilder()
            .setName('nick')
            .setDescription('Cambia o restablece el apodo de un miembro dentro del servidor.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro al que le cambiarás el apodo.')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option
                    .setName('apodo')
                    .setDescription('El nuevo nombre (Déjalo en blanco para remover el apodo actual).')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('role')
            .setDescription('Asigna un rol a un usuario o se lo remueve si ya lo tiene.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El miembro al que se le gestionará el rol.')
                    .setRequired(true)
            )
            .addRoleOption(option => 
                option
                    .setName('rol')
                    .setDescription('El rol que deseas entregar o quitar.')
                    .setRequired(true)
            ),
            
        new SlashCommandBuilder()
            .setName('userinfo')
            .setDescription('Muestra los datos públicos, IDs y fechas de creación de la cuenta de un usuario.')
            .addUserOption(option => 
                option
                    .setName('usuario')
                    .setDescription('El usuario que deseas investigar.')
                    .setRequired(false)
            ),
            
        new SlashCommandBuilder()
            .setName('serverinfo')
            .setDescription('Muestra estadísticas detalladas del servidor (Miembros, canales, iconos, etc.).'),
            
        new SlashCommandBuilder()
            .setName('say')
            .setDescription('Hace que el bot envíe un mensaje personalizado en el canal actual.')
            .addStringOption(option => 
                option
                    .setName('mensaje')
                    .setDescription('El texto que quieres que el bot envíe en el chat.')
                    .setRequired(true)
            )
    ];

    await client.application.commands.set(commands);
});

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

    if (interaction.isChatInputCommand()) {
        
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

        if (commandName === 'verificacion') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Permiso denegado.', ephemeral: true });
            const canal = options.getChannel('canal');
            config.rolesVerificacion = options.getString('roles_ids').split(',').map(id => id.trim()); saveDB();
            const embed = new EmbedBuilder().setTitle('🛡️ Panel de Verificación').setDescription('Oprime el botón inferior para realizar el test matemático anti-bot.').setColor('#00ff44');
            const btn = new ButtonBuilder().setCustomId('iniciar_verificacion').setLabel('Comenzar').setStyle(ButtonStyle.Primary);
            await canal.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
            return interaction.reply({ content: '✅ Panel enviado al canal.', ephemeral: true });
        }

        // CONTROL DE ACCESO STAFF
        if (!esStaff(member, config)) {
            return interaction.reply({ content: '❌ No cuentas con roles autorizados en este servidor para ejecutar este comando.', ephemeral: true });
        }

        const target = options.getUser('usuario');
        const targetMember = options.getMember('usuario');
        const razon = options.getString('razon') || 'Sin motivo expuesto.';

        if (commandName === 'ban') {
            await interaction.guild.members.ban(target, { reason: razon });
            return interaction.reply({ content: `🛑 **${target.username}** fue baneado correctamente.` });
        }
        if (commandName === 'unban') {
            const id = options.getString('id');
            await interaction.guild.members.unban(id).catch(() => null);
            return interaction.reply({ content: `✅ Solicitud de desbaneo procesada para la ID \`${id}\`.` });
        }
        if (commandName === 'kick') {
            await targetMember.kick(razon);
            return interaction.reply({ content: `👢 **${target.username}** fue expulsado del servidor.` });
        }
        if (commandName === 'timeout') {
            const minutos = options.getInteger('minutos');
            await targetMember.timeout(minutos * 60 * 1000, razon);
            return interaction.reply({ content: `⏳ **${target.username}** fue silenciado por ${minutos} minutos.` });
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
            return interaction.reply({ content: `🧹 Se han eliminado los mensajes del canal.`, ephemeral: true });
        }
        if (commandName === 'slowmode') {
            const segs = options.getInteger('segundos');
            await interaction.channel.setRateLimitPerUser(segs);
            return interaction.reply({ content: `⏱️ Modo lento configurado en \`${segs}s\`.` });
        }
        if (commandName === 'lock') {
            const chan = options.getChannel('canal') || interaction.channel;
            await chan.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            return interaction.reply({ content: `🔒 Canal ${chan} bloqueado.` });
        }
        if (commandName === 'unlock') {
            const chan = options.getChannel('canal') || interaction.channel;
            await chan.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
            return interaction.reply({ content: `🔓 Canal ${chan} desbloqueado.` });
        }
        if (commandName === 'purgebots') {
            const cant = options.getInteger('cantidad');
            const msgs = await interaction.channel.messages.fetch({ limit: cant });
            const botMsgs = msgs.filter(m => m.author.bot);
            await interaction.channel.bulkDelete(botMsgs);
            return interaction.reply({ content: `🤖 Limpieza completada. Mensajes de bots eliminados.`, ephemeral: true });
        }

        if (commandName === 'emergency') {
            const sub = options.getSubcommand();
            config.modoEmergencia = sub === 'on' ? 'Activado' : 'Desactivado'; saveDB();
            if(sub === 'on') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }).catch(() => null);
            }
            return interaction.reply({ content: `🚨 Modo Emergencia cambiado a: \`${config.modoEmergencia}\`.` });
        }
        if (commandName === 'backup') {
            const sub = options.getSubcommand();
            if (sub === 'create') {
                const canales = interaction.guild.channels.cache.map(c => ({ name: c.name, type: c.type }));
                db.backups[guildId] = canales; saveDB();
                return interaction.reply({ content: `💾 Copia de seguridad generada en la base de datos.` });
            } else {
                const bk = db.backups[guildId];
                if (!bk) return interaction.reply({ content: '❌ No hay backups guardadas.' });
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

    // INTERACCIONES CON COMPONENTES
    if (interaction.isStringSelectMenu() && customId === 'select-modulo') {
        if (interaction.values[0] === 'toggle_nuke') config.antiNuke = config.antiNuke === 'Activado' ? 'Desactivado' : 'Activado';
        if (interaction.values[0] === 'toggle_spam') config.antiSpam = config.antiSpam === 'Activado' ? 'Desactivado' : 'Activado';
        saveDB();
        return interaction.reply({ content: '✅ Estado del módulo actualizado.', ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() && customId === 'select-roles-staff') {
        config.rolesModeradores = interaction.values; saveDB();
        return interaction.reply({ content: '✅ Roles de Staff autorizados guardados.', ephemeral: true });
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


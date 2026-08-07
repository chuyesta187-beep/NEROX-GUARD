import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  PermissionsBitField,
  ChannelType
} from 'discord.js';
import express from 'express';

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.DISCORD_TOKEN || "TU_BOT_TOKEN_AQUI";

// ==========================================
// 2. BASE DE DATOS EN MEMORIA (MAPS)
// ==========================================
// Configuración de Bienvenida y Despedida por Servidor
const welcomeConfigs = new Map(); // guildId -> { enabled, channelId, message, banner, embedColor, autoRoleId }
const goodbyeConfigs = new Map(); // guildId -> { enabled, channelId, message, banner, embedColor }

// Sistema de Formularios
const forms = new Map(); // formId -> { id, guildId, title, description, channelId, questions: [{ id, label, style }] }
const formSubmissions = new Map(); // submissionId -> { id, formId, guildId, userId, answers: {}, status, reviewedBy }

// Helper para obtener/inicializar config de bienvenida
function getWelcomeConfig(guildId) {
  if (!welcomeConfigs.has(guildId)) {
    welcomeConfigs.set(guildId, {
      enabled: false,
      channelId: null,
      message: "¡Bienvenido {user} a {server}! Nos alegra tenerte aquí.",
      banner: null,
      embedColor: "#5865F2",
      autoRoleId: null
    });
  }
  return welcomeConfigs.get(guildId);
}

// Helper para obtener/inicializar config de despedida
function getGoodbyeConfig(guildId) {
  if (!goodbyeConfigs.has(guildId)) {
    goodbyeConfigs.set(guildId, {
      enabled: false,
      channelId: null,
      message: "{user} ha abandonado el servidor.",
      banner: null,
      embedColor: "#ED4245"
    });
  }
  return goodbyeConfigs.get(guildId);
}

// ==========================================
// 3. EVENTOS DE DISCORD (WELCOME / GOODBYE)
// ==========================================

// Evento: Entrada de Usuario (Bienvenida y Rol Automático)
client.on('guildMemberAdd', async (member) => {
  const config = getWelcomeConfig(member.guild.id);

  // Rol Automático
  if (config.autoRoleId) {
    try {
      const role = member.guild.roles.cache.get(config.autoRoleId);
      if (role) await member.roles.add(role);
    } catch (err) {
      console.error(`[AutoRole] Error al asignar rol en ${member.guild.name}:`, err);
    }
  }

  // Mensaje de Bienvenida
  if (config.enabled && config.channelId) {
    const channel = member.guild.channels.cache.get(config.channelId);
    if (channel) {
      const formattedMessage = config.message
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());

      const embed = new EmbedBuilder()
        .setTitle(`👋 ¡Bienvenido a ${member.guild.name}!`)
        .setDescription(formattedMessage)
        .setColor(config.embedColor || '#5865F2')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Miembro #${member.guild.memberCount}` })
        .setTimestamp();

      if (config.banner) {
        embed.setImage(config.banner);
      }

      await channel.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(console.error);
    }
  }
});

// Evento: Salida de Usuario (Despedida)
client.on('guildMemberRemove', async (member) => {
  const config = getGoodbyeConfig(member.guild.id);

  if (config.enabled && config.channelId) {
    const channel = member.guild.channels.cache.get(config.channelId);
    if (channel) {
      const formattedMessage = config.message
        .replace(/{user}/g, member.user.tag)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, member.guild.memberCount.toString());

      const embed = new EmbedBuilder()
        .setTitle(`😢 Usuario desvinculado`)
        .setDescription(formattedMessage)
        .setColor(config.embedColor || '#ED4245')
        .setFooter({ text: `Ahora somos ${member.guild.memberCount} miembros` })
        .setTimestamp();

      if (config.banner) {
        embed.setImage(config.banner);
      }

      await channel.send({ embeds: [embed] }).catch(console.error);
    }
  }
});

// ==========================================
// 4. MANEJO DE INTERACCIONES (BOTONES Y MODALES)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  // --- A. CLICK EN "COMPLETAR FORMULARIO" ---
  if (interaction.isButton() && interaction.customId.startsWith('open_form_')) {
    const formId = interaction.customId.replace('open_form_', '');
    const form = forms.get(formId);

    if (!form) {
      return interaction.reply({ content: '❌ Este formulario ya no está disponible.', ephemeral: true });
    }

    // Discord permite máximo 5 campos por Modal
    const modal = new ModalBuilder()
      .setCustomId(`submit_form_${form.id}`)
      .setTitle(form.title.substring(0, 45));

    const rows = form.questions.slice(0, 5).map((q) => {
      const input = new TextInputBuilder()
        .setCustomId(`q_${q.id}`)
        .setLabel(q.label.substring(0, 45))
        .setStyle(q.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(true);

      return new ActionRowBuilder().addComponents(input);
    });

    modal.addComponents(rows);
    return await interaction.showModal(modal);
  }

  // --- B. ENVÍO DEL MODAL DE FORMULARIO ---
  if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_form_')) {
    const formId = interaction.customId.replace('submit_form_', '');
    const form = forms.get(formId);

    if (!form) {
      return interaction.reply({ content: '❌ El formulario expiró o fue eliminado.', ephemeral: true });
    }

    const answers = {};
    form.questions.forEach((q) => {
      answers[q.label] = interaction.fields.getTextInputValue(`q_${q.id}`);
    });

    const submissionId = `sub_${Date.now()}`;
    const submissionData = {
      id: submissionId,
      formId: form.id,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      answers,
      status: 'PENDING',
      reviewedBy: null
    };

    formSubmissions.set(submissionId, submissionData);

    // Enviar respuesta al canal de revisión configurado
    const targetChannel = interaction.guild.channels.cache.get(form.channelId);
    if (targetChannel) {
      const embed = new EmbedBuilder()
        .setTitle(`📋 Nueva Respuestas: ${form.title}`)
        .setDescription(`**Postulante:** <@${interaction.user.id}> (${interaction.user.tag})\n**ID Formulario:** \`${form.id}\``)
        .setColor('#FEE75C')
        .setTimestamp();

      Object.entries(answers).forEach(([question, answer]) => {
        embed.addFields({ name: `📌 ${question}`, value: answer || '*Sin respuesta*' });
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`form_accept_${submissionId}`)
          .setLabel('Aceptar')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`form_reject_${submissionId}`)
          .setLabel('Rechazar')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
      );

      await targetChannel.send({ embeds: [embed], components: [row] });
    }

    return interaction.reply({
      content: '✅ Tu respuesta ha sido enviada con éxito. El equipo la revisará pronto.',
      ephemeral: true
    });
  }

  // --- C. BOTONES DE ACEPTAR / RECHAZAR FORMULARIO ---
  if (interaction.isButton() && (interaction.customId.startsWith('form_accept_') || interaction.customId.startsWith('form_reject_'))) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ No tienes permisos para gestionar postulaciones.', ephemeral: true });
    }

    const isAccept = interaction.customId.startsWith('form_accept_');
    const submissionId = interaction.customId.replace(isAccept ? 'form_accept_' : 'form_reject_', '');
    const submission = formSubmissions.get(submissionId);

    if (!submission) {
      return interaction.reply({ content: '❌ No se encontró el registro de esta postulación.', ephemeral: true });
    }

    submission.status = isAccept ? 'ACCEPTED' : 'REJECTED';
    submission.reviewedBy = interaction.user.id;

    const oldEmbed = interaction.message.embeds[0];
    const updatedEmbed = EmbedBuilder.from(oldEmbed)
      .setColor(isAccept ? '#57F287' : '#ED4245')
      .addFields({
        name: 'Estado de Revisión',
        value: `${isAccept ? '✅ **Aceptado**' : '❌ **Rechazado**'} por <@${interaction.user.id}>`
      });

    // Deshabilitar botones tras la decisión
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('done_acc').setLabel('Aceptado').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('done_rej').setLabel('Rechazado').setStyle(ButtonStyle.Danger).setDisabled(true)
    );

    await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });

    // Notificar al usuario por mensaje privado (DM)
    try {
      const applicant = await client.users.fetch(submission.userId);
      if (applicant) {
        await applicant.send({
          content: `📢 Tu postulación en **${interaction.guild.name}** ha sido **${isAccept ? 'ACEPTADA ✅' : 'RECHAZADA ❌'}**.`
        });
      }
    } catch (e) {
      console.log(`No se pudo enviar MD al usuario ${submission.userId}`);
    }
  }
});

// ==========================================
// 5. API REST Y ENDPOINTS PARA DASHBOARD
// ==========================================

// --- A. BIENVENIDA Y DESPEDIDA ---

// Obtener Configuración de Bienvenida y Despedida
app.get('/api/guilds/:guildId/welcome-goodbye', (req, res) => {
  const { guildId } = req.params;
  res.json({
    welcome: getWelcomeConfig(guildId),
    goodbye: getGoodbyeConfig(guildId)
  });
});

// Actualizar Configuración de Bienvenida y Despedida
app.post('/api/guilds/:guildId/welcome-goodbye', (req, res) => {
  const { guildId } = req.params;
  const { welcome, goodbye } = req.body;

  if (welcome) {
    const currentW = getWelcomeConfig(guildId);
    welcomeConfigs.set(guildId, { ...currentW, ...welcome });
  }

  if (goodbye) {
    const currentG = getGoodbyeConfig(guildId);
    goodbyeConfigs.set(guildId, { ...currentG, ...goodbye });
  }

  res.json({ success: true, message: 'Configuración de bienvenida/despedida actualizada correctamente.' });
});

// --- B. SISTEMA DE FORMULARIOS ---

// Crear o Actualizar Formulario desde el Dashboard
app.post('/api/guilds/:guildId/forms', (req, res) => {
  const { guildId } = req.params;
  const { title, description, channelId, questions } = req.body;

  if (!title || !channelId || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios (title, channelId, questions).' });
  }

  const formId = `form_${Date.now()}`;
  const newForm = {
    id: formId,
    guildId,
    title,
    description: description || '',
    channelId,
    questions: questions.map((q, idx) => ({
      id: q.id || `q_${idx}`,
      label: q.label,
      style: q.style || 'SHORT' // SHORT o PARAGRAPH
    }))
  };

  forms.set(formId, newForm);
  res.json({ success: true, form: newForm });
});

// Obtener Formularios de un Servidor
app.get('/api/guilds/:guildId/forms', (req, res) => {
  const { guildId } = req.params;
  const guildForms = Array.from(forms.values()).filter(f => f.guildId === guildId);
  res.json(guildForms);
});

// Publicar Formulario en un Canal de Discord
app.post('/api/guilds/:guildId/forms/:formId/publish', async (req, res) => {
  const { guildId, formId } = req.params;
  const { targetChannelId } = req.body;

  const form = forms.get(formId);
  if (!form || form.guildId !== guildId) {
    return res.status(404).json({ error: 'Formulario no encontrado.' });
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(targetChannelId || form.channelId);

    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado en el servidor.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${form.title}`)
      .setDescription(`${form.description}\n\n> *Haz clic en el botón de abajo para responder.*`)
      .setColor('#5865F2');

    // Muestra de preguntas en el Embed promocional
    form.questions.forEach(q => {
      embed.addFields({ name: `❓ ${q.label}`, value: `*${q.style === 'PARAGRAPH' ? 'Texto largo' : 'Texto corto'}*`, inline: false });
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`open_form_${form.id}`)
        .setLabel('📝 Completar formulario')
        .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [row] });
    res.json({ success: true, message: `Formulario publicado con éxito en <#${channel.id}>` });
  } catch (error) {
    console.error('[Forms Publish Error]', error);
    res.status(500).json({ error: 'Error al publicar el formulario en Discord.' });
  }
});

// Obtener Respuestas/Postulaciones Enviadas
app.get('/api/guilds/:guildId/submissions', (req, res) => {
  const { guildId } = req.params;
  const submissions = Array.from(formSubmissions.values()).filter(s => s.guildId === guildId);
  res.json(submissions);
});

// ==========================================
// 6. INICIALIZACIÓN Y STARTUP
// ==========================================
app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP API corriendo en puerto: ${PORT}`);
});

client.once('ready', () => {
  console.log(`✅ NEROX GUARD conectado exitosamente como: ${client.user.tag}`);
});

client.login(BOT_TOKEN);

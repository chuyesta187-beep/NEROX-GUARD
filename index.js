const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
require("dotenv").config();

// ==========================================
// 🛡️ 1. INSTANCIAR EL BOT CON SUS INTENTS
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Requerido para auditoría y conteo en el dashboard
    ]
});

// Colección para almacenar los comandos en memoria
client.commands = new Collection();

// ==========================================
// 🧠 2. ASIGNACIÓN GLOBAL INMEDIATA
// ==========================================
// Permite al dashboard Express interactuar con el cliente de inmediato
global.client = client;

// Cargar el servidor web del Dashboard
require("./dashboard/server");

// ==========================================
// ⚙️ 3. REGISTRO DE COMANDOS DE BARRA (SLASH)
// ==========================================
// Definición de comandos básicos de moderación y seguridad
const commandsData = [
    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Muestra la latencia actual del bot y del sistema"),
        
    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Expulsa a un usuario problemático del servidor")
        .addUserOption(option => 
            option.setName("usuario").setDescription("El miembro que deseas expulsar").setRequired(true)
        )
        .addStringOption(option => 
            option.setName("razon").setDescription("Motivo de la expulsión").setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Banea permanentemente a un usuario del servidor")
        .addUserOption(option => 
            option.setName("usuario").setDescription("El miembro que deseas banear").setRequired(true)
        )
        .addStringOption(option => 
            option.setName("razon").setDescription("Motivo del baneo").setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Elimina una cantidad específica de mensajes de un canal")
        .addIntegerOption(option => 
            option.setName("cantidad").setDescription("Número de mensajes a borrar (1-100)").setRequired(true)
        )
];

// Guardar los comandos en la colección del cliente
for (const cmd of commandsData) {
    client.commands.set(cmd.name, cmd);
}

// Mapear los comandos a JSON para la API de Discord
const commandsJson = commandsData.map(cmd => cmd.toJSON());

// ==========================================
// 🌐 4. EVENTO CUANDO EL BOT QUEDA READY
// ==========================================
client.once("clientReady", async () => {
    console.log(`🛡️ Nerox Guard conectado exitosamente como ${client.user.tag}`);
    
    // Desplegar los comandos de barra de forma global en la API de Discord
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        console.log("🔄 Iniciando la actualización de los comandos de barra (/) globales...");
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandsJson }
        );
        console.log("✅ Comandos de barra (/) cargados y registrados globalmente con éxito.");
    } catch (error) {
        console.error("❌ Error al registrar los comandos de barra:", error);
    }
});

// ==========================================
// 📡 5. MANEJADOR DE INTERACCIONES (EJECUTAR SLASH)
// ==========================================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        // Ejecución de comando Ping
        if (interaction.commandName === "ping") {
            const apiPing = client.ws.ping;
            await interaction.reply({ 
                content: `🏓 **Pong!**\n🛰️ Latencia de la API: \`${apiPing}ms\``, 
                ephemeral: true 
            });
        }

        // Ejecución de comando Kick
        if (interaction.commandName === "kick") {
            if (!interaction.member.permissions.has("KickMembers")) {
                return interaction.reply({ content: "❌ No tienes permisos para usar este comando.", ephemeral: true });
            }
            const targetUser = interaction.options.getMember("usuario");
            const reason = interaction.options.getString("razon") || "No se especificó una razón.";

            if (!targetUser) return interaction.reply({ content: "❌ No se encontró a ese usuario en el servidor.", ephemeral: true });
            if (!targetUser.kickable) return interaction.reply({ content: "❌ No puedo expulsar a este usuario debido a jerarquía de roles.", ephemeral: true });

            await targetUser.kick(reason);
            await interaction.reply({ content: `✅ **${targetUser.user.tag}** ha sido expulsado.\n**Razón:** ${reason}` });
        }

        // Ejecución de comando Ban
        if (interaction.commandName === "ban") {
            if (!interaction.member.permissions.has("BanMembers")) {
                return interaction.reply({ content: "❌ No tienes permisos para usar este comando.", ephemeral: true });
            }
            const targetUser = interaction.options.getMember("usuario");
            const reason = interaction.options.getString("razon") || "No se especificó una razón.";

            if (!targetUser) return interaction.reply({ content: "❌ No se encontró a ese usuario en el servidor.", ephemeral: true });
            if (!targetUser.bannable) return interaction.reply({ content: "❌ No puedo banear a este usuario debido a jerarquía de roles.", ephemeral: true });

            await targetUser.ban({ reason });
            await interaction.reply({ content: `⛔ **${targetUser.user.tag}** ha sido baneado permanentemente.\n**Razón:** ${reason}` });
        }

        // Ejecución de comando Clear
        if (interaction.commandName === "clear") {
            if (!interaction.member.permissions.has("ManageMessages")) {
                return interaction.reply({ content: "❌ No tienes permisos para usar este comando.", ephemeral: true });
            }
            const amount = interaction.options.getInteger("cantidad");

            if (amount < 1 || amount > 100) {
                return interaction.reply({ content: "❌ Debes ingresar un número entre 1 y 100.", ephemeral: true });
            }

            await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `🧹 Se han eliminado \`${amount}\` mensajes de este canal de forma limpia.`, ephemeral: true });
        }

    } catch (error) {
        console.error(`Error al ejecutar el comando ${interaction.commandName}:`, error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: "❌ Ocurrió un error interno al intentar procesar este comando.", ephemeral: true });
        } else {
            await interaction.reply({ content: "❌ Ocurrió un error interno al intentar procesar este comando.", ephemeral: true });
        }
    }
});

// ==========================================
// 🚀 6. LOGIN DEL BOT
// ==========================================
client.login(process.env.TOKEN);

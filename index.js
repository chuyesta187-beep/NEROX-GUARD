const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder } = require("discord.js");
const express = require("express");
const axios = require("axios");
const session = require("express-session");
require("dotenv").config();

// ==========================================
// 🤖 1. CONFIGURACIÓN E INICIALIZACIÓN DEL BOT
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Clave para auditar miembros desde el dashboard web
    ]
});

client.commands = new Collection();

// Asignación global inmediata para asegurar compatibilidad total
global.client = client;

// ==========================================
// 🌐 2. CONFIGURACIÓN DEL DASHBOARD (EXPRESS)
// ==========================================
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de Proxy para Render
app.set("trust proxy", 1);

// ✅ Modificado: Se eliminó el string de fallback inseguro por motivos de seguridad
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 // 24 horas en milisegundos
    }
}));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// 🏠 PÁGINA PRINCIPAL ELEGANTE
app.get("/", (req, res) => {
    res.send(`
    <body style="
        background: #111214;
        color: #ffffff;
        font-family: Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
    ">
        <div style="
            background: #1e1f22;
            padding: 40px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 0 25px rgba(88,101,242,0.5);
            width: 90%;
            max-width: 500px;
        ">
            <img src="https://cdn.discordapp.com/embed/avatars/0.png"
                 width="120"
                 style="border-radius:50%; border:4px solid #5865F2;">

            <h1 style="margin-top:20px; color:#5865F2; font-weight: bold; letter-spacing: 0.5px;">
                🛡️ NEROX GUARD
            </h1>

            <p style="color:#b5bac1; font-size:17px;">
                Sistema de seguridad y moderación avanzado para Discord.
            </p>

            <br>

            <a href="/login">
                <button style="
                    background:#5865F2;
                    color:white;
                    border:none;
                    padding:15px 30px;
                    border-radius:10px;
                    font-size:18px;
                    font-weight:bold;
                    cursor:pointer;
                ">
                    🚀 Iniciar sesión con Discord
                </button>
            </a>

            <br><br>

            <p style="color:#80848e; font-size:14px;">
                © 2026 Nerox Guard • Dashboard Oficial
            </p>
        </div>
    </body>
    `);
});

// 🔗 LOGIN OAUTH2
app.get("/login", (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds%20email`;
    res.redirect(url);
});

// 🔁 CALLBACK DISCORD
app.get("/callback", async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send("❌ No se recibió el código de autorización de Discord.");
    }

    try {
        const params = new URLSearchParams();
        params.append("client_id", CLIENT_ID);
        params.append("client_secret", CLIENT_SECRET);
        params.append("grant_type", "authorization_code");
        params.append("code", code);
        params.append("redirect_uri", REDIRECT_URI);

        const tokenRes = await axios.post(
            "https://discord.com/api/oauth2/token",
            params,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        req.session.accessToken = tokenRes.data.access_token;

        const userRes = await axios.get("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        req.session.user = userRes.data;
        console.log("Usuario guardado:", req.session.user.username);

        req.session.save(() => {
            res.redirect("/dashboard");
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error interno durante el inicio de sesión.");
    }
});

// 🏠 DASHBOARD PRINCIPAL
app.get("/dashboard", (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const user = req.session.user;
    const avatarUrl = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

    res.send(`
        <body style="background-color: #111214; color: #dbdee1; font-family: sans-serif; padding: 40px;">
            <h1>Bienvenido, ${user.username} 👋</h1>
            <img src="${avatarUrl}" width="100" style="border-radius: 50%; border: 3px solid #5865F2;"/>
            <br><br>
            <a href="/servers"><button style="background-color: #5865F2; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Ver Servidores</button></a>
        </body>
    `);
});

// 📡 LISTADO DE SERVIDORES CONECTADO AL BOT
app.get("/servers", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    try {
        const userGuildsRes = await axios.get("https://discord.com/api/users/@me/guilds", {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });

        const userGuilds = userGuildsRes.data;
        
        // Control de estado del Bot en vivo
        if (!global.client || !global.client.readyAt) {
            return res.send("<body style='background-color: #111214; color: #f23f43; font-family: sans-serif; padding: 40px;'><h2>El bot se está iniciando en Render o restableciendo la conexión. Por favor, recarga en unos segundos...</h2></body>");
        }

        const botGuilds = global.client.guilds.cache;

        // Filtrado usando BigInt para máxima precisión en permisos masivos de Discord
        const mutualGuilds = userGuilds.filter(guild => {
            const isAdmin = (BigInt(guild.permissions) & 0x8n) === 0x8n;
            const hasBot = botGuilds.has(guild.id);
            return isAdmin && hasBot;
        });

        let listaServersHtml = mutualGuilds.map(g => {
            const iconUrl = g.icon 
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
                : `https://archive.org/download/discord-logo/discord-logo.png`;

            return `
                <li style="margin-bottom: 15px; list-style: none; background: #1e1f22; padding: 15px; border-radius: 8px; display: flex; align-items: center;">
                    <img src="${iconUrl}" width="40" style="border-radius:50%; margin-right:15px;">
                    <span style="font-size: 18px; font-weight: bold; flex-grow: 1;">${g.name}</span> 
                    <a href="/manage/${g.id}"><button style="background-color: #248046; color: white; padding: 8px 15px; border: none; border-radius: 4px; cursor:pointer; font-weight: bold;">Configurar Panel</button></a>
                </li>
            `;
        }).join("");

        res.send(`
            <body style="background-color: #111214; color: #dbdee1; font-family: sans-serif; padding: 40px;">
                <h1>Panel de Servidores</h1>
                <p style="color: #949ba4;">Selecciona un servidor donde tengas permisos y el bot esté activo:</p>
                <ul style="padding-left: 0;">
                    ${listaServersHtml || "<li style='color: #949ba4; list-style: none;'>No se encontraron servidores mutuos con rango de Administrador.</li>"}
                </ul>
                <br>
                <a href="/dashboard" style="color: #5865F2; text-decoration: none;">⬅ Volver al inicio</a>
            </body>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send("Error al enlazar los servidores.");
    }
});

// 🛠️ PANEL INTERACTIVO DE CONFIGURACIÓN POR SERVIDOR
app.get("/manage/:guildId", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");

    const { guildId } = req.params;

    if (!global.client || !global.client.readyAt) {
        return res.send("El bot no se encuentra disponible.");
    }

    // Extracción en vivo del servidor usando la memoria del bot
    const guild = global.client.guilds.cache.get(guildId);

    if (!guild) {
        return res.status(404).send("<body style='background-color: #111214; color: #f23f43; font-family: sans-serif; padding: 40px;'><h2>❌ El bot no está en este servidor o el ID proporcionado es inválido.</h2></body>");
    }

    res.send(`
        <body style="background-color: #111214; color: #dbdee1; font-family: sans-serif; padding: 40px;">
            <h1>Configuración de Seguridad 🛡️ ${guild.name}</h1>
            <p style="color: #949ba4;">ID del Servidor: <code>${guild.id}</code> | Miembros en caché: <b>${guild.memberCount}</b></p>
            <hr style="border: 1px solid #1e1f22;">
            <h3>Módulos de Seguridad de Nerox Guard</h3>
            <form style="background: #1e1f22; padding: 20px; border-radius: 8px; max-width: 500px;">
                <label style="font-size: 16px; display: block; margin-bottom: 10px;">
                    <input type="checkbox" name="antiraid" checked style="margin-right: 10px;"> Anti-Raid Avanzado
                </label>
                <label style="font-size: 16px; display: block; margin-bottom: 20px;">
                    <input type="checkbox" name="antispam" style="margin-right: 10px;"> Anti-Spam (Mass Mentions / Flood)
                </label>
                <button type="button" onclick="alert('¡Configuración guardada! Listo para conectar tu Base de Datos en la Fase 2.')" style="background-color: #5865F2; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Guardar Configuración</button>
            </form>
            <br>
            <a href="/servers" style="color: #5865F2; text-decoration: none;">⬅ Volver a la lista de servidores</a>
        </body>
    `);
});

// Levantar servidor Express de manera síncrona
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🌐 Dashboard web activo en el puerto " + PORT);
});


// ==========================================
// ⚙️ 3. REGISTRO DE SLASH COMMANDS
// ==========================================
const commandsData = [
    new SlashCommandBuilder().setName("ping").setDescription("Muestra la latencia actual del bot y del sistema"),
    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Expulsa a un usuario problemático del servidor")
        .addUserOption(opt => opt.setName("usuario").setDescription("El miembro que deseas expulsar").setRequired(true))
        .addStringOption(opt => opt.setName("razon").setDescription("Motivo de la expulsión").setRequired(false)),
    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Banea permanentemente a un usuario del servidor")
        .addUserOption(opt => opt.setName("usuario").setDescription("El miembro que deseas banear").setRequired(true))
        .addStringOption(opt => opt.setName("razon").setDescription("Motivo del baneo").setRequired(false)),
    new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Elimina una cantidad específica de mensajes de un canal")
        .addIntegerOption(opt => opt.setName("cantidad").setDescription("Número de mensajes a borrar (1-100)").setRequired(true))
];

for (const cmd of commandsData) {
    client.commands.set(cmd.name, cmd);
}
const commandsJson = commandsData.map(cmd => cmd.toJSON());


// ==========================================
// 🌐 4. EVENTOS Y DISPARADORES DISCORD
// ==========================================
client.once("clientReady", async () => {
    console.log(`🛡️ Nerox Guard conectado exitosamente como ${client.user.tag}`);
    
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        console.log("🔄 Actualizando los comandos de barra (/) globales...");
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandsJson }
        );
        console.log("✅ Comandos registrados de forma global en la API de Discord.");
    } catch (error) {
        console.error("❌ Error registrando comandos:", error);
    }
});

// Manejador de ejecuciones de comandos de barra
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        if (interaction.commandName === "ping") {
            await interaction.reply({
                content: `🏓 **Pong!** | API Latencia: \`${client.ws.ping}ms\``,
                ephemeral: true
            });
        }

        if (interaction.commandName === "kick") {
            if (!interaction.member.permissions.has("KickMembers")) {
                return interaction.reply({
                    content: "❌ Permisos insuficientes.",
                    ephemeral: true
                });
            }

            const targetUser = interaction.options.getMember("usuario");
            const reason = interaction.options.getString("razon") || "No especificada.";

            if (!targetUser || !targetUser.kickable) {
                return interaction.reply({
                    content: "❌ No se puede expulsar a este usuario.",
                    ephemeral: true
                });
            }

            await targetUser.kick(reason);
            await interaction.reply({
                content: `✅ ${targetUser.user.tag} fue expulsado.\nRazón: ${reason}`
            });
        }

        if (interaction.commandName === "ban") {
            if (!interaction.member.permissions.has("BanMembers")) {
                return interaction.reply({
                    content: "❌ Permisos insuficientes.",
                    ephemeral: true
                });
            }

            const targetUser = interaction.options.getMember("usuario");
            const reason = interaction.options.getString("razon") || "No especificada.";

            if (!targetUser || !targetUser.bannable) {
                return interaction.reply({
                    content: "❌ No se puede banear a este usuario.",
                    ephemeral: true
                });
            }

            await targetUser.ban({ reason });
            await interaction.reply({
                content: `⛔ ${targetUser.user.tag} fue baneado.\nRazón: ${reason}`
            });
        }

        if (interaction.commandName === "clear") {
            if (!interaction.member.permissions.has("ManageMessages")) {
                return interaction.reply({
                    content: "❌ Permisos insuficientes.",
                    ephemeral: true
                });
            }

            const amount = interaction.options.getInteger("cantidad");

            if (amount < 1 || amount > 100) {
                return interaction.reply({
                    content: "❌ Debes elegir un número entre 1 y 100.",
                    ephemeral: true
                });
            }

            await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({
                content: `🧹 Se eliminaron ${amount} mensajes.`,
                ephemeral: true
            });
        }

    } catch (err) {
        console.error(err);

        if (!interaction.replied) {
            await interaction.reply({
                content: "❌ Ocurrió un error al ejecutar el comando.",
                ephemeral: true
            });
        }
    }
});

// ==========================================
// 🚀 5. CONEXIÓN FINAL
// ==========================================
client.login(process.env.TOKEN);

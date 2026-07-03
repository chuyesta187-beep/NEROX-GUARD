const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config(); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers // 🔥 Importante para contar miembros en /manage
    ]
});

// ✅ 1. Definir la variable global INMEDIATAMENTE al crear el cliente.
// Esto evita que el archivo de Express tire un error de "undefined" al cargar las rutas.
global.client = client;

// ✅ 2. Cargar el servidor del dashboard.
// Al requerirlo aquí, ya sabe que global.client existe.
require("./dashboard/server");

// ✅ 3. Evento ready (clientReady)
client.once("ready", () => {
    console.log(`🛡️ Nerox Guard conectado como ${client.user.tag}`);
    // En este punto, client.readyAt deja de ser null de forma nativa, 
    // lo que desbloquea automáticamente las rutas /servers y /manage en tu servidor web.
});

// ✅ 4. Conectar el bot
client.login(process.env.TOKEN);

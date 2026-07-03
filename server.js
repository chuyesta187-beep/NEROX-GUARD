const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

// ...todo el resto de tu código del dashboard...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🌐 Dashboard online en puerto " + PORT);
});

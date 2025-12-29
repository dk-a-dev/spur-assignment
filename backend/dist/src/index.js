"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const app = (0, app_1.createApp)();
app.listen(config_1.env.PORT, () => {
    console.log(`Backend listening on http://localhost:${config_1.env.PORT}`);
});

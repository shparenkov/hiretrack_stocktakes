"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const app = (0, app_1.createApp)();
app.listen(port, host, () => {
    console.log(`HireTrack service tickets backend listening on http://${host}:${port}`);
});

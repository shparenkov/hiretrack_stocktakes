"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const tickets_1 = require("./routes/tickets");
const bitrix_ticket_app_1 = require("./services/bitrix-ticket-app");
const password_auth_1 = require("./services/password-auth");
function createApp() {
    const app = (0, express_1.default)();
    app.set('trust proxy', 'loopback');
    const frontendDistPath = (0, bitrix_ticket_app_1.resolveTicketsFrontendDistPath)();
    const frontendIndexPath = (0, bitrix_ticket_app_1.resolveTicketsFrontendIndexPath)();
    const hasFrontendBuild = fs_1.default.existsSync(frontendIndexPath);
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use(express_1.default.urlencoded({ extended: false, limit: '16kb' }));
    app.get('/health', (_req, res) => {
        res.json({
            ok: true,
            service: 'hiretrack-service-tickets',
            mode: 'backend-scaffold',
            timestamp: new Date().toISOString(),
        });
    });
    (0, password_auth_1.installPasswordAuth)(app);
    app.use('/tickets', tickets_1.ticketsRouter);
    app.use('/api/tickets', tickets_1.ticketsRouter);
    app.all(['/bitrix/tickets/app', '/bitrix/tickets/install'], (_req, res) => {
        const uiPath = '/bitrix/tickets/ui/';
        res.type('html').send((0, bitrix_ticket_app_1.renderBitrixTicketsAppShell)({ uiPath }));
    });
    app.get(/^\/bitrix\/tickets\/stocktake-history$/, (_req, res) => {
        res.redirect('/bitrix/tickets/stocktake-history/');
    });
    app.get('/bitrix/tickets/stocktake-history/', (_req, res) => {
        res.type('html').send((0, bitrix_ticket_app_1.renderStocktakeHistoryPage)());
    });
    app.get(/^\/bitrix\/tickets\/ui$/, (_req, res) => {
        res.redirect('/bitrix/tickets/ui/');
    });
    if (hasFrontendBuild) {
        app.get('/bitrix/tickets/ui/', (_req, res) => {
            res.sendFile(frontendIndexPath);
        });
        app.use('/bitrix/tickets/ui', express_1.default.static(frontendDistPath, {
            index: false,
            redirect: false,
        }));
        app.get('/bitrix/tickets/ui/*', (_req, res) => {
            res.sendFile(frontendIndexPath);
        });
    }
    else {
        app.get(['/bitrix/tickets/ui/', '/bitrix/tickets/ui/*'], (_req, res) => {
            res.type('html').send((0, bitrix_ticket_app_1.renderFrontendBuildMissingPage)());
        });
    }
    return app;
}

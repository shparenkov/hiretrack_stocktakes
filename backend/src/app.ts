import cors from 'cors';
import express from 'express';
import fs from 'fs';
import { ticketsRouter } from './routes/tickets';
import {
  renderBitrixTicketsAppShell,
  renderFrontendBuildMissingPage,
  renderStocktakeHistoryPage,
  resolveTicketsFrontendDistPath,
  resolveTicketsFrontendIndexPath,
} from './services/bitrix-ticket-app';

export function createApp() {
  const app = express();
  const frontendDistPath = resolveTicketsFrontendDistPath();
  const frontendIndexPath = resolveTicketsFrontendIndexPath();
  const hasFrontendBuild = fs.existsSync(frontendIndexPath);

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'hiretrack-service-tickets',
      mode: 'backend-scaffold',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/tickets', ticketsRouter);
  app.use('/api/tickets', ticketsRouter);

  app.all(['/bitrix/tickets/app', '/bitrix/tickets/install'], (_req, res) => {
    const uiPath = '/bitrix/tickets/ui/';
    res.type('html').send(renderBitrixTicketsAppShell({ uiPath }));
  });

  app.get(/^\/bitrix\/tickets\/stocktake-history$/, (_req, res) => {
    res.redirect('/bitrix/tickets/stocktake-history/');
  });

  app.get('/bitrix/tickets/stocktake-history/', (_req, res) => {
    res.type('html').send(renderStocktakeHistoryPage());
  });

  app.get(/^\/bitrix\/tickets\/ui$/, (_req, res) => {
    res.redirect('/bitrix/tickets/ui/');
  });

  if (hasFrontendBuild) {
    app.get('/bitrix/tickets/ui/', (_req, res) => {
      res.sendFile(frontendIndexPath);
    });

    app.use(
      '/bitrix/tickets/ui',
      express.static(frontendDistPath, {
        index: false,
        redirect: false,
      }),
    );

    app.get('/bitrix/tickets/ui/*', (_req, res) => {
      res.sendFile(frontendIndexPath);
    });
  } else {
    app.get(['/bitrix/tickets/ui/', '/bitrix/tickets/ui/*'], (_req, res) => {
      res.type('html').send(renderFrontendBuildMissingPage());
    });
  }

  return app;
}

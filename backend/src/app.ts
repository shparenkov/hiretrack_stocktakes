import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { crewBookingsRouter } from './routes/crew-bookings';
import { ticketsRouter } from './routes/tickets';
import {
  renderBitrixTicketsAppShell,
  renderFrontendBuildMissingPage,
  renderStocktakeHistoryPage,
  resolveTicketsFrontendDistPath,
  resolveTicketsFrontendIndexPath,
} from './services/bitrix-ticket-app';
import { installPasswordAuth } from './services/password-auth';
import { renderHiretrackPortalPage } from './services/portal-page';

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  const frontendDistPath = resolveTicketsFrontendDistPath();
  const frontendIndexPath = resolveTicketsFrontendIndexPath();
  const hasFrontendBuild = fs.existsSync(frontendIndexPath);

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'hiretrack-service-tickets',
      mode: 'backend-scaffold',
      timestamp: new Date().toISOString(),
    });
  });

  installPasswordAuth(app);

  app.get('/', (_req, res) => {
    res.type('html').send(renderHiretrackPortalPage());
  });

  app.use('/tickets', ticketsRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/crew-bookings', crewBookingsRouter);

  const crewBookingsFrontendPath = path.resolve(process.cwd(), 'frontend-crew-bookings');
  app.get('/crew-bookings/', (_req, res) => {
    res.sendFile(path.join(crewBookingsFrontendPath, 'index.html'));
  });
  app.use('/crew-bookings', express.static(crewBookingsFrontendPath, { index: false, redirect: false }));

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

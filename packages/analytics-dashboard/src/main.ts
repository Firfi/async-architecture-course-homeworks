import express from 'express';
import bodyParser from 'body-parser';
import { run as runReactions } from './reactions';
import { getMaxPriceForInterval, getTopRevenueToday, loserCountToday } from './ticker';
import { makeAuthMiddleware, useCanRole } from '../../utils/src/lib/auth';

import { ROLE_ADMIN } from '@monorepo/utils';

const app = express();

app.use(bodyParser.json());

const port = parseInt(process.env.PORT || '3333', 10);
const server = app.listen(port, async () => {
  await runReactions();
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

const fiefAuthMiddleware = makeAuthMiddleware(app, port);



app.get('/winnerPrice/:dayFrom/:dayTo', fiefAuthMiddleware(), useCanRole([ROLE_ADMIN]), (req, res) => {
  const dayFrom = new Date(req.params.dayFrom);
  const dayTo = new Date(req.params.dayTo);
  res.json({
    maxPrice: Number(getMaxPriceForInterval(dayFrom, dayTo))/*TODO assert number cast but generally we don't care*/,
  });
});

app.get('/loserCount', fiefAuthMiddleware(), useCanRole([ROLE_ADMIN]), (req, res) => {
  res.json({
    loserCount: loserCountToday(),
  });
});

app.get('/topRevenue', fiefAuthMiddleware(), useCanRole([ROLE_ADMIN]), (req, res) => {
  res.json({
    topRevenue: getTopRevenueToday(),
  });
});


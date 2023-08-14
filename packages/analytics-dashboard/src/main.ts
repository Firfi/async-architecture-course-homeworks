import express from 'express';
import bodyParser from 'body-parser';
import { run as runReactions } from './reactions';
import { getMaxPriceForInterval, getTopRevenueToday, loserCountToday } from './ticker';

const app = express();

app.use(bodyParser.json());

app.get('/winnerPrice/:dayFrom/:dayTo', (req, res) => {
  const dayFrom = new Date(req.params.dayFrom);
  const dayTo = new Date(req.params.dayTo);
  res.json({
    maxPrice: Number(getMaxPriceForInterval(dayFrom, dayTo))/*TODO assert number cast but generally we don't care*/,
  });
});

app.get('/loserCount', (req, res) => {
  res.json({
    loserCount: loserCountToday(),
  });
});

app.get('/topRevenue', (req, res) => {
  res.json({
    topRevenue: getTopRevenueToday(),
  });
});

const port = process.env.PORT || 3333;
const server = app.listen(port, async () => {
  await runReactions();
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

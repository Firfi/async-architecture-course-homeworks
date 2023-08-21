import express from 'express';
import bodyParser from 'body-parser';
import { run as runReactions } from './reactions';
import { getTotalStonksForDate } from './db';
import { consumer, producer } from './kafka';
import { makeAuthMiddleware, useCanRole } from '../../utils/src/lib/auth';
import { ROLE_ACCOUNTANT, ROLE_ADMIN } from '@monorepo/utils';

const app = express();

app.use(bodyParser.json());

const port = parseInt(process.env.PORT || '3002', 10);
const server = app.listen(port, async () => {
  await runReactions();
  await consumer.connect();
  await producer.connect();
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

const fiefAuthMiddleware = makeAuthMiddleware(app, port);

app.get('/stonks', fiefAuthMiddleware(), useCanRole([ROLE_ACCOUNTANT, ROLE_ADMIN]), async (req, res) => {
  const stonks = getTotalStonksForDate(new Date());
  res.send({ stonks });
});

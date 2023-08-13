import express from 'express';
import bodyParser from 'body-parser';
import { run as runReactions } from './reactions';
import { getTotalStonksForDate } from './db';

const app = express();

app.use(bodyParser.json());

const port = process.env.PORT || 3333;
const server = app.listen(port, async () => {
  await runReactions();
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

app.get('/stonks', async (req, res) => {
  const stonks = getTotalStonksForDate(new Date());
  res.send({ stonks });
});

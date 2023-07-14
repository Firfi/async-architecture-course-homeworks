/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import express from 'express';
import * as path from 'path';
import { routes } from './features/routes';
import bodyParser from 'body-parser';

const app = express();

app.use(bodyParser.json())

const API_PREFIX = '/api' as const;

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get(API_PREFIX, (req, res) => {
  res.send({ message: 'Welcome to service-template!' });
});

routes.forEach((route) => {
  app[route.method](`${API_PREFIX}${route.path}`, route.handler);
});

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);

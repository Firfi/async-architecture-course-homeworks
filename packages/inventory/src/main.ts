import express, { RequestHandler } from 'express';

import * as fief from '@fief/fief';
import * as fiefExpress from '@fief/fief/express';
import { Request, Response } from 'express-serve-static-core';
import { FiefUserInfo } from '@fief/fief/src/client';
import * as S from '@effect/schema/Schema';
import {
  assertExists,
  assertNonEmptyAndAssigned,
  castSome,
} from '@monorepo/utils';
import { pipe } from 'fp-ts/function';
import * as STR from 'fp-ts/string';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import { Kafka } from 'kafkajs';
import { User, USER_TOPIC_NAME } from '@monorepo/kafka-users-common';
import { TaskFsm } from './task/fsm';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = express();

const SESSION_COOKIE_NAME = 'user_session';
const REDIRECT_URI = `http://localhost:${port}/auth-callback`;

class MemoryUserInfoCache<Id extends string, T> {
  storage: Record<Id, T>;
  constructor() {
    this.storage = {} as Record<Id, T>;
  }

  async get(id: Id): Promise<T | null> {
    const userinfo = this.storage[id];
    if (userinfo) {
      return userinfo;
    }
    return null;
  }

  async set(id: Id, userinfo: T) {
    this.storage[id] = userinfo;
  }

  async remove(id: Id) {
    delete this.storage[id];
  }

  async clear() {
    this.storage = {} as Record<Id, T>;
  }
}

type UserInfoCacheId = string;

const userInfoCache = new MemoryUserInfoCache<UserInfoCacheId, FiefUserInfo>();

const fiefClient = new fief.Fief({
  baseURL: 'http://localhost:8000',
  clientId: 'GNggKmhPlgowVLktPFRRgiAbOh1JfyY0POXmvIa5kE4',
  clientSecret: 'dp6H8D1gPmdEA4gxd7izO0KDAp9JAbgQswxwTdGQrQo',
});

const unauthorizedResponse = async (req: Request, res: Response) => {
  const authURL = await fiefClient.getAuthURL({
    redirectURI: REDIRECT_URI,
    scope: ['openid'],
  });
  res.redirect(307, authURL);
};

const fiefAuthMiddleware = fiefExpress.createMiddleware({
  client: fiefClient,
  tokenGetter: fiefExpress.cookieGetter(SESSION_COOKIE_NAME),
  unauthorizedResponse,
  userInfoCache,
});

const AuthCallbackCodeBrand = Symbol.for('AuthCallbackCode');
const AuthCallbackCode = S.string.pipe(S.brand(AuthCallbackCodeBrand));
type AuthCallbackCode = S.To<typeof AuthCallbackCode>;

app.get('/auth-callback', async (req, res) => {
  const code = S.parseSync(AuthCallbackCode)(req.query['code']);
  const [tokens, userinfo] = await fiefClient.authCallback(code, REDIRECT_URI);

  // TODO save userinfo just like it came from kafka
  void userInfoCache.set(userinfo.sub, userinfo);

  res.cookie(SESSION_COOKIE_NAME, tokens.access_token, {
    maxAge: tokens.expires_in * 1000,
    httpOnly: true,
    secure: false,
  });
  res.redirect('/protected');
});

app.get('/protected', fiefAuthMiddleware(), (req, res) => {
  res.send(
    `<h1>You are authenticated. Your user email is ${
      assertExists(req.user).email
    }</h1>`
  );
});

app.get('/authenticated', fiefAuthMiddleware(), (req, res) => {
  res.json(req.accessTokenInfo);
});

app.get(
  '/authenticated-scope',
  fiefAuthMiddleware({ scope: ['openid', 'required_scope'] }),
  (req, res) => {
    res.json(req.accessTokenInfo);
  }
);

app.get(
  '/authenticated-permissions',
  fiefAuthMiddleware({ permissions: ['castles:read'] }),
  (req, res) => {
    res.json(req.accessTokenInfo);
  }
);

const KAFKA_BROKERS_ENV = pipe(
  process.env.KAFKA_BROKERS,
  assertNonEmptyAndAssigned,
  STR.split(','),
  RNEA.filter((s) => s !== ''),
  castSome
);

const kafka = new Kafka({
  clientId: 'inventory',
  brokers: [...KAFKA_BROKERS_ENV],
});

const consumer = kafka.consumer({ groupId: 'inventory' });

app.listen(port, host, async () => {
  console.log(`[ ready ] http://${host}:${port}`);
  console.log('TaskFsm.serialize()', TaskFsm.serialize());
  console.log('TaskFsm.states()', TaskFsm.states());
  console.log('TaskFsm.history', TaskFsm.history);

  await consumer.connect();
  await consumer.subscribe({ topic: USER_TOPIC_NAME, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (topic === USER_TOPIC_NAME) {
        const user = pipe(
          message.value,
          assertExists,
          (v) => v.toString(),
          JSON.parse,
          S.parseSync(User)
        );
        console.log('user in inventory', user);
      }
    },
  });
});

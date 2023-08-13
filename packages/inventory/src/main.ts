import express, { RequestHandler } from 'express';

import * as fief from '@fief/fief';
import * as fiefExpress from '@fief/fief/express';
import { Request, Response } from 'express-serve-static-core';
import { FiefUserInfo } from '@fief/fief/src/client';
import * as S from '@effect/schema/Schema';
import { assertExists, assertNonEmptyAndAssigned } from '@monorepo/utils';
import { apply, flow, pipe } from 'fp-ts/function';
import { Kafka } from 'kafkajs';
import {
  FiefUser,
  ROLE_ADMIN,
  ROLE_MANAGER,
  User,
  USER_TOPIC_NAME,
  UserId,
} from '@monorepo/kafka-users-common';
import { users } from './user/db';
import { isSome } from 'fp-ts/Option';
import { reassign as reassign_ } from './task/reassigner';
import { get as getTask, set as setTask, listAssigned } from './task/db';
import {
  makeReportReassign,
  REASSIGN_TOPIC_NAME,
} from './task/reassigner/kafka';
import { KAFKA_BROKERS_ENV } from './env';
import { isLeft } from 'fp-ts/Either';
import {
  create as create_,
  assign as assign_,
  complete as complete_,
  ReportTaskEvent,
} from './task/fsm';
import { TaskId } from './task/model';
import { report as report_, TASK_EVENTS_TOPIC_NAME } from './task/topic';
import bodyParser from 'body-parser';
import { shuffleStrategy } from './task/reassigner/strategy';

const host = process.env.HOST ?? '0.0.0.0';
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = express();
app.use(bodyParser.json());

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

const OAUTH_BASE_URL = assertNonEmptyAndAssigned(
  process.env.OAUTH_BASE_URL || 'http://localhost:8000'
);

const fiefClient = new fief.Fief({
  baseURL: OAUTH_BASE_URL,
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
export const SHUFFLERS = [ROLE_ADMIN, ROLE_MANAGER] as const;
export const Shuffler = S.literal(...SHUFFLERS);
export type Shuffler = S.To<typeof Shuffler>;

const kafka = new Kafka({
  clientId: 'inventory',
  brokers: [...KAFKA_BROKERS_ENV],
});

const producer = kafka.producer();
const reportTask: ReportTaskEvent = report_(producer);

const reassign = pipe(
  reassign_,
  apply({
    listAssigned: listAssigned,
    reportReassign: makeReportReassign(producer),
  })
);

// reassign
app.post('/shuffle', fiefAuthMiddleware(), async (req, res) => {
  const can = pipe(
    req.user,
    assertExists,
    S.parseSync(FiefUser),
    (u) => u.fields.role,
    S.parseOption(Shuffler),
    isSome
  );
  if (!can) {
    res.status(403).send('Forbidden');
    return;
  }
  const r = await reassign();
  if (isLeft(r)) {
    console.error('error reassigning', r.left);
    res.status(500).send('Internal Server Error');
    return;
  } else {
    res.status(200).send('OK');
    return;
  }
});

const deps = {
  get: getTask,
  set: setTask,
  report: reportTask,
};

const create = flow(create_, apply(deps));

const CreateBody = S.struct({
  title: S.string.pipe(S.nonEmpty()),
  description: S.string.pipe(S.nonEmpty()),
});

app.post('/create', fiefAuthMiddleware(), async (req, res) => {
  const _user = assertExists(req.user); // never trust myself
  const body = S.parseSync(CreateBody)(req.body);
  const r = await create(body.title, body.description)();
  if (isLeft(r)) {
    console.error('error creating', r.left);
    res.status(500).send('Internal Server Error');
    return;
  } else {
    res.status(200).send('OK');
    return;
  }
});

const assign = flow(assign_, apply(deps));

app.post('/assign/:id', fiefAuthMiddleware(), async (req, res) => {
  const can = pipe(
    req.user,
    assertExists,
    S.parseSync(FiefUser),
    (u) => u.fields.role,
    S.parseOption(Shuffler),
    isSome
  );
  if (!can) {
    res.status(403).send('Forbidden');
    return;
  }
  const id = S.parseSync(TaskId)(req.params.id);
  const [assignee, finalize] = shuffleStrategy();
  const r = await assign(id, assignee.id)();
  if (isLeft(r)) {
    console.error('error assigning', r.left);
    res.status(500).send('Internal Server Error');
    return;
  } else {
    finalize();
    res.status(200).send('OK');
    return;
  }
});

const complete = flow(complete_, apply(deps));

app.post('/complete/:id', fiefAuthMiddleware(), async (req, res) => {
  const id = pipe(req.user, assertExists, S.parseSync(FiefUser), (u) => u.sub);
  const taskId = S.parseSync(TaskId)(req.params.id);
  const r = await complete(id, taskId)();
  if (isLeft(r)) {
    console.error('error completing', r.left);
    res.status(500).send('Internal Server Error');
    return;
  } else {
    res.status(200).send('OK');
    return;
  }
});

const consumer = kafka.consumer({ groupId: 'inventory' });

app.listen(port, host, async () => {
  console.log(`[ ready ] http://${host}:${port}`);
  // will console.log error if topic already exists
  await kafka.admin().createTopics({
    topics: [
      { topic: TASK_EVENTS_TOPIC_NAME },
      {
        topic: REASSIGN_TOPIC_NAME,
      },
    ],
  });
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: USER_TOPIC_NAME, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (topic === USER_TOPIC_NAME) {
        // CUDs
        const user = pipe(
          message.value,
          assertExists,
          (v) => v.toString(),
          JSON.parse,
          S.parseSync(User)
        );
        console.log('adding/updating user', user.email, 'role:', user.role);
        users.set(user.id, user);
      }
    },
  });
});

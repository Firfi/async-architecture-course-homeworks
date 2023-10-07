import express, { NextFunction } from 'express';
import { Request, Response } from 'express-serve-static-core';
import * as O from 'fp-ts/Option';
import { isSome } from 'fp-ts/Option';
import * as S from '@effect/schema/Schema';
import {
  assertExists,
  FiefUser,
  Role,
  ROLE_ADMIN,
  ROLE_MANAGER,
  ROLE_WORKER,
  User,
  UserId,
} from '@monorepo/utils';
import { apply, flow, pipe } from 'fp-ts/function';
import { Kafka } from 'kafkajs';
import {
  KAFKA_BROKERS_ENV,
  USER_TOPIC_NAME,
} from '@monorepo/kafka-users-common';
import { users } from './user/db';
import {
  listen as listenReassign,
  reassign as reassign_,
} from './task/reassigner';
import { get as getTask, listAssigned, set as setTask } from './task/db';
import {
  makeReportReassign,
  REASSIGN_TOPIC_NAME,
} from './task/reassigner/kafka';
import { isLeft } from 'fp-ts/Either';
import {
  assign as assign_,
  complete as complete_,
  create as create_,
  ReportTaskEvent,
} from './task/fsm';
import { report as report_ } from './task/topic';
import bodyParser from 'body-parser';
import { shuffleStrategy } from './task/reassigner/strategy';
import { match } from 'ts-pattern';
import {
  JiraId,
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TASK_EVENT_CREATE,
  TaskEvent,
  TaskId,
} from '@monorepo/taskos-common/schema';
import { TASK_EVENTS_TOPIC_NAME } from '../../kafka-users-common/src/lib/topics';
import { makeAuthMiddleware, useCanRole } from '../../utils/src/lib/auth';

const host = process.env.HOST ?? '0.0.0.0';
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

const app = express();
app.use(bodyParser.json());

const fiefAuthMiddleware = makeAuthMiddleware(app, port);

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
  clientId: 'taskos',
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
app.post(
  '/shuffle',
  fiefAuthMiddleware(),
  useCanRole(SHUFFLERS),
  async (req, res) => {
    const r = await reassign();
    if (isLeft(r)) {
      console.error('error reassigning', r.left);
      res.status(500).send('Internal Server Error');
      return;
    } else {
      res.status(200).send('OK');
      return;
    }
  }
);

const deps = {
  get: getTask,
  set: setTask,
  report: reportTask,
};

const create = flow(create_, apply(deps));

const CreateBody = S.struct({
  title: S.string.pipe(S.nonEmpty()),
  jiraId: JiraId,
  description: S.string.pipe(S.nonEmpty()),
});

app.post(
  '/create',
  fiefAuthMiddleware(),
  useCanRole(['any']),
  async (req, res) => {
    const body = S.parseSync(CreateBody)(req.body);
    const r = await create(body.title, body.jiraId, body.description)();
    if (isLeft(r)) {
      console.error('error creating', r.left);
      res.status(500).send('Internal Server Error');
      return;
    } else {
      res.status(200).send('OK');
      return;
    }
  }
);

const assign = flow(assign_, apply(deps));

app.post(
  '/assign/:id',
  fiefAuthMiddleware(),
  useCanRole(SHUFFLERS),
  async (req, res) => {
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
  }
);

const complete = flow(complete_, apply(deps));

app.post(
  '/complete/:id',
  fiefAuthMiddleware(),
  useCanRole([ROLE_WORKER]),
  async (req, res) => {
    const id = pipe(
      req.user,
      assertExists,
      S.parseSync(FiefUser),
      (u) => u.sub
    );
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
  }
);

const consumer = kafka.consumer({ groupId: 'taskos' });

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
  await listenReassign({
    get: getTask,
    set: setTask,
    report: reportTask,
  });
});

// example consumer code for task events
const consumeTaskEvent = async (taskEvent: TaskEvent) =>
  match(taskEvent)
    .with(
      {
        type: TASK_EVENT_CREATE,
      },
      (t_) =>
        match(t_)
          .with(
            {
              version: 1,
            },
            (t) => {
              const v: 1 = t.version;
              // @ts-expect-error-next-line
              const j: never = t.jiraId;
            }
          )
          .with(
            {
              version: 2,
            },
            (t) => {
              const v: 2 = t.version;
              const j: JiraId = t.jiraId;
            }
          )
          .exhaustive()
    )
    .with(
      {
        type: TASK_EVENT_ASSIGN,
      },
      (t_) => {
        const v: 1 = t_.version;
        const a: UserId = t_.assignee;
      }
    )
    .with(
      {
        type: TASK_EVENT_COMPLETE,
      },
      (t_) => {
        const v: 1 = t_.version;
        const r: number = t_.reward;
      }
    )
    .exhaustive();

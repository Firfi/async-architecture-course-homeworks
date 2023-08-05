import express from 'express';
import { assertNonEmptyAndAssigned, castSome } from '@monorepo/utils';
import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import * as S from '@effect/schema/Schema';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as STR from 'fp-ts/string';
import { Kafka } from 'kafkajs';
import { pipe } from 'fp-ts/function';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

const FIEF_SECRET = assertNonEmptyAndAssigned(process.env.FIEF_SECRET);

const FIEF_EVENT_TYPE_USER_CREATED = 'user.created';
const FIEF_EVENT_TYPE_USER_UPDATED = 'user.updated';
// TODO we dont care about deletion rn
const FIEF_EVENT_TYPE_USER_DELETED = 'user.deleted';
const FIEF_EVENT_TYPES = [
  FIEF_EVENT_TYPE_USER_CREATED,
  FIEF_EVENT_TYPE_USER_UPDATED,
] as const;
type FiefEventType = (typeof FIEF_EVENT_TYPES)[number];

const ROLE_WORKER = 'worker';
const ROLE_ADMIN = 'admin';
const ROLE_MANAGER = 'manager';
const ROLE_ACCOUNTANT = 'accountant';
const ROLES = [ROLE_WORKER, ROLE_ADMIN, ROLE_MANAGER, ROLE_ACCOUNTANT] as const;

const Role = S.literal(...ROLES);

const USER_TOPIC_NAME = 'user';

const UserEvent = S.struct({
  type: S.literal(...FIEF_EVENT_TYPES),
  data: S.struct({
    created_at: S.string,
    updated_at: S.string,
    id: S.string,
    email: S.string,
    is_active: S.boolean,
    is_superuser: S.boolean,
    is_verified: S.boolean,
    tenant_id: S.string,
    tenant: S.struct({
      created_at: S.string,
      updated_at: S.string,
      id: S.string,
      name: S.string,
      default: S.boolean,
      slug: S.string,
      registration_allowed: S.boolean,
      theme_id: S.nullable(S.string),
      logo_url: S.nullable(S.string),
      application_url: S.nullable(S.string),
    }),
    fields: S.struct({
      role: Role,
    }),
  }),
});

type UserEvent = S.From<typeof UserEvent>;

const User = S.struct({
  id: S.string,
  email: S.string,
  role: Role,
});

type User = S.From<typeof User>;

const userEventToUser = (ue: UserEvent): User => ({
  id: ue.data.id,
  email: ue.data.email,
  role: ue.data.fields.role,
});

// comma-separated i.e. kafka1:9092,kafka2:9092
const KAFKA_BROKERS_ENV = pipe(
  process.env.KAFKA_BROKERS,
  assertNonEmptyAndAssigned,
  STR.split(','),
  RNEA.filter((s) => s !== ''),
  castSome
);

const kafka = new Kafka({
  clientId: 'auth-adapter',
  brokers: [...KAFKA_BROKERS_ENV],
});

const producer = kafka.producer();

app.post('/webhook', async (req, res) => {
  const timestamp = req.header('X-Fief-Webhook-Timestamp');
  const signature = req.header('X-Fief-Webhook-Signature');
  let payload = '';

  req.on('data', (chunk) => {
    payload += chunk;
  });

  req.on('end', async () => {
    // Check if timestamp and signature are there
    if (!timestamp || !signature) {
      res.status(StatusCodes.UNAUTHORIZED).send();
      return;
    }

    // Check if timestamp is not older than 5 minutes
    if (Math.floor(Date.now() / 1000) - Number(timestamp) > 5 * 60) {
      res.status(StatusCodes.UNAUTHORIZED).send();
      return;
    }

    // Compute signature
    const message = `${timestamp}.${payload}`;
    const hash = crypto
      .createHmac('sha256', FIEF_SECRET)
      .update(message)
      .digest('hex');

    // Check if the signatures match
    if (hash !== signature) {
      console.warn('hash !== signature');
      res.status(StatusCodes.UNAUTHORIZED).send();
      return;
    }
    // Good to go!
    const data: UserEvent = S.parseSync(UserEvent)(JSON.parse(payload));
    await producer.send({
      topic: USER_TOPIC_NAME,
      messages: [
        {
          value: JSON.stringify(userEventToUser(data)),
        },
      ],
    });
    console.log(data);
    // TODO user group changed business event

    res.status(StatusCodes.OK).send();
  });
});

app.listen(port, host, async () => {
  // will console.log error if topic already exists
  await kafka.admin().createTopics({
    topics: [{ topic: USER_TOPIC_NAME }],
  });
  await producer.connect(); // ?? deranged ??
  console.log(`[ ready ] http://${host}:${port}`);
});
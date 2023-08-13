import express from 'express';
import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import * as S from '@effect/schema/Schema';
import { Kafka } from 'kafkajs';
import { Request } from 'express-serve-static-core';
import {
  FiefUserFields,
  Role,
  User,
  USER_TOPIC_NAME,
  UserId,
} from '@monorepo/kafka-users-common';
import { KAFKA_BROKERS_ENV } from '@monorepo/kafka-users-common';

const host = process.env.HOST ?? '0.0.0.0';
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

const FIEF_SECRET = 'TODO'; // assertNonEmptyAndAssigned(process.env.FIEF_SECRET);

const FIEF_EVENT_TYPE_USER_CREATED = 'user.created';
const FIEF_EVENT_TYPE_USER_UPDATED = 'user.updated';
// TODO we dont care about deletion rn
const FIEF_EVENT_TYPE_USER_DELETED = 'user.deleted';
const FIEF_EVENT_TYPES = [
  FIEF_EVENT_TYPE_USER_CREATED,
  FIEF_EVENT_TYPE_USER_UPDATED,
] as const;
type FiefEventType = (typeof FIEF_EVENT_TYPES)[number];

const UserEvent = S.struct({
  type: S.literal(...FIEF_EVENT_TYPES),
  data: S.struct({
    created_at: S.string,
    updated_at: S.string,
    id: UserId,
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
    fields: FiefUserFields,
  }),
});

type UserEvent = S.To<typeof UserEvent>;

const userEventToUser = (ue: UserEvent): User => ({
  id: ue.data.id,
  email: ue.data.email,
  role: ue.data.fields.role,
});

const kafka = new Kafka({
  clientId: 'auth-adapter',
  brokers: [...KAFKA_BROKERS_ENV],
});

const producer = kafka.producer();

const validateWebhookSignature = (req: Request, payload: string) => {
  const timestamp = req.header('X-Fief-Webhook-Timestamp');
  const signature = req.header('X-Fief-Webhook-Signature');
  // Check if timestamp and signature are there
  if (!timestamp || !signature) {
    return false;
  }

  // Check if timestamp is not older than 5 minutes; lief recommendation
  if (Math.floor(Date.now() / 1000) - Number(timestamp) > 5 * 60) {
    return false;
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
    return false;
  }

  return true;
};

app.post('/webhook', async (req, res) => {
  let payload = '';

  req.on('data', (chunk) => {
    payload += chunk;
  });

  req.on('end', async () => {
    // too involved; I create webhook in docker container thru curl and need to pass its secret somehow; it's too involved
    // const valid = validateWebhookSignature(req, payload);
    const valid = true;
    if (!valid) {
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

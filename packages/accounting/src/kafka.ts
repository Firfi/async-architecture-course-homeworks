import { Kafka } from 'kafkajs';
import { KAFKA_BROKERS_ENV } from '@monorepo/kafka-users-common';
import { BOOK_COMPANY_STONKS, BOOK_USER_STONKS, BooksAggregate } from './db';
import { UserAccountsCUD } from '@monorepo/taskos-common/schema';
import { ACCOUNTING_TOPIC_NAME } from '../../kafka-users-common/src/lib/topics';
import { UserId } from '@monorepo/utils';

export const kafka = new Kafka({
  clientId: 'accounting',
  brokers: [...KAFKA_BROKERS_ENV],
});

export const consumer = kafka.consumer({ groupId: 'accounting' });
export const producer = kafka.producer();

// TODO probably no outbox here, we don't really care about this so much
export const reportAccountsAggregate = (
  userId: UserId,
  booksAggregates: {
    current: BooksAggregate;
    previous: BooksAggregate;
  },
  timestamp: Date
) => {
  const { current, previous } = booksAggregates;
  const STONKS_KEY = BOOK_USER_STONKS;
  const currentBalance =
    current[STONKS_KEY].increase - current[STONKS_KEY].decrease;
  const previousBalance =
    previous[STONKS_KEY].increase - previous[STONKS_KEY].decrease;
  const event: UserAccountsCUD = {
    type: 'UserAccountsCUD' as const,
    version: 1,
    timestamp: timestamp.getTime(),
    userId,
    current: {
      balance: Number(currentBalance),
    },
    previous: {
      balance: Number(previousBalance),
    },
  };
  return producer.send({
    topic: ACCOUNTING_TOPIC_NAME,
    messages: [
      {
        value: JSON.stringify(event),
      },
    ],
  });
};

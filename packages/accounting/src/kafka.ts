import { Kafka } from 'kafkajs';
import { KAFKA_BROKERS_ENV } from '@monorepo/kafka-users-common';

export const kafka = new Kafka({
  clientId: 'accounting',
  brokers: [...KAFKA_BROKERS_ENV],
});

export const consumer = kafka.consumer({ groupId: 'accounting' });
export const producer = kafka.producer();

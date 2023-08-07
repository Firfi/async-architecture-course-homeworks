import { pipe } from 'fp-ts/function';
import { assertNonEmptyAndAssigned, castSome } from '@monorepo/utils';
import * as STR from 'fp-ts/string';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';

export const KAFKA_BROKERS_ENV = pipe(
  process.env.KAFKA_BROKERS || 'localhost:9094',
  assertNonEmptyAndAssigned,
  STR.split(','),
  RNEA.filter((s) => s !== ''),
  castSome
);

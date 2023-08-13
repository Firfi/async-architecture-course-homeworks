// TODO move to utils, but no want boilerplate in homework pr yet

// comma-separated i.e. kafka1:9092,kafka2:9092
import { pipe } from 'fp-ts/function';
import { assertNonEmptyAndAssigned, castSome } from '@monorepo/utils';
import * as RNEA from 'fp-ts/ReadonlyNonEmptyArray';
import * as STR from 'fp-ts/string';

export const KAFKA_BROKERS_ENV = pipe(
  process.env['KAFKA_BROKERS'],
  assertNonEmptyAndAssigned,
  STR.split(','),
  RNEA.filter((s) => s !== ''),
  castSome
);

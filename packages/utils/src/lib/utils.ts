import { Option } from 'fp-ts/Option';
import { flow } from 'fp-ts/function';
import * as S from '@effect/schema/Schema';

export const assertExists = <T>(x: T): Exclude<T, null | undefined> =>
  x === null || x === undefined
    ? (() => {
        throw new Error('Assertion failed');
      })()
    : (x as Exclude<T, null | undefined>);

export const assertNonEmptyAndAssigned = <T>(
  x: T | undefined | null | ''
): T => {
  const x_ = assertExists(x);
  if (x_ === '') {
    throw new Error('Assertion failed');
  }
  return x_;
};

// cast Some<T> to T and throw if it's None
export const castSome = <T>(x: Option<T>): T => {
  if (x._tag === 'None') {
    throw new Error('Assertion failed');
  }
  return x.value;
};

export const uuidToHexUnsafe = (uuid: string) => uuid.replace(/-/g, '');

export const hexToBigintUnsafe = (hex: string /*TODO?*/) => BigInt(`0x${hex}`);

// go around, it's fine
export const bigintToNumberUnsafe = (x: bigint): number => Number(x);

export const uuidToNumberUnsafe = flow(
  uuidToHexUnsafe,
  hexToBigintUnsafe,
  bigintToNumberUnsafe
);

export const MonetaryAmount = S.number.pipe(S.int(), S.nonNegative());
export const MonetaryAmountPositive = MonetaryAmount.pipe(S.positive());

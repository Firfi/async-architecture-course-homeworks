import { Option } from 'fp-ts/Option';

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

// case Some<T> to T and throw if it's None
export const castSome = <T>(x: Option<T>): T => {
  if (x._tag === 'None') {
    throw new Error('Assertion failed');
  }
  return x.value;
};

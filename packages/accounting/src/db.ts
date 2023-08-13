import { UserId } from '@monorepo/kafka-users-common';
import { TaskId } from '@monorepo/inventory-common/schema';
import { pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';

const BOOK_MAGIC_REVENUE = 'magicRevenue' as const;
const BOOK_COMPANY_STONKS = 'companyStonks' as const;
const BOOK_USER_STONKS = 'userStonks' as const;

const BOOKS = [
  BOOK_COMPANY_STONKS,
  BOOK_USER_STONKS,
  BOOK_MAGIC_REVENUE,
] as const;

const ASSET = 'asset' as const;
const LIABILITY = 'liability' as const;
const REVENUE = 'revenue' as const;

const ACCOUNT_TYPES = [ASSET, LIABILITY, REVENUE] as const;

const DEBIT = 'debit' as const;
type Debit = typeof DEBIT;
const CREDIT = 'credit' as const;
type Credit = typeof CREDIT;

const INCREASE = 'increase' as const;
const DECREASE = 'decrease' as const;

const INC_DEC = [INCREASE, DECREASE] as const;
const DEB_CRED_REV = [DEBIT, CREDIT] as const;
type IncDec = (typeof INC_DEC)[number];
type DebCred = (typeof DEB_CRED_REV)[number];

const DEB_CRED_LINGO = {
  [ASSET]: {
    [DEBIT]: INCREASE,
    [CREDIT]: DECREASE,
  },
  [LIABILITY]: {
    [DEBIT]: DECREASE,
    [CREDIT]: INCREASE,
  },
  [REVENUE]: {
    [DEBIT]: DECREASE,
    [CREDIT]: INCREASE,
  },
} satisfies {
  [k in AccountType]: {
    [k in DebCred]: IncDec;
  };
};

type DebCredOf<AT extends AccountType> = (typeof DEB_CRED_LINGO)[AT];

type AccountType = (typeof ACCOUNT_TYPES)[number];

type Book = (typeof BOOKS)[number];

const ACCOUNT_TYPE_MAP = {
  [BOOK_COMPANY_STONKS]: ASSET,
  [BOOK_USER_STONKS]: LIABILITY,
  [BOOK_MAGIC_REVENUE]: REVENUE,
} as const satisfies {
  [k in Book]: AccountType;
};

// TODO it should have idempotency key
// pretty sure it's possible to strictly type-check but we don't want it in general case, and here we're just lucky we always have 2 legs
type Entry<
  D extends Book,
  C extends Book,
  Metadata extends Record<string, unknown> = Record<string, unknown>
> = {
  debit: D;
  credit: C;
  amount: bigint;
  date: Date;
  metadata: Metadata;
};

type PenaltyMetadata = {
  taskId: TaskId;
};

type RewardMetadata = {
  taskId: TaskId;
};

type TaskAssignedPenaltyMovementEntry = Entry<
  typeof BOOK_USER_STONKS,
  typeof BOOK_COMPANY_STONKS,
  PenaltyMetadata
>;
type TaskCompleteRewardMovementEntry = Entry<
  typeof BOOK_COMPANY_STONKS,
  typeof BOOK_USER_STONKS,
  RewardMetadata
>;
type PayoutMovementEntry = Entry<
  typeof BOOK_USER_STONKS,
  typeof BOOK_MAGIC_REVENUE /*we do magically increase company stonks since money appear from nowhere*/
>;

type MovementEntry =
  | TaskAssignedPenaltyMovementEntry
  | TaskCompleteRewardMovementEntry
  | PayoutMovementEntry;

type Shelf = {
  entries: MovementEntry[];
  books: {
    [k in Book]: {
      // totals
      [INCREASE]: bigint;
      [DECREASE]: bigint;
    };
  };
};

// we're also lucky there are no transactions between users; Map will do
const db: Map<UserId, Shelf> = new Map();

const emptyShelf = () =>
  ({
    entries: [],
    books: {
      [BOOK_COMPANY_STONKS]: {
        [INCREASE]: BigInt(0),
        [DECREASE]: BigInt(0),
      },
      [BOOK_USER_STONKS]: {
        [INCREASE]: BigInt(0),
        [DECREASE]: BigInt(0),
      },
      [BOOK_MAGIC_REVENUE]: {
        [INCREASE]: BigInt(0),
        [DECREASE]: BigInt(0),
      },
    },
  } satisfies Shelf);

const incDec = (b: Book, dc: DebCred) =>
  DEB_CRED_LINGO[ACCOUNT_TYPE_MAP[b]][dc];

const reflectEntry = (books: Shelf['books'], entry: MovementEntry) => ({
  ...books,
  [entry[DEBIT]]: {
    ...books[entry[DEBIT]],
    [incDec(entry[DEBIT], DEBIT)]:
      books[entry[DEBIT]][incDec(entry[DEBIT], DEBIT)] + entry.amount,
  },
  [entry[CREDIT]]: {
    ...books[entry[CREDIT]],
    [incDec(entry[CREDIT], CREDIT)]:
      books[entry[CREDIT]][incDec(entry[CREDIT], CREDIT)] + entry.amount,
  },
});

export const penalty = (userId: UserId, taskId: TaskId, amount: bigint) => {
  const shelf = db.get(userId) ?? emptyShelf();
  const debCred = {
    [DEBIT]: BOOK_USER_STONKS,
    [CREDIT]: BOOK_COMPANY_STONKS,
  };
  // book -> increase/decrease

  const entry: TaskAssignedPenaltyMovementEntry = {
    ...debCred,
    amount,
    date: new Date(),
    metadata: {
      taskId,
    },
  };
  db.set(userId, {
    entries: [...shelf.entries, entry],
    books: reflectEntry(shelf.books, entry),
  });
};

export const reward = (userId: UserId, taskId: TaskId, amount: bigint) => {
  const shelf = db.get(userId) ?? emptyShelf();
  const entry: TaskCompleteRewardMovementEntry = {
    debit: BOOK_COMPANY_STONKS,
    credit: BOOK_USER_STONKS,
    amount,
    date: new Date(),
    metadata: {
      taskId,
    },
  };
  db.set(userId, {
    entries: [...shelf.entries, entry],
    books: reflectEntry(shelf.books, entry),
  });
};

export const payout = (userId: UserId, amount: bigint) => {
  const shelf = db.get(userId) ?? emptyShelf();
  const entry: PayoutMovementEntry = {
    debit: BOOK_USER_STONKS,
    credit: BOOK_MAGIC_REVENUE,
    amount,
    date: new Date(),
    metadata: {},
  };
  db.set(userId, {
    entries: [...shelf.entries, entry],
    books: reflectEntry(shelf.books, entry),
  });
};

// TODO non-negative in types...
// TODO prepareOutstandingPayout actually; we don't want no double calls
// or transactional db
export const getOutstandingPayout = (userId: UserId): bigint =>
  pipe(
    (db.get(userId) ?? emptyShelf()).books[BOOK_USER_STONKS],
    (book) => book[INCREASE] - book[DECREASE],
    (x) => (x < BigInt(0) ? BigInt(0) : x)
  );

export const getOutstandingPayouts = (): Record<UserId, bigint> =>
  pipe(
    [...db.keys()],
    A.map((userId) => [userId, getOutstandingPayout(userId)] as const),
    A.filter(([_, amount]) => amount > BigInt(0)),
    A.reduce({}, (acc, [userId, amount]) => ({ ...acc, [userId]: amount }))
  );

const getStartOfTheDay = (date: Date) => {
  // TODO TIMEZONE :derp:
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

// (sum(completed task amount) + sum(assigned task fee)) * -1
export const getTotalStonksForDate = (date: Date): bigint =>
  pipe(
    [...db.values()],
    A.flatMap((s) => s.entries),
    A.filter(
      (
        (sd) => (e) =>
          e.date >= sd
      )(getStartOfTheDay(date))
    ),
    A.map((e) =>
      e.debit === BOOK_COMPANY_STONKS ? e.amount : e.amount * BigInt(-1)
    ),
    A.reduce(BigInt(0), (x, y) => x + y)
  );

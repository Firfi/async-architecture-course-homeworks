import { UserId } from '@monorepo/kafka-users-common';

const startOfTheDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// TODO test it
// i.e. 1970-01-01 00:00:00 is 0; 1970-01-02 00:00:00 is 1; etc
const getDayIntFrom1970 = (d: Date): bigint =>
  BigInt(startOfTheDay(d).getTime()) / BigInt(1000 * 60 * 60 * 24);

const priceDb: Map<bigint, bigint> = new Map();

const constNullStats = Object.freeze({
  topRevenue: BigInt(0),
  losers: Object.freeze([] as UserId[]),
});

const statsDb: Map<bigint, typeof constNullStats> = new Map();

const max = (...args: bigint[]) => args.reduce((m, e) => e > m ? e : m);

export const onPrice = (price: bigint, timestamp: Date) => {
  const key = getDayIntFrom1970(timestamp);
  const current = priceDb.get(key) ?? BigInt(0);
  priceDb.set(key, max(current, price));
}

export const getMaxPriceForInterval = (dayFrom: Date, dayTo: Date): bigint => {
  const fromKey = getDayIntFrom1970(dayFrom);
  const toKey = getDayIntFrom1970(dayTo);
  let maxPrice = BigInt(0);
  for (let key = fromKey; key <= toKey; key++) {
    const price = priceDb.get(key) ?? BigInt(0);
    maxPrice = max(maxPrice, price);
  }
  return maxPrice;
}

// "Нужно указывать, сколько заработал топ-менеджмент за сегодня и сколько попугов ушло в минус."
export const onUserBalance = (userId: UserId, balance: bigint, previousBalance: bigint, timestamp: Date) => {
  const todayDbKey = getDayIntFrom1970(timestamp);
  // TODO: "how much the company earned" definition is not clear; there is no money income into the system except for magic.
  // it could be that we listen for 1) user balance change 2) non-existing "income"; for now we assume income to be user balance change; although it's not correct entirely
  const todayStats = statsDb.get(todayDbKey) ?? constNullStats;
  const balanceDelta = balance - previousBalance;
  const topRevenue = todayStats.topRevenue - balanceDelta;
  const losers = balanceDelta >= BigInt(0) ? todayStats.losers : [...new Set([...todayStats.losers, userId])];
  statsDb.set(todayDbKey, {
    topRevenue,
    losers,
  });
}

export const getTopRevenueToday = (): bigint => {
  const todayDbKey = getDayIntFrom1970(new Date());
  const todayStats = statsDb.get(todayDbKey) ?? constNullStats;
  return todayStats.topRevenue;
};

export const loserCountToday = (): number => {
  const todayDbKey = getDayIntFrom1970(new Date());
  const todayStats = statsDb.get(todayDbKey) ?? constNullStats;
  return todayStats.losers.length;
}

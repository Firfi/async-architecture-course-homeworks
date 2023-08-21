import { FiefUserInfo } from '@fief/fief/src/client';
import { assertExists, assertNonEmptyAndAssigned, FiefUser, Role } from '@monorepo/utils';
import * as fief from '@fief/fief';
import { Request, Response } from 'express-serve-static-core';
import * as fiefExpress from '@fief/fief/express';
import * as S from '@effect/schema/Schema';
import { Express, NextFunction } from 'express';
import { ReadonlyNonEmptyArray } from 'fp-ts/ReadonlyNonEmptyArray';
import { pipe } from 'fp-ts/function';
import * as O from 'fp-ts/Option';
import { isSome } from 'fp-ts/Option';

const SESSION_COOKIE_NAME = 'user_session';
const REDIRECT_URI = (localPort: number) => `http://localhost:${localPort}/auth-callback`;

class MemoryUserInfoCache<Id extends string, T> {
  storage: Record<Id, T>;
  constructor() {
    this.storage = {} as Record<Id, T>;
  }

  async get(id: Id): Promise<T | null> {
    const userinfo = this.storage[id];
    if (userinfo) {
      return userinfo;
    }
    return null;
  }

  async set(id: Id, userinfo: T) {
    this.storage[id] = userinfo;
  }

  async remove(id: Id) {
    delete this.storage[id];
  }

  async clear() {
    this.storage = {} as Record<Id, T>;
  }
}

type UserInfoCacheId = string;

const userInfoCache = new MemoryUserInfoCache<UserInfoCacheId, FiefUserInfo>();

const OAUTH_BASE_URL = assertNonEmptyAndAssigned(
  process.env['OAUTH_BASE_URL'] || 'http://localhost:8000'
);

const fiefClient = new fief.Fief({
  baseURL: OAUTH_BASE_URL,
  clientId: 'GNggKmhPlgowVLktPFRRgiAbOh1JfyY0POXmvIa5kE4',
  clientSecret: 'dp6H8D1gPmdEA4gxd7izO0KDAp9JAbgQswxwTdGQrQo',
});

const unauthorizedResponse = (redirectUri: string) => async (req: Request, res: Response) => {
  const authURL = await fiefClient.getAuthURL({
    redirectURI: redirectUri,
    scope: ['openid'],
  });
  res.redirect(307, authURL);
};

export const useCanRole = (roles: ReadonlyNonEmptyArray<Role | 'any'>) => (req: Request, res: Response, next: NextFunction) => {
  const can = pipe(
    req.user,
    assertExists,
    S.parseSync(FiefUser),
    (u) => u.fields.role,
    S.parseOption(Role),
    O.chain(O.fromPredicate((r) => roles.includes(r) || roles.includes('any'))),
    isSome
  );
  if (!can) {
    res.status(403).send('Forbidden');
    next('Forbidden');
    return;
  } else {
    next();
  }
};

export const makeAuthMiddleware = (app: Express, localPort: number) => {
  const redirectUri = REDIRECT_URI(localPort);
  app.get('/auth-callback', async (req, res) => {
    const code = S.parseSync(AuthCallbackCode)(req.query['code']);
    const [tokens, userinfo] = await fiefClient.authCallback(code, redirectUri);

    // TODO save userinfo just like it came from kafka
    void userInfoCache.set(userinfo.sub, userinfo);

    res.cookie(SESSION_COOKIE_NAME, tokens.access_token, {
      maxAge: tokens.expires_in * 1000,
      httpOnly: true,
      secure: false,
    });
    res.redirect('/protected');
  });
  return fiefExpress.createMiddleware({
    client: fiefClient,
    tokenGetter: fiefExpress.cookieGetter(SESSION_COOKIE_NAME),
    unauthorizedResponse: unauthorizedResponse(redirectUri),
    userInfoCache
  });
};

const AuthCallbackCodeBrand = Symbol.for('AuthCallbackCode');
const AuthCallbackCode = S.string.pipe(S.brand(AuthCallbackCodeBrand));
type AuthCallbackCode = S.To<typeof AuthCallbackCode>;

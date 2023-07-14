import { RequestHandler } from 'express';
import * as D from 'io-ts/Decoder';
import { Encoder } from 'io-ts/Encoder';

// url would look like '/feature1/:id/blah/:id2', we need a type {id: string, id2: string} from it
export type ParamsFromUrl<Path extends `/${string}`> =
  Path extends `/${infer First}/${infer Rest}` ?
    First extends `:${infer Param}` ?
      { [K in Param]: string } & ParamsFromUrl<`/${Rest}`> :
      ParamsFromUrl<`/${Rest}`> :
    Path extends `:${infer Param}` ?
      { [K in Param]: string } :
      {};

export type ReqDecoder<Params, Body, Query> = D.Decoder<unknown, {
  params: Params,
  body: Body,
  query: Query,
}>;

export type ResBodyEncoder<Body> = Encoder<{}, Body>;

export type HandlerCodecs<Params, ResBody, ReqBody, ReqQuery> = {
  req: ReqDecoder<Params, ReqBody, ReqQuery>,
  resBody: ResBodyEncoder<ResBody>,
};

export const wrapHandler = <Params extends ParamsFromUrl<any>, ResBody, ReqBody, ReqQuery extends object>(codecs: HandlerCodecs<Params, ResBody, ReqBody, ReqQuery>) => <H extends RequestHandler<Params, ResBody, ReqBody, ReqQuery>>(handler: H): H => {
  return ((req, res, next) => {
    try {
      console.log('req.bodyreq.body', req.body)
      const decodedR = codecs.req.decode({
        params: req.params,
        body: req.body,
        query: req.query,
      });
      if (decodedR._tag === 'Left') {
        console.error(JSON.stringify(decodedR.left, null, 2));
        next(new Error(JSON.stringify(decodedR.left, null, 2)));
        return;
      }
      const decoded = decodedR.right;
      req.body = decoded.body;
      req.query = decoded.query;
      req.params = decoded.params;
      handler(req, res, next);
      return;
    } catch (e) {
      next(e)
      return;
    }
    throw new Error('unreachable');
  }) as H;
};

export type FeatureRoute<Path extends `/${string}`, Params extends ParamsFromUrl<Path>, ResBody, ReqBody, ReqQuery extends object> = {
  method: 'get'/*TODO...*/ | 'post' | 'put' | 'delete' | 'patch';
  path: Path;
  handler: RequestHandler<Params, ResBody, ReqBody, ReqQuery>;
}

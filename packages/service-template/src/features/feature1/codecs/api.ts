import * as C from 'io-ts/Codec';
import * as D from 'io-ts/Decoder';
import * as E from 'io-ts/Encoder';
import { flow, pipe } from 'fp-ts/function';
import { iso } from 'newtype-ts';
import { Feature1HandlerCodecs, Feature1Id } from '../types/api';
import { right } from 'fp-ts/Either';
import { ReqDecoder } from '../../types';

export const isoFeature1Id = iso<Feature1Id>();
export const featureIdCodec = C.make(
  pipe(D.string, D.parse(flow(isoFeature1Id.from, right))),
  {
    encode: (id: Feature1Id) => isoFeature1Id.to(id)
  }
);

export const feature1ParamsDecoder = D.struct({
  id: featureIdCodec,
});

const bodyDecoder = D.struct({
  name: D.string,
});

const defaultDecoder: ReqDecoder<{}, {}, {}> = D.struct({
  params: D.struct({}),
  body: D.struct({}),
  query: D.struct({})
});

export const feature1Decoder = pipe(defaultDecoder, D.intersect(
  D.struct({
    params: feature1ParamsDecoder,
    body: bodyDecoder,
  }),
));

export const feature1ResBodyEncoder = E.struct({
  id: featureIdCodec,
});

export const feature1HandlerCodecs: Feature1HandlerCodecs = {
  req: feature1Decoder,
  resBody: E.struct({
    id: featureIdCodec,
  }),
};

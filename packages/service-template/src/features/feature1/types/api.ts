import { Newtype } from 'newtype-ts';
import * as D from 'io-ts/Decoder';
import * as E from 'io-ts/Encoder';
import { HandlerCodecs } from '../../types';
import { feature1Decoder, feature1ParamsDecoder, feature1ResBodyEncoder } from '../codecs/api';

export type Feature1Id = Newtype<{ readonly Feature1Id: unique symbol }, string>;
export type Feature1Params = D.TypeOf<typeof feature1ParamsDecoder>;
export type Feature1Req = D.TypeOf<typeof feature1Decoder>;
export type Feature1HandlerCodecs = HandlerCodecs<Feature1Req['params'], Feature1ResBody, Feature1Req['body'], Feature1Req['query']>;
export type Feature1ResBody = E.TypeOf<typeof feature1ResBodyEncoder>;

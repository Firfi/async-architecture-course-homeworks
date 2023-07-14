import { FeatureRoute } from '../types';
import { feature1Handler } from './handlers';
import { Feature1Req, Feature1ResBody } from './types/api';

export const feature1Route: FeatureRoute<'/feature1/:id', Feature1Req['params'], Feature1ResBody, Feature1Req['body'], Feature1Req['query']> = {
  method: 'post',
  path: '/feature1/:id',
  handler: feature1Handler,
};

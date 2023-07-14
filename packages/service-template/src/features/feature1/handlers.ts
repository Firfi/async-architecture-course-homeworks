import { feature1HandlerCodecs } from './codecs/api';
import { wrapHandler } from '../types';

export const feature1Handler = wrapHandler(feature1HandlerCodecs)((req, res, next) => {
  res.json({
    id: req.params.id,
  });
  next();
});

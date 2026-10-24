import { badRequest } from '../errors.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    throw badRequest('Validation failed', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  req[source === 'query' ? 'validQuery' : 'validBody'] = result.data;
  next();
};

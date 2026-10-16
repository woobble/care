import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@app/web/auth';

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);

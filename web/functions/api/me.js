import { getMe, putMe } from '../../server/sync.js';

export const onRequestGet = ({ request, env }) => getMe(request, env);
export const onRequestPut = ({ request, env }) => putMe(request, env);

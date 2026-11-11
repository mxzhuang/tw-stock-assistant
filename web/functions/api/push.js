import { changePush } from '../../server/sync.js';

export const onRequestPost = ({ request, env }) => changePush(request, env);
export const onRequestDelete = ({ request, env }) => changePush(request, env);

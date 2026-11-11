import { status } from '../../server/sync.js';

export const onRequestGet = ({ env }) => status(env);

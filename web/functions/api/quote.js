import { getQuotes } from '../../server/quote.js';

// GET /api/quote?codes=2330.TW,6488.TWO,TWII
export const onRequestGet = ({ request }) => getQuotes(request);

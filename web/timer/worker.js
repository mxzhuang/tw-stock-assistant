// Cloudflare Worker entry. The workflow writes wrangler.toml next to this file
// (name, repository and the two Cron Triggers) when GH_DISPATCH_TOKEN is set.
import { dispatch } from '../server/timer.js';

export default {
  async scheduled(controller, env) {
    const status = await dispatch(env);
    console.log(`daily workflow requested (cron ${controller.cron}, GitHub ${status})`);
  },
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
import {Request} from "express";
import Mixpanel from 'mixpanel';
// const Matomo = require("matomo-tracker");
// const matomo = config.matomoAPI && new Matomo(3, config.matomoAPI);
const token = process.env.MIXPANEL_TOKEN;
const mixpanel = token
  ? Mixpanel.init(token as string)
  : null;

export function trackAttempt(namespace: string, req: Request, params = {}) {
  try {
    if (!mixpanel) return;

    mixpanel.track(namespace, {
      // @ts-ignore
      distinct_id: req.clientIp,
      // @ts-ignore
      ip: req.clientIp,
      ...params,
    });
  } catch (e) {
    //
  }
}





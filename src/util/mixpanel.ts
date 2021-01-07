// eslint-disable-next-line @typescript-eslint/no-var-requires
import {Request} from "express";
import Mixpanel from 'mixpanel';
import UAParser from 'ua-parser-js';

// const Matomo = require("matomo-tracker");
// const matomo = config.matomoAPI && new Matomo(3, config.matomoAPI);
const token = process.env.MIXPANEL_TOKEN;
const mixpanel = token
  ? Mixpanel.init(token as string)
  : null;

export function trackAttempt(namespace: string, req: Request, params = {}) {
  try {
    if (!mixpanel) return;

    const ua = new UAParser(req.headers['user-agent']);

    mixpanel.track(namespace, {
      // @ts-ignore
      distinct_id: req.clientIp,
      // @ts-ignore
      ip: req.clientIp,
      $browser: ua.getBrowser().name,
      $device: ua.getDevice().model,
      $current_url: req.originalUrl,
      $os: ua.getOS().name,
      ...params,
    });
  } catch (e) {
    //
  }
}





// eslint-disable-next-line @typescript-eslint/no-var-requires
import {Request} from "express";

const Matomo = require("matomo-tracker");
import config from "../../config.json";
const matomo = new Matomo(3, config.matomoAPI);

export function trackAttempt(namespace: string, req: Request, name?: string, v?: string) {
  try {
    if (!config.matomoAPI) return;

    matomo.track({
      url: `http://${config.baseIP || 'localhost'}:8082${req.url}`,
      urlref: `http://${req.hostname}:8082${req.url}`,
      // eslint-disable-next-line @typescript-eslint/camelcase
      action_name: `Request`,
      lang: req.headers["accept-language"],
      ua: req.headers["user-agent"],
      e_c: namespace,
      e_a: 'Attempt',
      e_n: name,
      cip: req.ip,
    });
  } catch (e) {
    //
  }
}

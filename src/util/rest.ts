import config from "../../config.json";

export type RestServerResponse = {
  payload: any;
  error?: boolean;
  meta?: boolean;
}

export const makeResponse = (payload: any, error?: boolean, meta?: any): RestServerResponse => {
  return {
    payload,
    error,
    meta,
  };
};

export const decodeQueryParams = (params: {[k: string]: string} = {}) => {
  const extendBlockSrc = inflateParamList(params.extendBlockSrc);
  const extendFollowSrc = inflateParamList(params.extendFollowSrc);
  const overrideBlockSrc = inflateParamList(params.overrideBlockSrc);
  const overrideFollowSrc = inflateParamList(params.overrideFollowSrc);
  return {
    extendBlockSrc,
    extendFollowSrc,
    overrideBlockSrc,
    overrideFollowSrc,
  };
};

function inflateParamList (param?: string[]|string): string[] | undefined | null   {
  if (typeof param === 'undefined') {
    return param;
  }

  if (param === '*') {
    return null;
  }

  return Array.isArray(param)
    ? param
    : [param];
}

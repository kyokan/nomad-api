export const undotName = (name: string): string => {
  return name.replace(/\./g, '');
};

export const dotName = (name: string): string => {
  return `${undotName(name)}.`;
};

export const serializeUsername = (subdomain: string | null, tld: string): string => {
  if (!tld) {
    return '';
  }

  if (!subdomain) {
    return dotName(tld);
  }

  return `${subdomain}@${dotName(tld)}`;
};

export const parseUsername = (username: string): { tld: string; subdomain: string | null } => {
  const splits = undotName(username).split('@');

  if (splits.length === 1) {
    return {
      tld: splits[0],
      subdomain: null,
    };
  }

  return {
    tld: splits[1],
    subdomain: splits[0],
  };
};

export const isTLD = (username: string): boolean => {
  const { tld, subdomain } = parseUsername(username);
  return !subdomain && !!tld;
};

export const isSubdomain = (username: string): boolean => {
  const { subdomain, tld } = parseUsername(username);

  return !!subdomain && !!tld;
};

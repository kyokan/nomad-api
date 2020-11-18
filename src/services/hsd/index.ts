export default class HSDService {
  host?: string;
  port?: string;
  basePath?: string;
  apiKey?: string;

  constructor(config: {
    host?: string;
    port?: string;
    basePath?: string;
    apiKey?: string;
  }) {
    this.host = config.host;
    this.port = config.port;
    this.basePath = config.basePath;
    this.apiKey = config.apiKey;
  }

  getURL = () => {
    const apiKey = this.apiKey ? `x:${this.apiKey}@` : '';
    const port = this.port ? `:${this.port}` : '';
    const basePath = this.basePath ? `${this.basePath}` : '';
    const host = this.host ? this.host.replace(/http:\/\/|https:\/\//, '') : '';
    return `http://${apiKey}${host}${port}${basePath}`;
  };

  fetchHSDInfo = async () => {
    const hsdResponse = await fetch(this.getURL());
    return await hsdResponse.json();
  };

  fetchNameResource = async (name: string) => {
    const hsdResponse = await fetch(this.getURL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'getnameresource',
        params: [name],
      }),
    });
    return await hsdResponse.json();
  };

  fetchNameInfo = async (name: string) => {
    const hsdResponse = await fetch(this.getURL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'getnameinfo',
        params: [name],
      }),
    });
    return await hsdResponse.json();
  };

  fetchTXOut = async (hash: string, index: number) => {
    const hsdResponse = await fetch(this.getURL(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'gettxout',
        params: [hash, index],
      }),
    });
    return await hsdResponse.json();
  };

  fetchCoins = async (address: string) => {
    const hsdResponse = await fetch(this.getURL() + `/coin/address/${address}`);
    return await hsdResponse.json();
  };
}

import {ChildProcess, execFile, spawn} from "child_process";
import path from "path";
import fs from "fs";
import net from "net";
import logger from "../../util/logger";
import {dirExists} from "../../util/fs";
import {dotName} from "../../util/user";
import config from "../../../config.json";
const appDataPath = './build';
const ddrpdHome = path.join(appDataPath, '.ddrpd');
const ddrpdPath = path.join(appDataPath, 'ddrpd');

const MONIKER_LINE = 5;
const HEARTBEAT_LINE = 6;
const API_KEY_LINE = 9;
const HOST_LINE = 10;

export class DDRPManager {
  private daemon: ChildProcess | null = null;
  onNameSyncedCallback?: (tld: string) => void;

  onNameSynced = (cb: (tld: string) => void) => {
    this.onNameSyncedCallback = cb;
  };

  async start() {
    await this.initDDRP();
    await this.startDaemon();
  }

  async initDDRP () {
    const exists = await this.ddrpDirExists();

    if (exists) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log('copying binary');
    await this.copyBinary();
    // eslint-disable-next-line no-console
    console.log('copied binary');
    const cmd = path.join(appDataPath, 'ddrpd');
    await new Promise((resolve, reject) => execFile(cmd, ['init', '--home', ddrpdHome], async (err, stdout, stderr) => {
      if (err) {
        reject(err);
      }

      // eslint-disable-next-line no-console
      console.log('out', stdout);
      // eslint-disable-next-line no-console
      console.log('err', stderr);

      resolve();
    }));

    await this.setAPIKey(config.handshakeRPCKey);
    await this.setHost(config.handshakeRPCHost);
    await this.setMoniker(config.moniker);
    await this.setHeartbeat(config.heartbeartUrl);
  }

  startDaemon = async () => {
    this.stopDaemon();

    if (this.daemon) {
      return;
    }

    this.daemon = spawn(ddrpdPath, ['start', '--home', ddrpdHome]);
    this.daemon.stderr!.on('data', (data) => {
      const log = data.toString('utf-8');
      logger.info(log);
      const msg = getMsgFromLog(log);
      const module = getModuleFromLog(log);
      const name = getNameFromLog(log);

      if (module === 'name-syncer' && /synced name/g.test(msg)) {
        logger.info(`Streaming ${dotName(name)}`);
        this.onNameSyncedCallback!(dotName(name));
      }

      if (module === 'updater' && /successfully updated name/g.test(log)) {
        logger.info(`Streaming ${dotName(name)}`);
        this.onNameSyncedCallback!(dotName(name));
      }
    });

    this.daemon.stdout!.on('data', (data) => {
      const log = data.toString('utf-8');
      logger.info(log);
    });

    await this.tryPort();
  };

  stopDaemon = async () => {
    if (!this.daemon) {
      return;
    }

    this.daemon.kill();
    this.daemon = null;
  };

  setHeartbeat = async (url: string) => {
    const content = await fs.promises.readFile(`${ddrpdHome}/config.toml`);
    const splits = content.toString('utf-8').split('\n');
    splits[HEARTBEAT_LINE] = `  url = "${url}"`;
    return await fs.promises.writeFile(`${ddrpdHome}/config.toml`, splits.join('\n'));
  };

  setMoniker = async (moniker: string) => {
    const content = await fs.promises.readFile(`${ddrpdHome}/config.toml`);
    const splits = content.toString('utf-8').split('\n');
    splits[MONIKER_LINE] = `  moniker = "${moniker}"`;
    return await fs.promises.writeFile(`${ddrpdHome}/config.toml`, splits.join('\n'));
  };

  setHost = async (host: string) => {
    const content = await fs.promises.readFile(`${ddrpdHome}/config.toml`);
    const splits = content.toString('utf-8').split('\n');
    splits[HOST_LINE] = `  host = "${host}"`;
    return await fs.promises.writeFile(`${ddrpdHome}/config.toml`, splits.join('\n'));
  };

  setAPIKey = async (apiKey: string) => {
    const content = await fs.promises.readFile(`${ddrpdHome}/config.toml`);
    const splits = content.toString('utf-8').split('\n');
    splits[API_KEY_LINE] = `  api_key = "${apiKey}"`;
    return await fs.promises.writeFile(`${ddrpdHome}/config.toml`, splits.join('\n'));
  };

  private ddrpDirExists () {
    return dirExists(ddrpdHome);
  }

  private async copyBinary () {
    const file = `ddrpd-${process.platform}-${process.arch}`;
    const src = path.join('resources', file);
    await fs.promises.copyFile(src, ddrpdPath);
    await fs.promises.chmod(ddrpdPath, 0o755);
  }

  private async tryPort (retries = 3) {
    const attempt = () => new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const onError = () => {
        socket.destroy();
        reject();
      };

      socket.setTimeout(1000);
      socket.once('error', onError);
      socket.once('timeout', onError);
      socket.connect(9098, '127.0.0.1', () => {
        socket.end();
        resolve();
      });
    });

    for (let i = 0; i < retries; i++) {
      const start = Date.now();
      try {
        await attempt();
        return;
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, Math.ceil(3000 - (Date.now() - start))));
      }
    }
  }
}

export function getModuleFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/module=(["a-zA-Z0-9\-"]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getNameFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/name=([a-zA-Z0-9]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getMsgFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/msg=("[a-zA-Z 0-9]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getStartHeightFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/start_height=(["0-9"]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getEndHeightFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/end_height=(["0-9"]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getSyncedHeightFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/synced_height=(["0-9"]+)/)[1];
  } catch (e) {
    return '';
  }
}

export function getHeightFromLog(text: string) {
  try {
    // @ts-ignore
    return text.match(/height=(["0-9"]+)/)[1];
  } catch (e) {
    return '';
  }
}



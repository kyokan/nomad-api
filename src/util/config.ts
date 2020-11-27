import path from "path";
import fs from "fs";

const configPath = path.join(process.cwd(), 'config.json');
let config: any = null;

export const getConfig = async () => {
  if (config) {
    return config;
  }

  if (await fs.existsSync(configPath)) {
    const buf = await fs.promises.readFile(configPath);
    config = JSON.parse(buf.toString('utf-8'));
    return config;
  }

  config = {
    signers: [],
  };
  return config;
};

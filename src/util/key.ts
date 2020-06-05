// eslint-disable-next-line @typescript-eslint/no-var-requires
import secp256k1 from "secp256k1";

const ECKey = require('eckey');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const secureRandom = require('secure-random');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import CryptoJS from 'crypto-js';
import config from "../../config.json";
// @ts-ignore
import blake2b from 'blake2b';
import redis from "redis";
import logger from "./logger";
import {promisify} from "util";
const client = redis.createClient();


client.on("error", function(error) {
  logger.error(error);
});

const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const ttlAsync = promisify(client.ttl).bind(client);


export function generateNewCompressedKey(): typeof ECKey {
  const bytes = secureRandom(32); //https://github.com/jprichardson/secure-random
  const compressedKey = new ECKey(bytes, true);
  return compressedKey;
}

export function encrypt(text: string, password: string): string {
  return CryptoJS.AES.encrypt(text, password).toString();
}

export function decrypt(ciphertext: string, password: string): string {
  const bytes  = CryptoJS.AES.decrypt(ciphertext, password);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export async function createSessionKey(username: string, ttl: number): Promise<string> {
  const bytes = secureRandom(32);
  const sessionkey = Buffer.from(bytes).toString('hex');

  // @ts-ignore
  await setAsync(username, sessionkey, 'EX', ttl);
  // @ts-ignore
  await setAsync(sessionkey, username, 'EX', ttl);

  return sessionkey;
}

export async function verifySessionKey(key?: string | string[]): Promise<string> {
  if (!key || typeof key !== 'string') return '';
  return await getAsync(key) || '';
}

export function hashString(text: string): string {
  const h = blake2b(32);
  h.update(Buffer.from(text, 'utf-8'));
  const hash = Buffer.from(h.digest());
  return hash.toString('hex');
}

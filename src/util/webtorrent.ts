const WebTorrent = require('webtorrent-hybrid');
import createTorrent from 'create-torrent';
import parseTorrent from 'parse-torrent';
import {Readable} from "stream";
const webtorrent = new WebTorrent();

export const seed = (buffer: Buffer) => {
  return new Promise((resolve, reject) => {
    try {
      createTorrent(buffer, (err, torrent) => {
        const torrentData = parseTorrent(torrent);
        resolve(torrentData);
      });
    } catch (e) {
      reject(e);
    }
  });
};

export default webtorrent;

function bufferToStream(binary: Buffer) {
  const readableInstanceStream = new Readable({
    read() {
      this.push(binary);
      this.push(null);
    }
  });

  return readableInstanceStream;
}

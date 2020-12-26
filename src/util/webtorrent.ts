import {Torrent} from "webtorrent";

const WebTorrent = require('webtorrent-hybrid');
const webtorrent = new WebTorrent();

export const seed = (buffer: Buffer): Promise<Torrent> => {
  return new Promise((resolve, reject) => {
    try {
      webtorrent.seed(buffer, (torrent: Torrent) => {
        resolve(torrent);

        setTimeout(() => {
          webtorrent.remove(torrent.infoHash);
        }, 0);
      });
    } catch (e) {
      reject(e);
    }
  });
};

export default webtorrent;

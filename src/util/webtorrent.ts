const WebTorrent = require('webtorrent');

let node: any | null = null;

export async function getClient(): Promise<any> {
  if (!node) {
    node = new WebTorrent({
      maxConns: 4,
    });
  }
  return node;
}

export async function addFileToWebTorrent(filename: string, content: Buffer): Promise<string> {
  const client = await getClient();

  return new Promise((resolve) => {
    // @ts-ignore
    content.name = filename;
    console.log(filename);
    client.seed(content, (torrent: any) => {
      console.log(torrent);
      resolve(torrent.magnetURI);
    });
  });
}

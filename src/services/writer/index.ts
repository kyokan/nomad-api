import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import SECP256k1Signer from 'ddrp-js/dist/crypto/signer'
import {encodeEnvelope, Envelope} from "ddrp-js/dist/social/Envelope";
import BlobWriter from "ddrp-js/dist/ddrp/BlobWriter";
import {sealHash} from "ddrp-js/dist/crypto/hash";
import {sealAndSign} from "ddrp-js/dist/crypto/signatures";
import {encodeSubdomain, Subdomain, SUBDOMAIN_MAGIC} from "ddrp-js/dist/social/Subdomain";
import {IndexerManager} from "../indexer";
import {Express, Request, Response} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
import {createRefhash} from 'ddrp-js/dist/social/refhash';
import logger from "../../util/logger";
import {trackAttempt} from "../../util/matomo";
import config from "../../../config.json";
import {SubdomainDBRow, SubdomainManager} from "../subdomains";
import {createEnvelope, mapBodyToEnvelope} from "../../util/envelope";
import {BufferedReader} from "ddrp-js/dist/io/BufferedReader";
import {BlobReader} from "ddrp-js/dist/ddrp/BlobReader";
import {decrypt} from "../../util/key";

const jsonParser = bodyParser.json();
const SERVICE_KEY = process.env.SERVICE_KEY;

export class Writer {
  client: DDRPDClient;
  indexer: IndexerManager;
  subdomains: SubdomainManager;

  constructor(opts: {indexer: IndexerManager; subdomains: SubdomainManager}) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
    this.subdomains = opts.subdomains;
  }

  async reconstructSubdomainSectors(tld: string, date?: Date, broadcast?: boolean, oldSubs: SubdomainDBRow[] = []): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const createdAt = date || new Date();
    const subs = await this.subdomains.getSubdomainByTLD(tld);
    await this.writeAt(tld, 0, Buffer.from(SUBDOMAIN_MAGIC, 'utf-8'));

    if (!subs.length) {
      oldSubs.forEach((subdomain) => {
        if (!subdomain.name) return;
        this.subdomains.addSubdomain(tld, subdomain.name, '', subdomain.public_key || '', '');
      });
    }

    const newSubs = subs.length ? subs : oldSubs;

    let offset = 3;
    for (let j = 0; j < newSubs.length; j++) {
      const shouldBroadcast = broadcast && (newSubs.length - 1 === j);
      offset = await this.commitSubdomain(tld, newSubs[j], j + 1, createdAt, offset, shouldBroadcast);
    }
  }

  async reconstructBlob(tld: string, envelope?: Envelope, date?: Date, broadcast?: boolean): Promise<void> {
    // await Promise.all(users.map(async (user) => {
    //   await this.subdomains.addSubdomain(`${user.tld}`, user.subdomain, user.email, null, user.hashed_password);
    // }));
    // return;

    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const envs = await this.indexer.getUserEnvelopes(tld);
    let oldSubs: SubdomainDBRow[] = [];

    const createdAt = date || new Date();

    const br = new BlobReader(tld, this.client);
    const r = new BufferedReader(br, 4 * 1024 * 1024 - 5);
    const isSubdomain = await this.indexer.isSubdomainBlob(r);
    if (isSubdomain) {
      oldSubs = await this.indexer.scanSubdomainData(r, tld);
    }

    await this.truncateBlob(tld, createdAt);

    await this.reconstructSubdomainSectors(tld, createdAt, false, oldSubs);


    let offset = 64 * 1024;

    for (let i = 0; i < envs.length; i++) {
      const shouldBroadcast = broadcast && !envelope && i === envs.length - 1;
      const nameIndex = await this.subdomains.getNameIndex(envs[i]?.subdomain, tld);
      const endOffset = await this.appendEnvelope(
        tld,
        envs[i].toWire(nameIndex),
        envs[i].createdAt,
        shouldBroadcast,
        offset,
      );
      offset = endOffset;
    }

    if (envelope && date) {
      await this.appendEnvelope(tld, envelope, date, broadcast, offset);
    }
  }

  // @ts-ignore
  async commitSubdomain(tld: string, sub?: SubdomainDBRow, nameIndex = 0, date: Date, offset = 3, broadcast?: boolean): Promise<number> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);

    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    const num = await encodeSubdomainAsync(writer, {
      name: sub?.name || '',
      index: nameIndex,
      publicKey: sub?.public_key ? Buffer.from(sub.public_key || '', 'hex') : Buffer.alloc(33),
    });
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, date, merkleRoot);
    await this.client.commit(txId, date, sig, broadcast);
    logger.info(`append subdomain`, { tld, offset, subdomain: sub?.name });
    return num + offset;
  }

  async truncateBlob(tld: string, date?: Date, broadcast?: boolean): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const createdAt = date || new Date();

    const txId = await this.client.checkout(tld);
    await this.client.truncate(txId);
    const merkleRoot = await this.client.preCommit(txId);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
  }

  async appendEnvelope(tld: string, envelope: Envelope, date?: Date, broadcast?: boolean, _offset?: number): Promise<number> {
    // @ts-ignore
    const tldData = config.signers[tld];
    const createdAt = date || new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const offset = _offset || await this.indexer.findNextOffset(tld);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    const numOfBytes = await encodeEnvelopeAsync(writer, envelope);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
    logger.info(`append envelope`, { tld, nameIndex: envelope.nameIndex, offset, networkId: envelope.id });
    return offset + numOfBytes;
  }

  async writeAt (tld: string, offset: number = 0, buf: Buffer): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];
    const createdAt = new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    await this.client.writeAt(txId, offset, buf);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, false);
  }

  async writeEnvelopeAt(tld: string, envelope: Envelope, offset: number = 0, date?: Date, broadcast?: boolean): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];
    const createdAt = date || new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    await encodeEnvelopeAsync(writer, envelope);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
  }

  async preCommit(tld: string, envelope: Envelope, offset: number = 0, date?: Date): Promise<{sealedHash: Buffer; txId: number}> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`precommiting`, { tld, txId });

    await encodeEnvelopeAsync(writer, envelope);

    const merkleRoot = await this.client.preCommit(txId);

    return {
      sealedHash: sealHash(tld, date || new Date(), merkleRoot),
      txId,
    };
  }

  async commit(tld: string, envelope: Envelope, offset: number = 0, date: Date, hash: string, sig: string): Promise<void> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`commiting`, { tld, txId });

    await encodeEnvelopeAsync(writer, envelope);

    const merkleRoot = await this.client.preCommit(txId);
    const sealedHash = sealHash(tld, date || new Date(), merkleRoot);
    const sealedHashHex = sealedHash.toString('hex');

    if (sealedHashHex !== hash) {
      logger.error(`does not match precommit hash`, {
        precommit: sealedHashHex,
        commit: hash,
      });
      throw new Error(`hash should be ${sealedHashHex}`);
    }

    return this.client.commit(txId, date, Buffer.from(sig, 'hex'), true);
  }

  handleAppendBlob = async (req: Request, res: Response) => {
    const blobName = req.params.blobName;

    if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    trackAttempt('append to blob', req, blobName);

    const {
      post,
      connection,
      media,
      moderation,
      broadcast,
      date,
      refhash,
      networkId,
    } = req.body;

    if (!blobName || typeof blobName !== 'string') {
      return res.status(400)
        .send(makeResponse('invalid tld', true));
    }

    const createdAt = date ? new Date(date) : new Date();

    let envelope: Envelope | undefined;

    try {
      envelope = await mapBodyToEnvelope(blobName, {
        post,
        connection,
        moderation,
        media,
        createAt: createdAt,
        refhash,
        networkId,
      });

      if (!envelope) {
        return res.status(400)
          .send(makeResponse('invalid envelope', true));
      }

      await this.appendEnvelope(blobName, envelope, createdAt, broadcast);

      return res.send(makeResponse(envelope));
    } catch (e) {
      return res.status(500)
        .send(makeResponse(e.message, true));
    }
  };

  setRoutes(app: Express) {
    app.post('/blob/:blobName/format', jsonParser, async (req, res) => {
      const blobName = req.params.blobName;

      const {
        broadcast,
      } = req.body;

      if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
        res.status(401).send(makeResponse('unauthorized', true));
        return;
      }

      if (!blobName) {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      trackAttempt('reformat blob', req, blobName);

      try {
        await this.reconstructBlob(blobName, broadcast);
        return res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/blob/:blobName/append`, jsonParser, this.handleAppendBlob);

    app.post(`/relayer/precommit`, jsonParser, async (req, res) => {
      trackAttempt('Precommit Blob', req);
      const {
        tld,
        post,
        connection,
        media,
        moderation,
        offset,
        date,
        refhash,
        networkId,
      } = req.body;

      if (!tld || typeof tld !== 'string') {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      let envelope: Envelope | undefined;

      const createdAt = date ? new Date(date) : new Date();

      try {
        envelope = await mapBodyToEnvelope(tld, {
          post,
          connection,
          moderation,
          media,
          createAt: createdAt,
          refhash,
          networkId,
        });

        if (!envelope) {
          return res.status(400)
            .send(makeResponse('invalid envelope', true));
        }

        const rh = await createRefhash(envelope, '', tld);
        const rhHex = rh.toString('hex');

        if (!envelope) {
          return res.status(400)
            .send(makeResponse('invalid envelope', true));
        }

        const {sealedHash, txId} = await this.preCommit(tld, envelope, offset, createdAt);

        res.send(makeResponse({
          sealedHash: sealedHash.toString('hex'),
          envelope,
          txId,
          refhash: refhash || rhHex,
        }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.get('/blob/:blobName/info', async (req, res) => {
      const blobName = req.params.blobName;

      trackAttempt('Get Blob Info', req, blobName);

      try {
        const info = await this.client.getBlobInfo(blobName);
        const nextOffset = await this.indexer.findNextOffset(blobName);
        res.send(makeResponse({ ...info, nextOffset }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/relayer/commit`, jsonParser, async (req, res) => {
      trackAttempt('Commit Blob', req);
      const {
        tld,
        post,
        connection,
        media,
        moderation,
        offset,
        date,
        networkId,
        sealedHash,
        sig,
        refhash,
      } = req.body;

      if (!tld || typeof tld !== 'string') {
        return res.status(400).send(makeResponse('invalid tld', true));
      }

      if (!sealedHash || typeof sealedHash !== 'string') {
        return res.status(400).send(makeResponse('invalid hash', true));
      }

      if (!sig || typeof sig !== 'string') {
        return res.status(400).send(makeResponse('invalid sig', true));
      }

      if (!networkId || typeof networkId !== 'string') {
        return res.status(400).send(makeResponse('invalid networkId', true));
      }

      if (!date) {
        return res.status(400).send(makeResponse('invalid date', true));
      }

      let envelope: Envelope | undefined;
      const createdAt = date ? new Date(date) : new Date();

      try {
        envelope = await createEnvelope(tld, {
          post,
          connection,
          moderation,
          media,
          networkId,
          createAt: createdAt,
          refhash,
        });

        if (!envelope) {
          return res.status(400).send(makeResponse('invalid envelope', true));
        }

        await this.commit(
          tld,
          envelope,
          offset,
          new Date(date),
          sealedHash,
          sig,
        );

        res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500).send(makeResponse(e.message, true));
      }
    });
  }
}


async function encodeEnvelopeAsync(writer: BlobWriter, envelope: Envelope): Promise<number> {
  return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, numOfBytes) => {
    if (err) {
      return reject(err);
    }
    resolve(numOfBytes);
  }));
}

async function encodeSubdomainAsync(writer: BlobWriter, sub: Subdomain): Promise<number> {
  return new Promise((resolve, reject) => encodeSubdomain(writer, sub, (err, numOfBytes) => {
    if (err) {
      return reject(err);
    }
    resolve(numOfBytes);
  }));
}

const users = [
  {
    "tld": 5404,
    "subdomain": "chillbro",
    "email": "foo@bar.com",
    "hashed_password": "2432612431302468396a64316a723556427135366c4d6855772f5a322e2e6e32784f4f44776a495050782f54647368314b756f454e444775694e4857"
  },
  {
    "tld": 9411,
    "subdomain": "whogonnastopme2",
    "email": "whogonnastopme2@test.com",
    "hashed_password": "2432612431302438344f68682e3937676f742e56462f413139474d61753536367775466962775a4f485a62377951636366596b4c7768737467723671"
  },
  {
    "tld": 2062,
    "subdomain": "test2",
    "email": "test@test22062.com",
    "hashed_password": "24326124313024506d7779445253624a34772e456c6644665841656a6530354849316c4944326d484a6959312f312f75517775396533616a4e767853"
  },
  {
    "tld": 5404,
    "subdomain": "blake",
    "email": "blake5404@test.com",
    "hashed_password": "24326124313024324b704e74557a487156572f473769574b756131672e6c775a4b7548375032566f572f537572656e47693744655262637154726357"
  },
  {
    "tld": 9411,
    "subdomain": "test3",
    "email": "test@test39411.com",
    "hashed_password": "243261243130246e5441366d3574534564675a5476336a766e5944522e46744b37663835362e72464a41556e4167726d306a5761626c722f6c335936"
  },
  {
    "tld": 9411,
    "subdomain": "matt",
    "email": "Matt9411@test.com",
    "hashed_password": "2432612431302478626750724d31714d632f78382f6265464434394c4f6d59377347436775465449736c73557a2e72686f5646472e616a3858524e61"
  },
  {
    "tld": 9411,
    "subdomain": "test4",
    "email": "test@test49411.com",
    "hashed_password": "2432612431302449626c4c4d7254714b454a314158504d4141486262756a3476586674494e37306462426e737a694d694b346b68496458794c796561"
  },
  {
    "tld": 2062,
    "subdomain": "test",
    "email": "test@test2062.com",
    "hashed_password": "24326124313024516666314568785a51665736777136513757672f672e6c4f784962535a35393849347339672e4662484f6933696d552f4757795357"
  },
  {
    "tld": 5404,
    "subdomain": "hey",
    "email": "hey@hey5404.com",
    "hashed_password": "24326124313024306c3038454c2e432f30577731674244616a366b5a656d4e43586954336c4f303634626e706661647334577330352e664970353271"
  },
  {
    "tld": 2062,
    "subdomain": "whogonnastopme",
    "email": "whogonnastopme@testtest.com",
    "hashed_password": "243261243130247466303436352f6a4f2e2e665169416830447a72526554364132377371644a5554624d54794c63384b766f767677356e682e724747"
  },
  {
    "tld": 2062,
    "subdomain": "abc",
    "email": "abc2062@test.com",
    "hashed_password": "2432612431302448514676477a586f4735312e6e4a70345349786b752e51796e4b7430654f44514e36376535457a567738746c39713464507168564f"
  },
  {
    "tld": 9764,
    "subdomain": "ali",
    "email": "ali9764@test.com",
    "hashed_password": "2432612431302431683757747432647679773954712f56387856786e4f7a4944544d372e726c4c766a72356c786832785951324230766665704a3969"
  },
  {
    "tld": 9411,
    "subdomain": "chuntatchan",
    "email": "chuntatchan123@gmail.com",
    "hashed_password": "2432612431302477536d5058793463517668612e6c59716776424854654a4a65636758466e565844766c687568324a79377a775a5262396c326f4e43"
  },
  {
    "tld": 2062,
    "subdomain": "abcdefg",
    "email": "abcdefg@2062.com",
    "hashed_password": "24326124313024562f75677670396a7454365057794173346643767a4f54616a696c357759635a7179474632376a46543334312f354437726157344b"
  },
  {
    "tld": 2062,
    "subdomain": "abcdefgh",
    "email": "abcdefgh@2062.com",
    "hashed_password": "24326124313024545a6758656642577a37364164486c64736178526265472e2e73302e77754657752f6d6a4b734631366b566c6c77466253635a5875"
  },
  {
    "tld": 9764,
    "subdomain": "a",
    "email": "a9764@test.com",
    "hashed_password": "243261243130244f57763851586b422e74563465752e72536e464d5a2e566835656b5549333734576d4a376e76593434793756566343564258414532"
  },
  {
    "tld": 9411,
    "subdomain": "m",
    "email": "m9411@test.com",
    "hashed_password": "243261243130246d647a5a34703135445932364e5864574e766a31324f6941526e6b3949305256452f643341645a774a4e4f703754456b4654794e53"
  },
  {
    "tld": 9411,
    "subdomain": "b",
    "email": "b9411@test.com",
    "hashed_password": "24326124313024477a636733634379356a43554357546a73466b4448653859314936636959496f6c4171385757415552774b62773867396d5a714d61"
  },
  {
    "tld": 9764,
    "subdomain": "c",
    "email": "c9764@test.com",
    "hashed_password": "24326124313024593153724b673978333373434466642e786668366a4f7368524a6430394b6d6641424953384f6a734a494d30557a645a7244335a53"
  },
  {
    "tld": 5404,
    "subdomain": "a",
    "email": "a5404@test.com",
    "hashed_password": "243261243130245767304b637a333577446758337a6a2f544a5856792e4c6666413630476d6164317338466b464258427565553665304e4c4b65554f"
  },
  {
    "tld": 5404,
    "subdomain": "jacky",
    "email": "jacky5404@test.com",
    "hashed_password": "2432612431302479503658445038424b643538493255496e523266386550544b366d55754b664161726f6165764774573672312e62396c78346c6d2e"
  },
  {
    "tld": 5404,
    "subdomain": "heyman",
    "email": "heyman5404@test.com",
    "hashed_password": "24326124313024706d2e4b375771397241793246625649307472554b654f6c692f2f556b57666956667676695a523747796e436c6478417a55475336"
  },
  {
    "tld": 2062,
    "subdomain": "abcde",
    "email": "abcde2062@test.com",
    "hashed_password": "24326124313024544c7545324257395578464d5767656e4e77624b42656a67415677532e454b5041646d4d747553456373564b5163594f7149543465"
  },
  {
    "tld": 2062,
    "subdomain": "abcdef",
    "email": "abcdef2062@test.co",
    "hashed_password": "2432612431302466754a3978544a79514c6e7a3930774a786332774a4f76534b6f646251367467524c4b6f2e68717863374c3043326a717778515979"
  },
  {
    "tld": 5404,
    "subdomain": "jackychan",
    "email": "jackychan5404@test.com",
    "hashed_password": "24326124313024786331686f4667336a6c7175686277653543426954756e79574f775448566857444935734d7461397a6135374e79522f5a4c323665"
  },
  {
    "tld": 2062,
    "subdomain": "abcd",
    "email": "abcd2062@test.com",
    "hashed_password": "243261243130242e346246415832356e7a6c51572f435a4b5836636e2e336335396961416e6d5441544955367a53346d657273326e46465841775936"
  },
  {
    "tld": 2062,
    "subdomain": "bitchute",
    "email": "ray.vahey@bitchute.com",
    "hashed_password": "24326124313024537a6157507277756c67687549504b5a7339323766655a772e48734f4b6d435a5742316d4b57557a366d3279426b32696d37435543"
  },
  {
    "tld": 2062,
    "subdomain": "ray",
    "email": "ray@bitchute.com",
    "hashed_password": "243261243130246f597a596f4d4a334c35596e556c6e5262366a49542e62476c70545a524b5577326f2f39685130476d716156796f6143382e486157"
  },
  {
    "tld": 2062,
    "subdomain": "06042020",
    "email": "dtsui@d.com",
    "hashed_password": "243261243130247877642e367849674e6931577a77675951744f2e752e525634776c31746b677341737751485a77464f6b437372622e2f485346634b"
  },
  {
    "tld": 6371,
    "subdomain": "gelato",
    "email": "gelato6371@test.com",
    "hashed_password": "243261243130246856437a34714a6c33427a41623466544a4d4e5a65756a414c627633545263552e6b6347524547615a43576c4c6666674f66644661"
  },
  {
    "tld": 9411,
    "subdomain": "whogonnastopme",
    "email": "whogonnastopme@test.com",
    "hashed_password": "24326124313024683646774d4e6c6a744a64754848366b6b6c4f774c4f3468586c2f73387956742f2f6a6a6470413935596255376635476547735561"
  },
  {
    "tld": 2062,
    "subdomain": "06052020",
    "email": "d@t.co",
    "hashed_password": "243261243130242f52584d665072504e706e63623179544f44665a43657339412e416e76512f6765786e75453769626452667353352f505459744869"
  },
  {
    "tld": 6371,
    "subdomain": "ogkush",
    "email": "ogkush6371@test.com",
    "hashed_password": "24326124313024542e515338454b3547345241514a4678324835332f656344444571376576594a646d563754576b625059496b513045354830667165"
  },
  {
    "tld": 2062,
    "subdomain": "06032020",
    "email": "d@d.co",
    "hashed_password": "2432612431302456535171703243434c7837694338464e6d6e31636a4f416c6d7052314b566c4358444148566345334a356b725059386c7343503371"
  },
  {
    "tld": 9325,
    "subdomain": "ibchilling",
    "email": "",
    "public_key": "03d19856d5b1f0a027d310c066ec40f1e1b1d4140ca8bcbcddc99ed7c381f5a101",
    "hashed_password": "24326124313024683646774d4e6c6a744a64754848366b6b6c4f774c4f3468586c2f73387956742f2f6a6a6470413935596255376635476547735561"
  },
  {
    "tld": 9325,
    "subdomain": "whogonnastopme2",
    "email": "",
    "hashed_password": "24326124313024683646774d4e6c6a744a64754848366b6b6c4f774c4f3468586c2f73387956742f2f6a6a6470413935596255376635476547735561"
  },
  {
    "tld": 9325,
    "subdomain": "t2",
    "email": "",
    "hashed_password": "24326124313024683646774d4e6c6a744a64754848366b6b6c4f774c4f3468586c2f73387956742f2f6a6a6470413935596255376635476547735561"
  }
]

import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import SECP256k1Signer from "ddrp-js/dist/crypto/signer";
import {BufferedReader} from "ddrp-js/dist/io/BufferedReader";
import {BlobReader} from "ddrp-js/dist/ddrp/BlobReader";
import {isSubdomainBlob, iterateAllEnvelopes, iterateSubdomain} from "ddrp-js/dist/social/streams";
// import {EnvelopeWriter} from "ddrp-js/dist/social/EnvelopeWriter";
import {Envelope as WireEnvelope} from "ddrp-js/dist/social/Envelope";
import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {Connection as DomainConnection} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';
import {Post} from "ddrp-js/dist/social/Post";
import {Connection} from "ddrp-js/dist/social/Connection";
import {Moderation} from "ddrp-js/dist/social/Moderation";
import {PostsDAOImpl} from 'ddrp-indexer/dist/dao/PostsDAO';
import {ConnectionsDAOImpl} from 'ddrp-indexer/dist/dao/ConnectionsDAO';
import {ModerationsDAOImpl} from 'ddrp-indexer/dist/dao/ModerationsDAO';
import {SqliteEngine, Row} from 'ddrp-indexer/dist/dao/Engine';
import {Pageable} from 'ddrp-indexer/dist/dao/Pageable';
import * as path from 'path';
import * as fs from "fs";
import logger from "../../util/logger";
import {promisify} from "util";
import {JOIN_SELECT, UserProfile} from "../../constants";
import {Express, Request, Response} from "express";
import {makeResponse} from "../../util/rest";
import bodyParser from "body-parser";
const jsonParser = bodyParser.json();
import Avatars from '@dicebear/avatars';
import Identicon from '@dicebear/avatars-identicon-sprites';
import Gridy from '@dicebear/avatars-gridy-sprites';
import Avataaars from '@dicebear/avatars-avataaars-sprites';
import Bottts from '@dicebear/avatars-bottts-sprites';
import Jdenticon from '@dicebear/avatars-jdenticon-sprites';
import {dotName, isSubdomain, parseUsername, serializeUsername} from "../../util/user";
import {extendFilter} from "../../util/filter";
import {trackAttempt} from "../../util/matomo";
const appDataPath = './build';
const dbPath = path.join(appDataPath, 'nomad.db');
import crypto from "crypto";
import Timeout = NodeJS.Timeout;
import {mapWireToEnvelope} from "../../util/envelope";


const SPRITE_TO_SPRITES: {[sprite: string]: any} = {
  identicon: Identicon,
  bottts: Bottts,
  avataaars: Avataaars,
  gridy: Gridy,
  jdenticon: Jdenticon,
};

const TLD_CACHE: {
  [tld: string]: string;
} = {};

const IMAGE_CACHE: {
  [hash: string]: {
    type: string;
    data: Buffer;
  };
} = {};

const AVATAR_CACHE: {
  [spriteSeed: string]: string;
} = {};

export class IndexerManager {
  postsDao?: PostsDAOImpl;
  connectionsDao?: ConnectionsDAOImpl;
  moderationsDao?: ModerationsDAOImpl;
  client: DDRPDClient;
  engine: SqliteEngine;
  dbPath: string;
  resourcePath: string;

  constructor(opts?: { dbPath?: string; resourcePath?: string }) {
    const client = new DDRPDClient('127.0.0.1:9098');
    this.client = client;
    this.engine = new SqliteEngine(opts?.dbPath || dbPath);
    this.dbPath = opts?.dbPath || dbPath;
    this.resourcePath = opts?.resourcePath || 'resources';

    (async function test() {
      try {
        await wait(5000);
        const blobName = '9325';
        const signer = SECP256k1Signer.fromHexPrivateKey('8c94b983798417f8431f47665509ebda7b41fb4e139c42af6fa5b35d6323e22c');
        const truncate = false;
        // const writer = new EnvelopeWriter(client, blobName, truncate, signer, 68);
        //
        // await writer.open();
        // const envelope = new Envelope(
        //   0,
        //   new Date(),
        //   crypto.randomBytes(8).toString('hex'),
        //   new Post(
        //     0,
        //     Buffer.alloc(4),
        //     'hello',
        //     null,
        //     null,
        //     null,
        //     [],
        //   ),
        //   null,
        //   null,
        // );
        // await writer.writeEnvelope(envelope);
        // await writer.commit();
      } catch (e) {
        console.log(e);
      }
    })();

  }

  handlers = {
    '/posts': async (req: Request, res: Response) => {
      trackAttempt('Get All Posts', req);
      try {
        const { order, offset, limit } = req.query || {};
        const posts = await this.getPosts(order, limit, offset);
        res.send(makeResponse(posts));
      } catch (e) {
        res.status(500).send(makeResponse(e.message, true));
      }
    },
    //
    // '/posts/:hash': async (req: Request, res: Response) =>  {
    //   trackAttempt('Get One Post', req, req.params.hash);
    //   const post = await this.getPostByHash(req.params.hash);
    //   res.send(makeResponse(post));
    // },
    //
    // '/posts/:hash/comments': async (req: Request, res: Response) =>  {
    //   trackAttempt('Get Post Comments', req, req.params.hash);
    //   const { order, offset } = req.query || {};
    //   const post = await this.getCommentsByHash(req.params.hash, order, offset);
    //   res.send(makeResponse(post));
    // },
    //
    // '/filter': async (req: Request, res: Response) =>  {
    //   trackAttempt('Get Posts by Filter', req);
    //   const { order, offset } = req.query || {};
    //   const { filter } = req.body;
    //   const post = await this.getPostsByFilter(filter, order, offset);
    //   res.send(makeResponse(post));
    // },

    // '/tlds': async (req: Request, res: Response) => {
      // trackAttempt('Get All TLDs', req);
      // // const tlds = await this.readAllTLDs();
      // res.send(makeResponse(tlds));
    // },

    // '/tags': async (req: Request, res: Response) => {
    //   trackAttempt('Get Posts by Tags', req);
    //   const { order, offset, tags } = req.query || {};
    //   const posts = await this.getTags(Array.isArray(tags) ? tags : [tags], order, offset);
    //   res.send(makeResponse(posts));
    // },
    //
    // '/users/:username/timeline': async (req: Request, res: Response) => {
    //   trackAttempt('Get Timeline by User', req, req.params.username);
    //   const { order, offset } = req.query || {};
    //   const posts = await this.getUserTimeline(req.params.username, order, offset);
    //   res.send(makeResponse(posts));
    // },
    //
    // '/users/:username/likes': async (req: Request, res: Response) => {
    //   trackAttempt('Get Likes by User', req, req.params.username);
    //   const { order, offset } = req.query || {};
    //   const {tld, subdomain} = parseUsername(req.params.username);
    //   const filter = extendFilter({
    //     likedBy: [serializeUsername(subdomain, tld)],
    //     allowedTags: ['*'],
    //   });
    //   const posts = await this.getPostsByFilter(filter, order, offset);
    //   res.send(makeResponse(posts));
    // },
    //
    // '/users/:username/comments': async (req: Request, res: Response) => {
    //   trackAttempt('Get Comments by User', req, req.params.username);
    //   const { order, offset } = req.query || {};
    //   const posts = await this.getUserReplies(req.params.username, order, offset);
    //   res.send(makeResponse(posts));
    // },
    //
    // '/users/:username/followees': async (req: Request, res: Response) => {
    //   trackAttempt('Get Followees by User', req, req.params.username);
    //   const { order, offset } = req.query || {};
    //   const posts = await this.getUserFollowings(req.params.username, order, offset);
    //   res.send(makeResponse(posts));
    // },
    //
    // '/users/:username/blockees': async (req: Request, res: Response) => {
    //   trackAttempt('Get Blockees by User', req, req.params.username);
    //   const { order, offset } = req.query || {};
    //   const posts = await this.getUserBlocks(req.params.username, order, offset);
    //   res.send(makeResponse(posts));
    // },

    // '/users/:username/profile': async (req: Request, res: Response) => {
    //   trackAttempt('Get User Profile', req, req.params.username);
    //   const hash = await this.getUserProfile(req.params.username);
    //   res.send(makeResponse(hash));
    // },

    '/avatars/:sprite/:seed.svg': async (req: Request, res: Response) => {
      try {
        const { sprite, seed } = req.params;
        const sprites: any = SPRITE_TO_SPRITES[sprite];

        if (AVATAR_CACHE[sprite + seed]) {
          res.set({ 'Content-Type': 'image/svg+xml' });
          res.send(AVATAR_CACHE[seed]);
          return;
        }

        const avatars = new Avatars(sprites, {
          margin: 12,
          width: 100,
          height: 100,
        });
        const svg = avatars.create(seed);
        AVATAR_CACHE[seed] = svg;
        res.set({ 'Content-Type': 'image/svg+xml' });
        res.send(AVATAR_CACHE[seed]);
      } catch (e) {
        res.status(500);
        res.send(e.message);
      }
    },

    // '/media/:postHash': async (req: Request, res: Response) => {
    //   try {
    //     const { postHash } = req.params;
    //
    //     if (IMAGE_CACHE[postHash]) {
    //       res.set({'Content-Type': IMAGE_CACHE[postHash].type});
    //       res.send(IMAGE_CACHE[postHash].data);
    //       return;
    //     }
    //
    //     const {post} = await this.getPostByHash(postHash) || {};
    //     const image = this.decodeBase64Image(post?.content);
    //
    //     IMAGE_CACHE[postHash] = image;
    //     res.set({'Content-Type': image.type});
    //     res.send(image.data);
    //   } catch (e) {
    //     res.status(500);
    //     res.send(e.message);
    //   }
    // }
  };

  setRoutes = (app: Express) => {
    app.get('/posts', this.handlers['/posts']);
    // app.get('/posts/:hash', this.handlers['/posts/:hash']);
    // app.get('/posts/:hash/comments', this.handlers['/posts/:hash/comments']);
    // app.post('/filter', jsonParser, this.handlers['/filter']);
    // app.get('/tlds', this.handlers['/tlds']);
    // app.get('/tags', this.handlers['/tags']);
    // app.get('/users/:username/timeline', this.handlers['/users/:username/timeline']);
    // app.get('/users/:username/likes', this.handlers['/users/:username/likes']);
    // app.get('/users/:username/comments', this.handlers['/users/:username/comments']);
    // app.get('/users/:username/followees', this.handlers['/users/:username/followees']);
    // app.get('/users/:username/blockees', this.handlers['/users/:username/blockees']);
    // app.get('/users/:username/profile', this.handlers['/users/:username/profile']);
    app.get('/avatars/:sprite/:seed.svg', this.handlers['/avatars/:sprite/:seed.svg']);
    // app.get('/media/:postHash', this.handlers['/media/:postHash']);
  };


  // getTags = async (tags: string[], order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
  //   return await this.postsDao!.getPostsByFilterV2(extendFilter({
  //     allowedTags: tags,
  //   }), order, start);
  // };
  //
  // getUserBlocks = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<Block, number>> => {
  //   const { tld, subdomain } = parseUsername(username);
  //   return (isSubdomain(username) && subdomain)
  //     ? await this.blocksDAO!.getBlockedBySubdomain(dotName(tld), subdomain, order, start)
  //     : await this.blocksDAO!.getBlockedByTLD(dotName(tld), order, start);
  // };
  //
  // getUserFollowings = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<Follow, number>> => {
  //   const { tld, subdomain } = parseUsername(username);
  //   return (isSubdomain(username) && subdomain)
  //     ? await this.followsDao!.getFolloweeBySubdomain(dotName(tld), subdomain, order, start)
  //     : await this.followsDao!.getFolloweeByTLD(dotName(tld), order, start);
  // };
  //
  // getUserTimeline = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
  //   const { tld, subdomain } = parseUsername(username);
  //
  //   return await this.getPostsByFilter(extendFilter({
  //     postedBy: [serializeUsername(subdomain, tld)],
  //     allowedTags: ['*'],
  //   }), order, start);
  // };
  //
  // getUserLikes = async (username: string, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
  //   const { tld, subdomain } = parseUsername(username);
  //
  //   return await this.getPostsByFilter(extendFilter({
  //     likedBy: [serializeUsername(subdomain, tld)],
  //     allowedTags: ['*'],
  //   }), order, start);
  // };
  //
  // getUserReplies = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
  //   const { tld, subdomain } = parseUsername(username);
  //   return await this.getPostsByFilter(extendFilter({
  //     repliedBy: [serializeUsername(subdomain, tld)],
  //     allowedTags: ['*'],
  //   }), order, start);
  // };
  //
  // getPostByHash = async (hash: string): Promise<PostWithMeta | null>  => {
  //   return await this.postsDao!.getPostByHash(hash);
  // };
  //
  // getPostsByFilter = async (filter: Filter, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
  //   return await this.postsDao!.getPostsByFilterV2(filter, order, start);
  // };
  //
  // getCommentsByHash = async (parent: string | null, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
  //   return this.postsDao!.getPostsWithParent(parent, order, start);
  // };

  private getUserDisplayName = async (username: string): Promise<string|undefined> => {
    const rows: Row[] = [];
    const { tld, subdomain } = parseUsername(username);

    if (isSubdomain(username)) {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain = @subdomain AND topic = ".display_name" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
        subdomain,
      }, (row) => rows.push(row));
    } else {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain is NULL AND topic = ".display_name" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
      }, (row) => rows.push(row));
    }

    return rows[0]?.content;
  };

  private getUserBio = async (username: string): Promise<string|undefined> => {
    const rows: Row[] = [];
    const { tld, subdomain } = parseUsername(username);

    if (isSubdomain(username)) {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain = @subdomain AND topic = ".bio" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
        subdomain,
      }, (row) => rows.push(row));
    } else {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain is NULL AND topic = ".bio" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
      }, (row) => rows.push(row));
    }

    return rows[0]?.content;
  };

  private getUserAvatarType = async (username: string): Promise<string|undefined> => {
    const rows: Row[] = [];
    const { tld, subdomain } = parseUsername(username);

    if (isSubdomain(username)) {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain = @subdomain AND topic = ".avatar_type" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
        subdomain,
      }, (row) => rows.push(row));
    } else {
      this.engine.each(`SELECT content, ts from posts where tld = @tld AND subdomain is NULL AND topic = ".avatar_type" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
      }, (row) => rows.push(row));
    }

    return rows[0]?.content;
  };

  private getUserProfilePicture = async (username: string): Promise<string|undefined> => {
    const rows: Row[] = [];
    const { tld, subdomain } = parseUsername(username);

    if (isSubdomain(username)) {
      this.engine.each(`SELECT context, ts from posts where tld = @tld AND subdomain = @subdomain AND topic = ".profile_picture_url" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
        subdomain,
      }, (row) => rows.push(row));
    } else {
      this.engine.each(`SELECT context, ts from posts where tld = @tld AND subdomain is NULL AND topic = ".profile_picture_url" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
      }, (row) => rows.push(row));
    }

    return rows[0]?.context;
  };

  private getUserCoverImage = async (username: string): Promise<string|undefined> => {
    const rows: Row[] = [];
    const { tld, subdomain } = parseUsername(username);

    if (isSubdomain(username)) {
      this.engine.each(`SELECT context, ts from posts where tld = @tld AND subdomain = @subdomain AND topic = ".cover_image" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
        subdomain,
      }, (row) => rows.push(row));
    } else {
      this.engine.each(`SELECT context, ts from posts where tld = @tld AND subdomain is NULL AND topic = ".cover_image" ORDER BY ts DESC LIMIT 1`, {
        tld: dotName(tld),
      }, (row) => rows.push(row));
    }


    return rows[0]?.context;
  };

  getUserProfile = async (username: string): Promise<UserProfile> => {
    const profilePicture = await this.getUserProfilePicture(username) || '';
    const coverImage = await this.getUserCoverImage(username) || '';
    const bio = await this.getUserBio(username) || '';
    const avatarType = await this.getUserAvatarType(username) || '';
    const displayName = await this.getUserDisplayName(username) || '';
    return {
      profilePicture,
      coverImage,
      bio,
      avatarType,
      displayName,
    };
  };

  getPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, offset = 0): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    this.engine.each(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.guid, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE p.id > @start
        ORDER BY p.id ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT @limit
    `, {
      start: offset,
      limit,
    }, (row) => {
      envelopes.push(this.mapPost(row, true));
    });

    if (!envelopes.length) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    return new Pageable<DomainEnvelope<DomainPost>, number>(envelopes, envelopes[envelopes.length - 1].message.id);
  };

  private mapPost (row: Row, includeTags: boolean): DomainEnvelope<DomainPost> {
    const tags: string[] = [];
    if (includeTags) {
      this.engine.each('SELECT name as tag FROM tags t JOIN tags_posts tp ON t.id = tp.tag_id', {}, (row) => {
        tags.push(row.tag);
      });
    }

    return new DomainEnvelope<DomainPost>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.guid,
      row.refhash,
      new Date(row.created_at * 1000),
      new DomainPost(
        row.post_id,
        row.body,
        row.title,
        row.reference,
        row.topic,
        tags,
        row.reply_count,
        row.like_count,
        row.pin_count,
      ),
      null
    );
  }


  insertPost = async (tld: string, subdomain: string | null, wire: WireEnvelope): Promise<any> => {
    try {
      logger.info(`inserting message ${serializeUsername(subdomain, tld)}/${wire.guid}`);
      const message = wire.message;
      const domainEnvelope = await mapWireToEnvelope(tld, wire);

      switch (message.type) {
        case Post.TYPE:
          return await this.postsDao?.insertPost(domainEnvelope as DomainEnvelope<DomainPost>);
        case Connection.TYPE:
          return await this.connectionsDao?.insertConnection(domainEnvelope as DomainEnvelope<DomainConnection>);
        case Moderation.TYPE:
          return await this.moderationsDao?.insertModeration(domainEnvelope as DomainEnvelope<DomainModeration>);
        default:
          return;
      }
    } catch (err) {
      logger.error(`cannot insert message ${serializeUsername(subdomain, tld)}/${wire.guid}`);
      logger.error(err.message);
    }

  };

  // private streamSubdomainData = async (source: ReadableBlobStream, tld: string, nameRecord: NameRecord): Promise<void> => {
  //   let timeout: number;
  //   logger.info(`streamming subdomain ${nameRecord.name}@${tld}`);
  //   return new Promise((resolve) => {
  //     streamSubdomainData(source, nameRecord, async (err, env) => {
  //       if (timeout) {
  //         clearTimeout(timeout);
  //       }
  //       timeout = setTimeout(resolve, 1000);
  //       if (err) {
  //         logger.error(`error streaming ${nameRecord.name}@${tld}`);
  //         logger.error(err.message);
  //         return;
  //       }
  //
  //       if (env) {
  //         logger.info('receiving env');
  //         try {
  //           this.insertPost(tld, nameRecord.name, env);
  //
  //         } catch (e) {
  //           logger.error(`error streaming ${nameRecord.name}@${tld}`);
  //           logger.error(err.message);
  //           return;
  //         }
  //       }
  //     });
  //   })
  // };

  // private streamTLDData = async (source: ReadableBlobStream, tld: string): Promise<void> => {
  //   let timeout: number;
  //   return new Promise((resolve) => {
  //     streamTLDData(source, async (err, env) => {
  //       if (timeout) {
  //         clearTimeout(timeout);
  //       }
  //       timeout = setTimeout(resolve, 1000);
  //
  //       if (err) {
  //         logger.error(`error streaming ${tld}`);
  //         logger.error(err.message);
  //         return;
  //       }
  //
  //       if (env) {
  //         try {
  //           this.insertPost(tld, null, env);
  //         } catch (tldUpsertError) {
  //           logger.error(`error streaming ${tld}`);
  //           logger.error(tldUpsertError.message);
  //           return;
  //         }
  //       }
  //     });
  //   })
  // };

  streamBlob = async (tld: string): Promise<void> => {
    logger.info(`Reading ${tld}`, { tld });
    try {
      const r = new BufferedReader(new BlobReader(tld, this.client), 1024 * 1024);

      iterateAllEnvelopes(r, (err, env) => {
        if (err) {
          logger.error(err.message);
          return false;
        }

        if (env === null) {
          return false;
        }

        if (!env.nameIndex) {
          console.log(env);
          this.insertPost(tld, null, env);
        }

        return true;
      });
    } catch (e) {
      logger.error(`cannot read ${tld}`);
      logger.error(e.message);
    }
  };

  // private isSubdomainBlob = (r: BufferedReader): Promise<boolean> => {
  //   return new Promise((resolve, reject) => {
  //     isSubdomainBlob(r, (err, res) => {
  //       if (err) {
  //         reject(err);
  //         logger.error(err.message);
  //         return;
  //       }
  //
  //       logger.info(`Subdomain blob`, { isSubdomainBlob: !!res });
  //       resolve(!!res);
  //     });
  //   });
  // };

  async start () {
    const exists = await this.dbExists();

    if (!exists) {
      logger.info('[indexer manager] Copying database');
      await this.copyDB();
      logger.info('[indexer manager] Copied database');
    }

    await this.engine.open();
    this.postsDao = new PostsDAOImpl(this.engine);
    this.connectionsDao = new ConnectionsDAOImpl(this.engine);
    this.moderationsDao = new ModerationsDAOImpl(this.engine);
  }

  decodeBase64Image(dataString = ''): {
    type: string;
    data: Buffer;
  } {
    const matches = dataString
      .replace('\n', '')
      .match(/^data:([A-Za-z-+\/]+);base64,(.+)$/) || [];

    if (matches.length !== 3) {
      throw new Error('Invalid input string');
    }

    return {
      type: matches[1],
      data: new Buffer(matches[2], 'base64'),
    };
  }

  private async dbExists () {
    try {
      await fs.promises.access(this.dbPath, fs.constants.F_OK);
    } catch (e) {
      logger.error(new Error(`${this.dbPath} does not exist`));
      return false;
    }

    logger.info(`[indexer manager] ${this.dbPath} exists`);
    return true;
  }

  private async copyDB () {
    const src = path.join(this.resourcePath, 'nomad.db');
    await fs.promises.copyFile(src, this.dbPath);
  }

  async readAllTLDs(): Promise<string[]> {
    await this.streamBlobInfo();
    return Object.keys(TLD_CACHE);
  }

  async streamAllBlobs(): Promise<void> {
    await this.streamBlobInfo();

    const tlds = Object.keys(TLD_CACHE);
    // const tlds = ['9325']
    for (let i = 0; i < tlds.length; i = i + 19) {
      const selectedTLDs = tlds.slice(i, i + 19).filter(tld => !!tld);
      await this.streamNBlobs(selectedTLDs);
    }
  }

  private async streamNBlobs(tlds: string[]): Promise<void[]> {
    return Promise.all(tlds.map(async tld => this.streamBlob(dotName(tld))));
  }

  streamBlobInfo = async (start = '', defaultTimeout?: number): Promise<number> => {
    let timeout: number | undefined = defaultTimeout;

    return new Promise((resolve, reject) => {
      let lastUpdate = start;
      let counter = 0;

      this.client.streamBlobInfo(start, 20, async info => {
        if (timeout) clearTimeout(timeout);
        TLD_CACHE[info.name] = info.name;
        lastUpdate = info.name;
        counter++;
        timeout = setTimeout(resolve, 500);
        if (counter % 20 === 0) {
          await this.streamBlobInfo(lastUpdate, timeout);
        }
      });

      timeout = setTimeout(resolve, 500);
    })
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}



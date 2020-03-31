import {PostsDAOImpl} from 'ddrp-indexer/dist/dao/PostsDAO';
import {ReactionsDAOImpl} from 'ddrp-indexer/dist/dao/ReactionsDAO';
import {FollowsDAOImpl} from 'ddrp-indexer/dist/dao/FollowsDAO';
import {BlocksDAOImpl} from 'ddrp-indexer/dist/dao/BlocksDAO';
import {SqliteEngine, Row} from 'ddrp-indexer/dist/dao/Engine';
import {Filter} from 'ddrp-indexer/dist/dao/Filter';
import {PostWithMeta} from 'ddrp-indexer/dist/dao/PostWithMeta';
import {Post as PIPost} from 'ddrp-indexer/dist/social/Post';
import {Reaction} from 'ddrp-indexer/dist/social/Reaction';
import {Follow} from 'ddrp-indexer/dist/social/Follow';
import {Block} from 'ddrp-indexer/dist/social/Block';
import {Pageable} from 'ddrp-indexer/dist/dao/Pageable';
import DDRPDClient from 'ddrp-indexer/dist/ddrpd/DDRPDClient';
import Envelope from 'ddrp-indexer/dist/social/Envelope';
import {WireMessage} from 'ddrp-indexer/dist/social/WireMessage';
import ReadableBlobStream from 'ddrp-indexer/dist/ddrpd/ReadableBlobStream';
import {NameRecord} from 'ddrp-indexer/dist/social/SubdomainReader';
import {streamTLDData, isSubdomainBlob, streamSubdomainData, readSubdomainRecords } from 'ddrp-indexer/dist/social/streams';
import {WirePost} from 'ddrp-indexer/dist/social/WirePost';
import {WireFollow} from 'ddrp-indexer/dist/social/WireFollow';
import {WireReaction} from 'ddrp-indexer/dist/social/WireReaction';
import {WireBlock} from 'ddrp-indexer/dist/social/WireBlock';
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
const appDataPath = './build';
const dbPath = path.join(appDataPath, 'nomad.db');


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
  reactionsDao?: ReactionsDAOImpl;
  followsDao?: FollowsDAOImpl;
  blocksDAO?: BlocksDAOImpl;
  client: DDRPDClient;
  engine: SqliteEngine;
  dbPath: string;
  resourcePath: string;

  constructor(opts?: { dbPath?: string; resourcePath?: string }) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.engine = new SqliteEngine(opts?.dbPath || dbPath);
    this.dbPath = opts?.dbPath || dbPath;
    this.resourcePath = opts?.resourcePath || 'resources';
  }

  handlers = {
    '/posts': async (req: Request, res: Response) => {
     const { order, offset, limit } = req.query || {};
     const posts = await this.getPosts(order, limit, offset);
     res.send(makeResponse(posts));
    },

    '/posts/:hash': async (req: Request, res: Response) =>  {
      const post = await this.getPostByHash(req.params.hash);
      res.send(makeResponse(post));
    },

    '/posts/:hash/comments': async (req: Request, res: Response) =>  {
      const { order, offset } = req.query || {};
      const post = await this.getCommentsByHash(req.params.hash, order, offset);
      res.send(makeResponse(post));
    },

    '/filter': async (req: Request, res: Response) =>  {
      const { order, offset } = req.query || {};
      const { filter } = req.body;
      const post = await this.getPostsByFilter(filter, order, offset);
      res.send(makeResponse(post));
    },

    '/tlds': async (req: Request, res: Response) => {
      const tlds = await this.readAllTLDs();
      res.send(makeResponse(tlds));
    },

    '/tags': async (req: Request, res: Response) => {
      const { order, offset, tags } = req.query || {};
      const posts = await this.getTags(Array.isArray(tags) ? tags : [tags], order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/timeline': async (req: Request, res: Response) => {
      const { order, offset } = req.query || {};
      const posts = await this.getUserTimeline(req.params.username, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/likes': async (req: Request, res: Response) => {
      const { order, offset } = req.query || {};
      const {tld, subdomain} = parseUsername(req.params.username);
      const filter = extendFilter({
        likedBy: [serializeUsername(subdomain, tld)],
        allowedTags: ['*'],
      });
      const posts = await this.getPostsByFilter(filter, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/comments': async (req: Request, res: Response) => {
      const { order, offset } = req.query || {};
      const posts = await this.getUserReplies(req.params.username, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/followees': async (req: Request, res: Response) => {
      const { order, offset } = req.query || {};
      const posts = await this.getUserFollowings(req.params.username, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/blockees': async (req: Request, res: Response) => {
      const { order, offset } = req.query || {};
      const posts = await this.getUserBlocks(req.params.username, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/profile': async (req: Request, res: Response) => {
      const hash = await this.getUserProfile(req.params.username);
      res.send(makeResponse(hash));
    },

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

    '/media/:postHash': async (req: Request, res: Response) => {
      try {
        const { postHash } = req.params;

        if (IMAGE_CACHE[postHash]) {
          res.set({'Content-Type': IMAGE_CACHE[postHash].type});
          res.send(IMAGE_CACHE[postHash].data);
          return;
        }

        const {post} = await this.getPostByHash(postHash) || {};
        const image = this.decodeBase64Image(post?.content);

        IMAGE_CACHE[postHash] = image;
        res.set({'Content-Type': image.type});
        res.send(image.data);
      } catch (e) {
        res.status(500);
        res.send(e.message);
      }
    }
  };

  setRoutes = (app: Express) => {
    app.get('/posts', this.handlers['/posts']);
    app.get('/posts/:hash', this.handlers['/posts/:hash']);
    app.get('/posts/:hash/comments', this.handlers['/posts/:hash/comments']);
    app.post('/filter', jsonParser, this.handlers['/filter']);
    app.get('/tlds', this.handlers['/tlds']);
    app.get('/tags', this.handlers['/tags']);
    app.get('/users/:username/timeline', this.handlers['/users/:username/timeline']);
    app.get('/users/:username/likes', this.handlers['/users/:username/likes']);
    app.get('/users/:username/comments', this.handlers['/users/:username/comments']);
    app.get('/users/:username/followees', this.handlers['/users/:username/followees']);
    app.get('/users/:username/blockees', this.handlers['/users/:username/blockees']);
    app.get('/users/:username/profile', this.handlers['/users/:username/profile']);
    app.get('/avatars/:sprite/:seed.svg', this.handlers['/avatars/:sprite/:seed.svg']);
    app.get('/media/:postHash', this.handlers['/media/:postHash']);
  };


  getTags = async (tags: string[], order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
    return await this.postsDao!.getPostsByFilter(extendFilter({
      allowedTags: tags,
    }), order, start);
  };

  getUserBlocks = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<Block, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return (isSubdomain(username) && subdomain)
      ? await this.blocksDAO!.getBlockedBySubdomain(dotName(tld), subdomain, order, start)
      : await this.blocksDAO!.getBlockedByTLD(dotName(tld), order, start);
  };

  getUserFollowings = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<Follow, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return (isSubdomain(username) && subdomain)
      ? await this.followsDao!.getFolloweeBySubdomain(dotName(tld), subdomain, order, start)
      : await this.followsDao!.getFolloweeByTLD(dotName(tld), order, start);
  };

  getUserTimeline = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
    const { tld, subdomain } = parseUsername(username);

    return await this.getPostsByFilter(extendFilter({
      postedBy: [serializeUsername(subdomain, tld)],
      allowedTags: ['*'],
    }), order, start);
  };

  getUserLikes = async (username: string, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
    const { tld, subdomain } = parseUsername(username);

    return await this.getPostsByFilter(extendFilter({
      likedBy: [serializeUsername(subdomain, tld)],
      allowedTags: ['*'],
    }), order, start);
  };

  getUserReplies = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<PostWithMeta, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return await this.getPostsByFilter(extendFilter({
      repliedBy: [serializeUsername(subdomain, tld)],
      allowedTags: ['*'],
    }), order, start);
  };

  getPostByHash = async (hash: string): Promise<PostWithMeta | null>  => {
    return await this.postsDao!.getPostByHash(hash);
  };

  getPostsByFilter = async (filter: Filter, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
    return await this.postsDao!.getPostsByFilterV2(filter, order, start);
  };

  getCommentsByHash = async (parent: string | null, order?: 'ASC' | 'DESC', start?: number): Promise<Pageable<PostWithMeta, number>> => {
    return this.postsDao!.getPostsWithParent(parent, order, start);
  };

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

  getPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, offset?: number): Promise<Pageable<PostWithMeta, number>> => {
    const rows: Row[] = [];

    if (!offset) {
      this.engine.each(`${JOIN_SELECT} WHERE posts.parent IS NULL AND posts.topic = '' ORDER BY posts.ts ${order} LIMIT @limit`, {
        limit,
      }, (row) => rows.push(row));

      return new Pageable<PostWithMeta, number>(
        this.mapRowsToPosts(rows),
        rows.length < limit ? null : rows.length,
      );
    }

    this.engine.each(`${JOIN_SELECT} WHERE posts.parent IS NULL AND posts.topic = '' ORDER BY posts.ts ${order} LIMIT @limit OFFSET @offset`, {
      offset,
      limit,
    }, (row) => rows.push(row));

    return new Pageable<PostWithMeta, number>(
      this.mapRowsToPosts(rows),
      rows.length < limit ? null : rows.length + Number(offset),
    );
  };

  upsertPost = async (tld: string, subdomain: string | null, envelope: Envelope<WireMessage>): Promise<Envelope<WireMessage>> => {
    switch (envelope.type) {
      case WirePost.TYPE:
        await this.postsDao?.upsertPost(PIPost.fromWire(dotName(tld), subdomain, envelope as Envelope<WirePost>));
        return envelope;
      case WireReaction.TYPE:
        await this.reactionsDao?.upsertReaction(Reaction.fromWire(dotName(tld), subdomain, envelope as Envelope<WireReaction>));
        return envelope;
      case WireFollow.TYPE:
        await this.followsDao?.upsertFollow(Follow.fromWire(dotName(tld), subdomain, envelope as Envelope<WireFollow>));
        return envelope;
      case WireBlock.TYPE:
        await this.blocksDAO?.upsertBlock(Block.fromWire(dotName(tld), subdomain, envelope as Envelope<WireBlock>));
        return envelope;
      default:
        throw new Error('unsupported message type');
    }
  };

  private streamSubdomainData = async (source: ReadableBlobStream, tld: string, nameRecord: NameRecord): Promise<void> => {
    let timeout: number;
    logger.info(`streamming subdomain ${nameRecord.name}@${tld}`);
    return new Promise((resolve) => {
      streamSubdomainData(source, nameRecord, async (err, env) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(resolve, 1000);
        if (err) {
          logger.error(`error streaming ${nameRecord.name}@${tld}`);
          logger.error(err.message);
          return;
        }

        if (env) {
          logger.info('receiving env');
          try {
            this.upsertPost(tld, nameRecord.name, env);

          } catch (e) {
            logger.error(`error streaming ${nameRecord.name}@${tld}`);
            logger.error(err.message);
            return;
          }
        }
      });
    })
  };

  private streamTLDData = async (source: ReadableBlobStream, tld: string): Promise<void> => {
    let timeout: number;
    return new Promise((resolve) => {
      streamTLDData(source, async (err, env) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(resolve, 1000);

        if (err) {
          logger.error(`error streaming ${tld}`);
          logger.error(err.message);
          return;
        }

        if (env) {
          try {
            this.upsertPost(tld, null, env);
          } catch (tldUpsertError) {
            logger.error(`error streaming ${tld}`);
            logger.error(tldUpsertError.message);
            return;
          }
        }
      });
    })
  };

  streamBlob = async (tld: string): Promise<void> => {
    const client = this.client;
    let source: ReadableBlobStream;

    logger.info(`Streaming tld: ${tld}`);

    try {
      const readStream = client.createReadStream();
      source = new ReadableBlobStream(tld, readStream);

      if (await isSubdomainBlob(source)) {
        const nameRecords = await readSubdomainRecords(source);
        for (const nameRecord of nameRecords) {
          await this.streamSubdomainData(source, tld, nameRecord);
        }
      } else {
        await this.streamTLDData(source, tld);
      }


      logger.info(`Streamed tld: ${tld}`);
    } catch (e) {
      logger.error(`error streaming ${tld}`);
      logger.error(e.message);
    } finally {

      // @ts-ignore
      if (source) {
        const destroyP = promisify(source.destroy);
        // @ts-ignore
        await destroyP();
      }
    }
  };

  async start () {
    const exists = await this.dbExists();

    if (!exists) {
      logger.info('[indexer manager] Copying database');
      await this.copyDB();
      logger.info('[indexer manager] Copied database');
    }

    await this.engine.open();
    this.postsDao = new PostsDAOImpl(this.engine);
    this.reactionsDao = new ReactionsDAOImpl(this.engine);
    this.followsDao = new FollowsDAOImpl(this.engine);
    this.blocksDAO = new BlocksDAOImpl(this.engine);
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

  private tagsForPost (refHash: Buffer): string[] {
    const topics: string[] = [];
    this.engine.each('SELECT (name) FROM tags WHERE post_refhash = @refhash', {
      refhash: refHash.toString('hex'),
    }, (row: Row) => topics.push(row.name));
    return topics;
  }

  private mapRowsToPosts (rows: Row[]): PostWithMeta[] {
    const posts: PostWithMeta[] = [];
    for (const row of rows) {
      posts.push(this.mapRowToPost(row));
    }
    return posts;
  }

  private mapRowToPost (row: Row): PostWithMeta {
    const tags = this.tagsForPost(Buffer.from(row.refhash, 'hex'));
    return {
      post: new PIPost(
        row.tld,
        row.subdomain,
        row.guid,
        new Date(row.ts),
        row.parent,
        row.context,
        row.content,
        row.topic,
        tags,
      ),
      meta: {
        replyCount: row.reply_count,
        likeCount: row.like_count,
        pinCount: row.pin_count,
      }
    };
  }

  async readAllTLDs(): Promise<string[]> {
    await this.streamBlobInfo();
    return Object.keys(TLD_CACHE);
  }

  async streamAllBlobs(): Promise<void> {
    await this.streamBlobInfo();

    const tlds = Object.keys(TLD_CACHE);

    for (let i = 0; i < tlds.length; i = i + 19) {
      const selectedTLDs = tlds.slice(i, i + 19).filter(tld => !!tld);
      await this.streamNBlobs(selectedTLDs);
    }
  }

  private async streamNBlobs(tlds: string[]): Promise<void[]> {
    return Promise.all(tlds.map(async tld => this.streamBlob(dotName(tld))));
  }

  streamBlobInfo = async (start = ''): Promise<void> => {
    let lastUpdate = start;
    let counter = 0;

    await this.client.streamBlobInfo(start, 20, info => {
      TLD_CACHE[info.name] = info.name;
      lastUpdate = info.name;
      counter++;
    });

    if (counter > 19) {
      await this.streamBlobInfo(lastUpdate);
    }
  }
}

import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import {BufferedReader} from "ddrp-js/dist/io/BufferedReader";
import {BlobReader} from "ddrp-js/dist/ddrp/BlobReader";
import {iterateAllEnvelopes, isSubdomainBlob, iterateAllSubdomains} from "ddrp-js/dist/social/streams";
import {Envelope as WireEnvelope} from "ddrp-js/dist/social/Envelope";
import {Subdomain} from "ddrp-js/dist/social/Subdomain";
import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {
  Connection as DomainConnection,
  Follow as DomainFollow,
  Block as DomainBlock,
} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';
import {Media as DomainMedia} from 'ddrp-indexer/dist/domain/Media';
import {Post} from "ddrp-js/dist/social/Post";
import {Connection} from "ddrp-js/dist/social/Connection";
import {Moderation} from "ddrp-js/dist/social/Moderation";
import {Media} from "ddrp-js/dist/social/Media";
import {PostsDAOImpl} from 'ddrp-indexer/dist/dao/PostsDAO';
import {ConnectionsDAOImpl} from 'ddrp-indexer/dist/dao/ConnectionsDAO';
import {ModerationsDAOImpl} from 'ddrp-indexer/dist/dao/ModerationsDAO';
import {MediaDAOImpl} from 'ddrp-indexer/dist/dao/MediaDAO';
import {SqliteEngine, Row} from 'ddrp-indexer/dist/dao/Engine';
import {Pageable} from 'ddrp-indexer/dist/dao/Pageable';
import * as path from 'path';
import * as fs from "fs";
import logger from "../../util/logger";
import {UserProfile} from "../../constants";
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
import {dotName, parseUsername, serializeUsername} from "../../util/user";
import {extendFilter, Filter} from "../../util/filter";
import {trackAttempt} from "../../util/matomo";
const appDataPath = './build';
const dbPath = path.join(appDataPath, 'nomad.db');
const namedbPath = path.join(appDataPath, 'names.db');
const pendingDbPath = path.join(appDataPath, 'pending.db');
import {mapWireToEnvelope} from "../../util/envelope";
import crypto from 'crypto';

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
    filename: string;
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
  mediaDao?: MediaDAOImpl;
  client: DDRPDClient;
  engine: SqliteEngine;
  nameDB: SqliteEngine;
  pendingDB: SqliteEngine;
  dbPath: string;
  namedbPath: string;
  pendingDbPath: string;
  resourcePath: string;

  constructor(opts?: { dbPath?: string; namedbPath?: string; resourcePath?: string; pendingDbPath?: string }) {
    const client = new DDRPDClient('127.0.0.1:9098');
    this.client = client;
    this.engine = new SqliteEngine(opts?.dbPath || dbPath);
    this.nameDB = new SqliteEngine(opts?.namedbPath || namedbPath);
    this.pendingDB = new SqliteEngine(opts?.pendingDbPath || pendingDbPath);
    this.dbPath = opts?.dbPath || dbPath;
    this.namedbPath = opts?.namedbPath || namedbPath;
    this.pendingDbPath = opts?.pendingDbPath || pendingDbPath;
    this.resourcePath = opts?.resourcePath || 'resources';
  }

  handlers = {
    '/pending/posts': async (req: Request, res: Response) => {
      trackAttempt('Get All Posts', req);
      try {
        const { order, offset, limit } = req.query || {};
        const posts = await this.getPendingPosts(order, limit, offset);
        res.send(makeResponse(posts));
      } catch (e) {
        res.status(500).send(makeResponse(e.message, true));
      }
    },

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

    '/posts/:hash': async (req: Request, res: Response) =>  {
      try {
        trackAttempt('Get One Post', req, req.params.hash);
        const post = await this.getPostByHash(req.params.hash);
        res.send(makeResponse(post));
      } catch (e) {
        res.status(500).send(makeResponse(e.message, true));
      }
    },

    '/posts/:hash/comments': async (req: Request, res: Response) =>  {
      trackAttempt('Get Post Comments', req, req.params.hash);
      const { order, offset } = req.query || {};
      const post = await this.getCommentsByHash(req.params.hash, order, offset);
      res.send(makeResponse(post));
    },
    //
    '/filter': async (req: Request, res: Response) =>  {
      trackAttempt('Get Posts by Filter', req);
      const { order, limit, offset } = req.query || {};
      const { filter } = req.body;
      const post = await this.getPostsByFilter(filter, order, limit, offset);
      res.send(makeResponse(post));
    },

    '/tlds': async (req: Request, res: Response) => {
      trackAttempt('Get All TLDs', req);
      const tlds = await this.readAllTLDs();
      res.send(makeResponse(tlds));
    },

    '/tags': async (req: Request, res: Response) => {
      trackAttempt('Get Posts by Tags', req);
      const { order, limit, offset, tags } = req.query || {};
      const posts = await this.getPostsByFilter(extendFilter({
        postedBy: ['*'],
        allowedTags: Array.isArray(tags) ? tags : [tags],
      }), order, limit, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/timeline': async (req: Request, res: Response) => {
      trackAttempt('Get Timeline by User', req, req.params.username);
      const { order, limit, offset } = req.query || {};
      const {tld, subdomain} = parseUsername(req.params.username);

      const posts = await this.getPostsByFilter(extendFilter({
        postedBy: [serializeUsername(subdomain, tld)],
      }), order, limit, offset);

      res.send(makeResponse(posts));
    },

    '/users/:username/likes': async (req: Request, res: Response) => {
      trackAttempt('Get Likes by User', req, req.params.username);
      const { order, limit, offset } = req.query || {};
      const {tld, subdomain} = parseUsername(req.params.username);
      const posts = await this.getPostsByFilter(extendFilter({
        likedBy: [serializeUsername(subdomain, tld)],
      }), order, limit, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/comments': async (req: Request, res: Response) => {
      trackAttempt('Get Comments by User', req, req.params.username);
      const { order, limit, offset } = req.query || {};
      const {tld, subdomain} = parseUsername(req.params.username);
      const posts = await this.getPostsByFilter(extendFilter({
        repliedBy: [serializeUsername(subdomain, tld)],
      }), order, limit, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/followees': async (req: Request, res: Response) => {
      trackAttempt('Get Followees by User', req, req.params.username);
      const { order, limit, offset } = req.query || {};
      const posts = await this.getUserFollowings(req.params.username, order,  offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/followers': async (req: Request, res: Response) => {
      trackAttempt('Get Followers by User', req, req.params.username);
      const { order, limit, offset } = req.query || {};
      const posts = await this.getUserFollowers(req.params.username, order,  offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/blockees': async (req: Request, res: Response) => {
      trackAttempt('Get Blockees by User', req, req.params.username);
      const { order, offset } = req.query || {};
      const posts = await this.getUserBlocks(req.params.username, order, offset);
      res.send(makeResponse(posts));
    },

    '/users/:username/profile': async (req: Request, res: Response) => {
      trackAttempt('Get User Profile', req, req.params.username);
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

    '/media/:refhash': async (req: Request, res: Response) => {
      try {
        const { refhash } = req.params;

        if (IMAGE_CACHE[refhash]) {
          res.set('Content-Disposition', `attachment; filename=${IMAGE_CACHE[refhash].filename}`);
          res.set({'Content-Type': IMAGE_CACHE[refhash].type});
          res.send(IMAGE_CACHE[refhash].data);
          return;
        }

        const media = await this.getMediaByHash(refhash);

        if (!media) {
          return res.status(404).send();
        }

        res.set('Content-Disposition', `attachment; filename=${media.filename}`);
        res.set({'Content-Type': media.mime_type});
        res.send(media.content);
      } catch (e) {
        res.status(500);
        res.send(e.message);
      }
    }
  };

  setRoutes = (app: Express) => {
    app.get('/pending/posts', this.handlers['/pending/posts']);
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
    app.get('/users/:username/followers', this.handlers['/users/:username/followers']);
    app.get('/users/:username/blockees', this.handlers['/users/:username/blockees']);
    app.get('/users/:username/profile', this.handlers['/users/:username/profile']);
    app.get('/avatars/:sprite/:seed.svg', this.handlers['/avatars/:sprite/:seed.svg']);
    app.get('/media/:refhash', this.handlers['/media/:refhash']);
  };

  getUserBlocks = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<DomainBlock, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return this.connectionsDao!.getBlockees(tld, subdomain || '', start);
  };

  getUserFollowings = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<DomainFollow, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return this.connectionsDao!.getFollowees(tld, subdomain || '', start);
  };

  getUserFollowers = async (username: string, order: 'ASC' | 'DESC' = 'ASC', start = 0): Promise<Pageable<DomainFollow, number>> => {
    const { tld, subdomain } = parseUsername(username);
    return this.connectionsDao!.getFollowers(tld, subdomain || '', start);
  };

  getPostByHash = async (refhash: string): Promise<DomainEnvelope<DomainPost> | null>  => {
    return this.postsDao!.getPostByRefhash(refhash);
  };

  getPostsByFilter = async (f: Filter, order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    const {
      postedBy,
      repliedBy,
      likedBy,
      allowedTags,
    } = extendFilter(f);

    let postedByQueries = '';
    let repliedByQueries = '';
    let postedBySelect = '';
    let repliedBySelect = '';
    let allowedTagsJoin = '';
    let likedBySelect = '';
    let likedByQueries = '';

    const offset = order === 'ASC'
      ? defaultOffset || 0
      : defaultOffset || 999999999999999999999;

    // if (allowedTags.includes('*')) {
    //   allowedTagsJoin = `
    //     JOIN tags_posts tp ON p.id = tp.post_id AND (p.topic NOT LIKE ".%" OR p.topic is NULL)
    //   `
    // } else
    if (allowedTags.length && !allowedTags.includes('*')) {
      allowedTagsJoin = `
        JOIN (tags_posts tp JOIN tags t ON t.id = tp.tag_id)
            ON t.name IN (${allowedTags.map(t => `"${t}"`).join(',')}) AND p.id = tp.post_id AND (p.topic NOT LIKE ".%" OR p.topic is NULL)
      `
    }

    if (postedBy.length) {
      postedBySelect = `
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p
        JOIN envelopes e ON p.envelope_id = e.id
        ${allowedTagsJoin}
      `;

      if (!postedBy.includes('*')) {
        postedByQueries = `(${postedBy
          .map(username => {
            const { tld, subdomain } = parseUsername(username);
            return `(e.tld = "${tld}" AND subdomain = "${subdomain}" AND p.reference is NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL))`;
          })
          .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      } else {
        postedByQueries = `(p.reference is NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      }

      postedBySelect = postedBySelect + ' WHERE ' + postedByQueries
    }

    if (repliedBy.length) {
      repliedBySelect = `
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p
        JOIN envelopes e ON p.envelope_id = e.id
        ${allowedTagsJoin}
      `;

      if (!repliedBy.includes('*')) {
        repliedByQueries = `(${repliedBy
          .map(username => {
            const { tld, subdomain } = parseUsername(username);
            return `(e.tld = "${tld}" AND subdomain = "${subdomain}" AND p.reference is not NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL))`;
          })
          .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      } else {
        repliedByQueries = `(p.reference is not NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      }

      repliedBySelect = repliedBySelect + ' WHERE ' + repliedByQueries
    }

    if (likedBy.length) {
      likedBySelect = `
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p
        LEFT JOIN envelopes e ON p.envelope_id = e.id
        ${allowedTagsJoin}
        JOIN (moderations mod JOIN envelopes env ON mod.envelope_id = env.id)
        ON mod.reference = e.refhash
      `;

      if (!likedBy.includes('*')) {
        likedByQueries = `(${likedBy
          .map(username => {
            const { tld, subdomain } = parseUsername(username);
            return `(env.tld = "${tld}" AND env.subdomain = "${subdomain}" AND p.reference is NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL))`;
          })
          .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      } else {
        likedByQueries = `(p.reference is NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
      }

      likedBySelect = likedBySelect + ' WHERE ' + likedByQueries
    }

    this.engine.each(`
        ${[postedBySelect, repliedBySelect, likedBySelect].filter(d => !!d).join('UNION')}
        ORDER BY p.id ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT @limit
    `, {
      limit,
    }, (row) => {
      envelopes.push(this.mapPost(row, true));
    });


    if (!envelopes.length) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    return new Pageable<DomainEnvelope<DomainPost>, number>(
      envelopes,
      envelopes[envelopes.length - 1].message.id,
    );
  };

  getCommentsByHash = async (reference: string | null, order?: 'ASC' | 'DESC', limit = 20,  defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    const offset = order === 'ASC'
      ? defaultOffset || 0
      : defaultOffset || 999999999999999999999;
    this.engine.each(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE p.reference = @reference AND (p.topic NOT LIKE ".%" OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} @start
        ORDER BY p.id ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT @limit
    `, {
      start: offset,
      limit,
      reference,
    }, (row) => {
      envelopes.push(this.mapPost(row, true));
    });

    if (!envelopes.length) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    return new Pageable<DomainEnvelope<DomainPost>, number>(
      envelopes,
      envelopes[envelopes.length - 1].message.id,
    );
  };

  private getMediaByHash = async (refhash: string): Promise<any|undefined> => {
    const row = this.engine.first(`
      SELECT e.created_at, m.filename, m.mime_type, m.content
      FROM media m JOIN envelopes e ON m.envelope_id = e.id
      WHERE e.refhash = @refhash
      ORDER BY e.created_at DESC
    `, {
      refhash,
    });


    return row;
  };

  private getUserDisplayName = async (username: string): Promise<string> => {
    const { tld, subdomain } = parseUsername(username);

    const displayName = this.engine.first(`
      SELECT e.created_at, p.body
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      WHERE tld = @tld AND subdomain = @subdomain AND topic = ".display_name"
      ORDER BY e.created_at DESC
    `, {
      tld: dotName(tld),
      subdomain,
    });


    return displayName?.body || '';
  };

  private getUserBio = async (username: string): Promise<string|undefined> => {
    const { tld, subdomain } = parseUsername(username);

    const displayName = this.engine.first(`
      SELECT e.created_at, p.body
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      WHERE tld = @tld AND subdomain = @subdomain AND topic = ".user_bio"
      ORDER BY e.created_at DESC
    `, {
      tld: dotName(tld),
      subdomain,
    });


    return displayName?.body || '';
  };

  private getUserAvatarType = async (username: string): Promise<string|undefined> => {
    const { tld, subdomain } = parseUsername(username);

    const displayName = this.engine.first(`
      SELECT e.created_at, p.body
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      WHERE tld = @tld AND subdomain = @subdomain AND topic = ".avatar_type"
      ORDER BY e.created_at DESC
    `, {
      tld: dotName(tld),
      subdomain,
    });


    return displayName?.body || '';
  };

  private getUserProfilePicture = async (username: string): Promise<string|undefined> => {
    const { tld, subdomain } = parseUsername(username);

    const displayName = this.engine.first(`
      SELECT e.created_at, p.reference
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      WHERE tld = @tld AND subdomain = @subdomain AND topic = ".profile_picture_refhash"
      ORDER BY e.created_at DESC
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return displayName?.reference || '';
  };

  private getUserCoverImage = async (username: string): Promise<string|undefined> => {
    const { tld, subdomain } = parseUsername(username);

    const displayName = this.engine.first(`
      SELECT e.created_at, p.reference
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      WHERE tld = @tld AND subdomain = @subdomain AND topic = ".cover_image_refhash"
      ORDER BY e.created_at DESC
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return displayName?.reference || '';
  };

  private getFollowingCounts = async (username: string): Promise<number> => {
    const { tld, subdomain } = parseUsername(username);

    const followings = this.engine.first(`
        SELECT COUNT(*)
        FROM connections c
        JOIN envelopes e ON c.envelope_id = e.id
        WHERE e.tld = @tld AND e.subdomain = @subdomain AND c.connection_type = "FOLLOW"
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return followings ? followings['COUNT(*)'] : 0;
  };

  private getFollowerCounts = async (username: string): Promise<number> => {
    const { tld, subdomain } = parseUsername(username);

    const followers = this.engine.first(`
        SELECT COUNT(*)
        FROM connections c
        JOIN envelopes e ON c.envelope_id = e.id
        WHERE c.tld = @tld AND c.subdomain = @subdomain AND c.connection_type = "FOLLOW"
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return followers ? followers['COUNT(*)'] : 0;
  };

  private getBlockingCounts = async (username: string): Promise<number> => {
    const { tld, subdomain } = parseUsername(username);

    const blockings = this.engine.first(`
        SELECT COUNT(*)
        FROM connections c
        JOIN envelopes e ON c.envelope_id = e.id
        WHERE e.tld = @tld AND e.subdomain = @subdomain AND c.connection_type = "BLOCK"
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return blockings ? blockings['COUNT(*)'] : 0;
  };

  private getBlockerCounts = async (username: string): Promise<number> => {
    const { tld, subdomain } = parseUsername(username);

    const blockers = this.engine.first(`
        SELECT COUNT(*)
        FROM connections c
        JOIN envelopes e ON c.envelope_id = e.id
        WHERE c.tld = @tld AND c.subdomain = @subdomain AND c.connection_type = "BLOCK"
    `, {
      tld: dotName(tld),
      subdomain,
    });

    return blockers ? blockers['COUNT(*)'] : 0;
  };

  getUserProfile = async (username: string): Promise<UserProfile> => {
    const profilePicture = await this.getUserProfilePicture(username) || '';
    const coverImage = await this.getUserCoverImage(username) || '';
    const bio = await this.getUserBio(username) || '';
    const avatarType = await this.getUserAvatarType(username) || '';
    const displayName = await this.getUserDisplayName(username) || '';
    const followings = await this.getFollowingCounts(username);
    const followers = await this.getFollowerCounts(username);
    const blockings = await this.getBlockingCounts(username);
    const blockers = await this.getBlockerCounts(username);

    return {
      profilePicture,
      coverImage,
      bio,
      avatarType,
      displayName,
      followings,
      followers,
      blockings,
      blockers,
    };
  };

  getPendingPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    const offset = defaultOffset || 0;

    this.pendingDB.each(`
      SELECT * FROM posts p
      WHERE (p.reference = "" AND (p.topic NOT LIKE ".%" OR p.topic = ""))
      ORDER BY timestamp ${order}
      LIMIT @limit
      OFFSET @start
    `, {
      start: offset,
      limit,
    }, row => {
      const env = new DomainEnvelope(
        0,
        row.tld,
        row.username,
        row.network_id,
        row.refhash,
        new Date(row.timestamp),
        new DomainPost(
          0,
          row.body,
          '',
          row.reference,
          row.topic,
          [],
          0,
          0,
          0,
        ),
        null,
      );
      envelopes.push(env);
    });

    if (envelopes.length < limit) {
      return new Pageable<DomainEnvelope<DomainPost>, number>(envelopes, -1);
    }

    return new Pageable<DomainEnvelope<DomainPost>, number>(
      envelopes,
      envelopes.length,
    );
  };

  getPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    const offset = order === 'ASC'
      ? defaultOffset || 0
      : defaultOffset || 999999999999999999999;

    this.engine.each(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE (p.reference is NULL AND (p.topic NOT LIKE ".%" OR p.topic is NULL)) AND p.id ${order === 'DESC' ? '<' : '>'} @start
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

    return new Pageable<DomainEnvelope<DomainPost>, number>(
      envelopes,
      envelopes[envelopes.length - 1].message.id,
    );
  };

  private mapPost (row: Row, includeTags: boolean): DomainEnvelope<DomainPost> {
    const tags: string[] = [];

    if (includeTags) {
      this.engine.each(`
          SELECT name as tag 
          FROM tags t JOIN tags_posts tp ON t.id = tp.tag_id
          WHERE tp.post_id = @postID
        `,
        {
          postID: row.post_id,
        },
        (row) => {
          tags.push(row.tag);
        },
      );
    }

    return new DomainEnvelope<DomainPost>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.network_id,
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

  deletePendingPost = async (networkId: string): Promise<any> => {
    this.pendingDB.exec(`
        DELETE FROM posts
        WHERE posts.network_id = @networkId
      `,{
      networkId: networkId,
    });
  };

  insertPendingPost = async (tld: string, envelope: DomainEnvelope<DomainPost>): Promise<any> => {
    return this.pendingDB.exec(`
        INSERT INTO posts (network_id, refhash, username, tld, timestamp, reference, body, topic)
        VALUES (@networkId, @refhash, @username, @tld, @timestamp, @reference, @body, @topic)
      `,{
      networkId: envelope.networkId,
      refhash: envelope.refhash,
      username: envelope.subdomain || '',
      tld: envelope.tld,
      timestamp: new Date(envelope.createdAt).getTime(),
      reference: envelope.message.reference,
      body: envelope.message.body,
      topic: envelope.message.topic,
    });
  };

  insertPendingModeration = async (tld: string, envelope: DomainEnvelope<DomainModeration>): Promise<any> => {
    return this.pendingDB.exec(`
        INSERT INTO moderations (network_id, refhash, username, tld, timestamp, reference, type)
        VALUES (@networkId, @refhash, @username, @tld, @timestamp, @reference, @type)
      `,{
      networkId: envelope.networkId,
      refhash: envelope.refhash,
      username: envelope.subdomain || '',
      tld: envelope.tld,
      timestamp: new Date(envelope.createdAt).getTime(),
      reference: envelope.message.reference,
      type: envelope.message.type,
    });
  };

  insertPendingConnection = async (tld: string, envelope: DomainEnvelope<DomainConnection>): Promise<any> => {
    return this.pendingDB.exec(`
        INSERT INTO connections (network_id, refhash, username, tld, timestamp, connectee_tld, connectee_subdomain, type)
        VALUES (@networkId, @refhash, @username, @tld, @timestamp, @connectee_tld, @connectee_subdomain, @type)
      `,{
      networkId: envelope.networkId,
      refhash: envelope.refhash,
      username: envelope.subdomain || '',
      tld: envelope.tld,
      timestamp: new Date(envelope.createdAt).getTime(),
      connectee_tld: envelope.message.tld,
      connectee_subdomain: envelope.message.subdomain,
      type: envelope.message.type,
    });
  };

  insertPost = async (tld: string, wire: WireEnvelope): Promise<any> => {
    const nameIndex = wire.nameIndex;
    const sub = await this.getSubdomainByIndex(nameIndex, tld);
    const subdomain = sub?.name || '';

    logger.info(`inserting message`, {
      networkd_id: wire.id,
      tld: tld,
      subdomain: subdomain,
    });

    try {
      const message = wire.message;
      const domainEnvelope = await mapWireToEnvelope(tld, subdomain, wire);

      switch (message.type.toString('utf-8')) {
        case Post.TYPE.toString('utf-8'):
          await this.deletePendingPost(domainEnvelope.networkId);
          await this.postsDao?.insertPost(domainEnvelope as DomainEnvelope<DomainPost>);
          return;
        case Connection.TYPE.toString('utf-8'):
          return await this.connectionsDao?.insertConnection(domainEnvelope as DomainEnvelope<DomainConnection>);
        case Moderation.TYPE.toString('utf-8'):
          return await this.moderationsDao?.insertModeration(domainEnvelope as DomainEnvelope<DomainModeration>);
        case Media.TYPE.toString('utf-8'):
          return await this.mediaDao?.insertMedia(domainEnvelope as DomainEnvelope<DomainMedia>);
        default:
          return;
      }
    } catch (err) {
      logger.error(`cannot insert message ${serializeUsername(subdomain, tld)}/${wire.id}`);
      logger.error(err?.message);
    }
  };

  findNextOffset = async (tld: string): Promise<number> => {
    let offset = 0;
    let timeout: any;
    const r = new BufferedReader(new BlobReader(tld, this.client), 1024 * 1024);
    return new Promise((resolve, reject) => {
      timeout = setTimeout(() => resolve(offset), 5000);
      iterateAllEnvelopes(r, (err, env) => {
        if (timeout) clearTimeout(timeout);

        if (err) {
          reject(err);
          return false;
        }

        if (env === null) {
          resolve(offset);
          return false;
        }

        // @ts-ignore
        offset = r.off;
        timeout = setTimeout(() => resolve(offset), 100);
        return true;
      });
    });
  };

  maybeStreamBlob = async (tld: string): Promise<void> => {
    logger.info(`streaming ${tld}`, { tld });

    try {
      // const blobInfo = await this.client.getBlobInfo(tld);
      // @ts-ignore
      // const lastMerkle = blobInfo.merkleRoot.toString('hex');
      // const row = await this.getBlobInfo(tld);
      // if (row && row.merkleRoot === lastMerkle) {
      //   logger.info(`${tld} already streamed`, row);
      //   return;
      // }

      const br = new BlobReader(tld, this.client);
      const r = new BufferedReader(br, 1024 * 1024);
      const isSubdomain = await this.isSubdomainBlob(r);

      if (isSubdomain) {
        await this.scanSubdomainData(r, tld);
        await this.scanBlobData(r, tld);
      } else {
        const newBR = new BufferedReader(new BlobReader(tld, this.client), 1024 * 1024);
        await this.scanBlobData(newBR, tld);
      }


      // await this.insertOrUpdateBlobInfo(tld, lastMerkle);
    } catch (e) {
      logger.error(e);
      // return Promise.reject(e);
    }
  };

  streamBlob = async (tld: string): Promise<void> => {
    logger.info(`streaming ${tld}`, { tld });

    try {
      const r = new BufferedReader(new BlobReader(tld, this.client), 1024 * 1024);
      const isSubdomain = await this.isSubdomainBlob(r);

      if (isSubdomain) {
       await this.scanSubdomainData(r, tld);
      }

      this.scanBlobData(r, tld);
    } catch (e) {
      logger.error(e);
      // return Promise.reject(e);
    }
  };

  private isSubdomainBlob = (r: BufferedReader): Promise<boolean> => {
    let timeout: any | undefined;
    return new Promise((resolve, reject) => {
      timeout = setTimeout(() => resolve(false), 5000);

      try {
        isSubdomainBlob(r, (err, res) => {
          if (timeout) clearTimeout(timeout);

          if (err) {
            reject(err);
            logger.error(err.message);
            return;
          }

          resolve(!!res);
        });
      } catch (e) {
        if (timeout) clearTimeout(timeout);
        reject(e);
      }
    });
  };

  private scanSubdomainData = (r: BufferedReader, tld: string): Promise<void> => {
    let timeout: any | undefined;
    return new Promise((resolve, reject) => {
      logger.info(`scan subdomain data`, { tld });
      timeout = setTimeout(() => {
        resolve();
      }, 500);

      iterateAllSubdomains(r, (err, sub) => {
        if (timeout) clearTimeout(timeout);

        if (err) {
          logger.error(err);
          reject(err);
          return false;
        }

        if (sub === null) {
          resolve();
          return false;
        }

        logger.info(`scanned subdomain data`, { name: sub.name, index: sub.index });

        this.insertOrUpdateSubdomain(
          sub.index,
          tld,
          sub.publicKey.toString('hex'),
          sub.name,
        );

        timeout = setTimeout(() => resolve(), 500);
        return true;
      });
    });
  };

  private scanBlobData = (r: BufferedReader, tld: string) => {
    let timeout: any | undefined;

    return new Promise((resolve, reject) => {
      logger.info(`scan blob data`, { tld });

      timeout = setTimeout(() => {
        resolve();
      }, 500);

      iterateAllEnvelopes(r, (err, env) => {
        if (timeout) clearTimeout(timeout);

        if (err) {
          logger.error(err);
          reject(err);
          return false;
        }

        if (env === null) {
          resolve();
          return false;
        }

        this.insertPost(tld, env);

        logger.info('scanned envelope', { tld, network_id: env.id });

        timeout = setTimeout(() => {
          resolve();
        }, 500);

        return true;
      });
    });


  };

  async start () {
    const exists = await this.dbExists();

    if (!exists) {
      logger.info('[indexer manager] Copying database');
      await this.copyDB();
      logger.info('[indexer manager] Copied database');
    }

    await this.engine.open();
    await this.nameDB.open();
    await this.pendingDB.open();
    this.postsDao = new PostsDAOImpl(this.engine);
    this.connectionsDao = new ConnectionsDAOImpl(this.engine);
    this.moderationsDao = new ModerationsDAOImpl(this.engine);
    this.mediaDao = new MediaDAOImpl(this.engine);
  }

  decodeBase64Image(dataString = ''): {
    type: string;
    data: Buffer;
  } {
    const matches = dataString
      .replace('\n', '')
      // eslint-disable-next-line no-useless-escape
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
    const nomadSrc = path.join(this.resourcePath, 'nomad.db');
    const nameSrc = path.join(this.resourcePath, 'names.db');
    const pendingSrc = path.join(this.resourcePath, 'pending.db');
    await fs.promises.copyFile(nomadSrc, this.dbPath);
    await fs.promises.copyFile(nameSrc, this.namedbPath);
    await fs.promises.copyFile(pendingSrc, this.pendingDbPath);
  }

  async readAllTLDs(): Promise<string[]> {
    await this.streamBlobInfo();
    return Object.keys(TLD_CACHE);
  }

  async streamAllBlobs(): Promise<void> {
    await this.streamBlobInfo();

    const tlds = Object.keys(TLD_CACHE);
    // const tlds = ['2062']
    for (let i = 0; i < tlds.length; i = i + 19) {
      const selectedTLDs = tlds.slice(i, i + 19).filter(tld => !!tld);
      await this.streamNBlobs(selectedTLDs);
    }

    // await this.streamBlobInfo('', undefined, true);
  }

  private async streamNBlobs(tlds: string[]): Promise<void[]> {
    return Promise.all(tlds.map(async tld => this.maybeStreamBlob(dotName(tld))));
  }

  streamBlobInfo = async (start = '', defaultTimeout?: number, shouldStreamContent?: boolean): Promise<number> => {
    let timeout: number | undefined = defaultTimeout;

    return new Promise((resolve, reject) => {
      let lastUpdate = start;
      let counter = 0;

      this.client.streamBlobInfo(start, 100, async (info) => {
        if (timeout) clearTimeout(timeout);

        if (shouldStreamContent) {
          await this.insertOrUpdateBlobInfo(info.name, info.merkleRoot);
        }

        TLD_CACHE[info.name] = info.merkleRoot;
        lastUpdate = info.name;
        counter++;

        timeout = setTimeout(resolve, 0);
        if (counter % 100 === 0) {
          await this.streamBlobInfo(lastUpdate, timeout);
        }
      });

      timeout = setTimeout(resolve, 500);
    })
  }

  private insertOrUpdateSubdomain = async (index: number, tld: string, publicKey: string, name: string): Promise<void> => {
    const row = await this.getSubdomainByIndex(index, tld);
    if (row) {
      if (row.name !== name || row.publicKey.toString('hex') != publicKey) {
        return this.nameDB.exec(`
          UPDATE names
          SET
            name = @name,
            public_key = @publicKey
          WHERE
            "index" = @index @ tld = @tld
        `, {
            name,
            index,
            publicKey,
            tld,
          });
        }

    } else {
      return this.nameDB.exec(`
        INSERT INTO names (name, "index", public_key, tld)
        VALUES (@name, @index, @publicKey, @tld)
      `, {
        name,
        index,
        publicKey,
        tld,
      });
    }
  };

  private getSubdomainByIndex = (index: number, tld: string): Subdomain | null => {
    const row = this.nameDB.first(`
      SELECT * FROM names
      WHERE "index" = @index AND tld = @tld
    `, {
      index,
      tld,
    });

    if (!row) return null;

    return {
      name: row?.name,
      index: row?.index,
      publicKey: Buffer.from(row?.public_key, 'hex'),
    }
  };

  getNameIndexBySubdomain = (username: string, tld: string): number => {
    const row = this.nameDB.first(`
      SELECT "index" FROM names n
      WHERE name = @username AND tld = @tld
    `, {
      username,
      tld,
    });

    if (!row) return 0;

    return row.index;
  };

  getNextNeworkId = (username: string, tld: string): string => {
    return crypto.randomBytes(8).toString('hex');
    // const row = this.engine.first(`
    //   SELECT network_id FROM envelopes
    //   WHERE tld = @tld AND subdomain = @username
    //   ORDER BY network_id DESC
    // `, {
    //   username,
    //   tld,
    // });
    //
    // if (!row) return 0;
    //
    // return 1 + Number(row.network_id);
  };

  private insertOrUpdateBlobInfo = async (tld: string, merkleRoot: string): Promise<void> => {
    const row = await this.getBlobInfo(tld);

    if (row) {
      if (row.merkleRoot !== merkleRoot) {
        return this.nameDB.exec(`
          UPDATE blobs
          SET
            merkleRoot = @merkleRoot,
            last_scanned_at = @lastScannedAt
          WHERE tld = @tld
        `, {
          merkleRoot,
          lastScannedAt: Date.now(),
          tld,
        });
      }
    } else {
      return this.nameDB.exec(`
        INSERT INTO blobs (tld, merkleRoot, last_scanned_at)
        VALUES (@tld, @merkleRoot, @lastScannedAt)
      `, {
        merkleRoot,
        lastScannedAt: Date.now(),
        tld,
      });
    }
  };

  private getBlobInfo = (tld: string): { tld: string; merkleRoot: string; lastScannedAt: string} | null => {
    const row = this.nameDB.first(`
      SELECT * FROM blobs
      WHERE tld = @tld
    `, {
      tld,
    });

    if (!row) return null;

    return {
      tld: row?.tld,
      merkleRoot: row?.merkleRoot,
      lastScannedAt: row?.last_scanned_at,
    };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


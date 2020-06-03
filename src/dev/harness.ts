import {RestServerResponse} from "../util/rest";
import SECP256k1Signer from 'ddrp-js/dist/crypto/signer'
import {create} from "domain";
healthCheck();


(async function () {
  await getPostsCheck('/posts');
  await getPostsCheck('/posts?order=ASC');
  await getPostsCheck('/posts?order=DESC');
  await getPostsCheck('/posts?order=DESC&limit=2');
  await getPostsCheck('/posts?order=DESC&limit=2&offset=2');
  await getPostsCheck('/posts?order=ASC&limit=100');
  await getPostsCheck('/posts?order=ASC&limit=250');
  await getPostsCheck('/posts?order=ASC&limit=20&offset=20');
  await getPostCheck('/posts/e6c6bf61453010d1a3aee46200c022ce343c4791912ba89905ab016c3b60ed57');
  await getPostsCheck('/posts/9ee4bd0908a3a0fff5f03aa58a24819b2343dc5f83adb1e18fd6cdceb3c58433/comments');
  await getPostsCheck('/users/9325/timeline');
  await getPostsCheck('/users/9325/likes');
  await getPostsCheck('/users/9325/comments');
  await getPostsCheck('/tags?tags=bug');
  await getUserProfileCheck('/users/9325/profile');

  const offsetResp = await fetch('/blob/9325/info');
  const offsetJson = await offsetResp.json();
  const offset = offsetJson.payload.nextOffset;

  const createdAt = Math.floor(Date.now()/1000) * 1000;
  const params = {
    "tld": "9325",
    "post": {
      "body": "hello, world 8",
      "title": null,
      "reference": null,
      "topic": null,
      "tags": ["test"]
    },
    date: createdAt,
    offset,
  };

  const json = await precommit(params);
  console.log('precommit', json.payload);

  const fixedParams = {
    ...params,
    networkId: json.payload.envelope.id,
    refhash: json.payload.refhash,
    date: createdAt,
  };

  // const json2 = await precommit(fixedParams);
  // console.log('precommit2', json2.payload);

  // const signer = SECP256k1Signer.fromHexPrivateKey(
  //   'xxx'
  // );
  //
  // console.log(signer.sign(Buffer.from('0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8', 'hex')).toString('hex'))

  // const sig = signer.sign(Buffer.from(json.payload.sealedHash, 'hex'));
  //
  // await wait(500);
  //
  // console.log(sig.toString('hex'))
  //
  // const resp2 = await fetch(`/writer/commit`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     ...fixedParams,
  //     sealedHash: json.payload.sealedHash,
  //     sig: sig.toString('hex'),
  //   }),
  // });
  //
  // const json2 = await resp2.json();
  // console.log(json2);
})();

async function precommit(params: any) {
  const resp = await fetch(`/relayer/precommit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  return await resp.json();
}


async function healthCheck() {
  const resp = await fetch('/health');
  const json: RestServerResponse = await resp.json();
  assert(json.payload, 'ok', 'Health is ok');
}

async function getUserProfileCheck(path: string) {
  const resp = await fetch(path);
  const json: RestServerResponse = await resp.json();
  console.log(json.payload);
  if (json.error) {
    console.error(json);
  }

  if (resp.status !== 200) {
    console.error(resp);
  }

  assert(typeof json.payload, 'object', `GET ${path}`);
}


async function getPostCheck(path: string) {
  const resp = await fetch(path);
  const json: RestServerResponse = await resp.json();
  assert(!!json.error, false, `GET ${path}`);
  console.log(json.payload);
  if (json.error) {
    console.error(json);
  }

  if (resp.status !== 200) {
    console.error(resp);
  }

  if (!(json.payload === null || json.payload.meta)) {
    console.error(`payload should be null or PostWithMeta`, json.payload);
  }

}

async function getPostsCheck(path: string) {
  const resp = await fetch(path);
  const json: RestServerResponse = await resp.json();
  console.log(json.payload);
  if (json.error) {
    console.error(json);
  }

  if (resp.status !== 200) {
    console.error(resp);
  }

  if (!Array.isArray(json.payload.items)) {
    console.error(`payload.items should be an array`, json.payload.items);
  }

  if (!(typeof json.payload.next === 'number' || json.payload.next === null)) {
    console.error(`payload.next should be a number or null`, json.payload.next);
  }

  assert(!!json.error, false, `GET ${path}`);
}

function assert(a: any, b: any, text: string): boolean {
  console.log('[Assertion]', text);
  if (a !== b) {
    throw new Error('Assertion Error');
  }
  return a === b;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

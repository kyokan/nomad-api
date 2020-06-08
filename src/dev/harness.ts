import {RestServerResponse} from "../util/rest";
import SECP256k1Signer from 'ddrp-js/dist/crypto/signer'
import secp256k1 from "secp256k1";
import {generateNewCompressedKey} from "../util/key";
import {hashConnectionBody, hashMediaBody, hashModerationBody, hashPostBody} from "../util/envelope";
import {ConnectionBody, ModerationBody} from "../constants";
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

  // const offsetResp = await fetch('/blob/9325/info');
  // const offsetJson = await offsetResp.json();
  // const offset = offsetJson.payload.nextOffset;

  // const createdAt = Math.floor(Date.now()/1000) * 1000;
  // const params = {
  //   "tld": "9325",
  //   "post": {
  //     "body": "hello, world 8",
  //     "title": null,
  //     "reference": null,
  //     "topic": null,
  //     "tags": ["test"]
  //   },
  //   date: createdAt,
  //   offset,
  // };

  // const json = await precommit(params);
  // console.log('precommit', json.payload);

  // const fixedParams = {
  //   ...params,
  //   networkId: json.payload.envelope.id,
  //   refhash: json.payload.refhash,
  //   date: createdAt,
  // };

  // const json2 = await precommit(fixedParams);
  // console.log('precommit2', json2.payload);

  const fileupload = document.getElementById("fileupload");
  fileupload!.onchange = async (e) => {
    const timestamp = Date.now();
    const [file]: File[] = e?.target?.files || [];
    const formData = new FormData();
    formData.append('file', file);
    const fileBuf = await file.arrayBuffer();
    const buf = Buffer.from(fileBuf);

    const hash = hashMediaBody({
      filename: file.name,
      mimeType: file.type,
      content: buf.toString('hex'),
    }, new Date(timestamp));


    // @ts-ignore
    const {signature} = secp256k1.sign(
      hash,
      Buffer.from('1ad287a8a4189e239261299c46aceeb3e684a2ae4222bd2c8ea855d75b06131a', 'hex')
    );
    formData.append('signature', signature.toString('hex'));
    formData.append('tld', '9325');
    formData.append('subdomain', 'ibchilling');
    formData.append('filename', file.name);
    formData.append('mimeType', file.type);
    formData.append('timestamp', new Date(timestamp).toISOString());

    const resp = await fetch('/medias', {
      method: 'POST',
      // headers: {
      //   'Content-Type': 'application/json',
      // },
      body: formData,
    });
    const json = await resp.json();
    console.log(json);
  }
})();

async function connect(tld: string, subdomain: string) {
  const postBody: ConnectionBody = {
    "connectee_tld": tld,
    "connectee_subdomain": subdomain,
    "tld": tld,
    "subdomain": subdomain,
    "type": 'FOLLOW',
  };
  const timestamp = Date.now();
  const hash = hashConnectionBody(postBody, new Date(timestamp));
  // @ts-ignore
  const {signature} = secp256k1.sign(
    hash,
    Buffer.from('1ad287a8a4189e239261299c46aceeb3e684a2ae4222bd2c8ea855d75b06131a', 'hex')
  );

  const resp = await fetch('/connections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...postBody,
      timestamp,
      sig: {
        tld: '9325',
        subdomain: 'ibchilling',
        signature: signature.toString('hex'),
      },
    }),
  });
  return await resp.json();
}

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

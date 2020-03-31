import {RestServerResponse} from "../util/rest";

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
  await getPostsCheck('/users/@test-cross-platform.2062/timeline');
  await getPostsCheck('/users/@9325/likes');
  await getPostsCheck('/users/@jackychan/comments');
  await getPostsCheck('/users/@whogonnastopme.9411/followees');
  await getPostsCheck('/users/@whogonnastopme.9411/blockees');
  await getPostsCheck('/tags?tags=bug');
  await getUserProfileCheck('/users/@9325/profile');
})();


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

  assert(typeof json.payload, 'string', `GET ${path}`);
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

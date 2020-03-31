# GET /posts/:refhash

Returns post by a given refhash.

### Resource URL
`https://api.nomadweb.io/posts/:refhash`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| refhash | Yes | Specify refhash of the post to be fetched |

### Sample Response

```typescript
// curl https://api.nomadweb.io/posts/e6c6bf61453010d1a3aee46200c022ce343c4791912ba89905ab016c3b60ed57
{
  "post": {
    "tld": "9325.",
    "subdomain": null,
    "guid": "72afa2c633994b0eb48878e1f2d0800a",
    "timestamp": "2020-03-11T07:50:26.000Z",
    "parent": null,
    "context": null,
    "content": "One small post for @9325\n",
    "topic": "",
    "tags": [
      
    ]
  },
  "meta": {
    "replyCount": 53,
    "likeCount": 3,
    "pinCount": 0
  }
}
```

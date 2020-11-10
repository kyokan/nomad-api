# GET /posts/:refhash

Returns post by a given refhash.

### Resource URL
`https://api.nmd.co/posts/:refhash`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| refhash | Yes | Specify refhash of the post to be fetched |

### Sample Response

```typescript
{
    "payload": {
        "id": 1,
        "tld": "kyokan",
        "subdomain": "",
        "networkId": "",
        "refhash": "d12343a489083aaf33f7b8b2f53243dce802a75eea71eebaa0e27823da83d3b36b796f6b616e",
        "createdAt": "2020-11-09T05:29:17.000Z",
        "message": {
            "id": 1,
            "body": "\"We're on the verge of a shift in how information is exchanged, a decentralization revolution. I don't think anyone can stop this now.\"\n",
            "title": null,
            "reference": null,
            "topic": null,
            "tags": [],
            "replyCount": 0,
            "likeCount": 0,
            "pinCount": 0
        },
        "additionalData": null
    }
}
```

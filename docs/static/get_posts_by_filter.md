# POST /filter

Returns list of posts based on filter settings.

### Resource URL
`https://api.nmd.co/filter`

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

### Body Parameters (application/json)

| Name | Required | Description | Default |
|--|--|--|--|
| postedBy | No | Filter posts by creators. Use `*` as wildcard. (e.g. `["@jackychan", "@whogonnastopme.9411"]`). | `[]`  |
| likedBy | No | Filter posts liked by specified usernames. Use `*` as wildcard. | `[]` |
| repliedBy | No | Filter posts replied by specified usernames. Use `*` as wildcard. | `[]` |
| allowedTags | No | Filter posts with specified tags. Use `*` as wildcard. | `[]` |
| postHashes | No | Filter posts by specific hashes | `[]` |
| parentHashes | No | Filter posts by specific parent hashes. | `[]` |

### Sample Response

```typescript
{
    "payload": {
        "items": [
            {
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
        ],
        "next": 1
    }
}
```

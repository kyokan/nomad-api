# POST /filter

Returns list of posts based on filter settings.

### Resource URL
`https://api.nomadweb.io/filter`

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
/**
curl -X POST \
  'https://api.nomadweb.io/filter?order=DESC&offset=0' \
  -H 'Content-Type: application/json' \
  -H 'cache-control: no-cache' \
  -d '{
    "filter": {
        "postedBy": [],
        "likedBy": [],
        "repliedBy": ["@jackychan"],
        "postHashes": [],
        "parentHashes": [],
        "allowedTags": ["*"]
    }
}'
*/
{
  "items": [
    {
      "post": {
        "tld": "jackychan.",
        "subdomain": null,
        "guid": "e5403519e976440c8d5c6a9616507a64",
        "timestamp": "2020-03-30T05:35:37.000Z",
        "parent": "22aa227c1258d350e80f521ec6a1b3e62eee09d51c632b32d86ebd5febf2e8e4",
        "context": null,
        "content": "https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion\n",
        "topic": "",
        "tags": []
      },
      "meta": {
        "replyCount": 0,
        "likeCount": 0,
        "pinCount": 0
      }
    }
  ],
  "next": null
}
```

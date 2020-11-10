# GET /users/:username/timeline

Returns list of top level posts by a user.

### Resource URL
`https://api.nmd.co/users/:username/timeline`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| username | Yes | Username of the user to be fetched (e.g. @jackychan) |

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

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

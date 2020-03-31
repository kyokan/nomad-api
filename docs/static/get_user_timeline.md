# GET /users/:username/timeline

Returns list of top level posts by a user.

### Resource URL
`https://api.nomadweb.io/users/:username/timeline`

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
// curl https://api.nomadweb.io/users/@9325/timeline?order=ASC&limit=1
{
  "items": [
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
  ],
  "next": 1
}
```

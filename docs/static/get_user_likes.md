# GET /users/:username/likes

Returns list of all posts liked by a user.

### Resource URL
`https://api.nomadweb.io/users/:username/likes`

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

### Sample Response

```typescript
// curl https://api.nomadweb.io/users/@4813/likes?order=ASC&limit=1
{
  "items": [
    {
      "post": {
        "tld": "9325.",
        "subdomain": null,
        "guid": "d464f9d14eaa433d86734df592e5247a",
        "timestamp": "2020-03-11T08:26:54.000Z",
        "parent": null,
        "context": null,
        "content": "I kinda like the identicon\n",
        "topic": "",
        "tags": [
          
        ]
      },
      "meta": {
        "replyCount": 0,
        "likeCount": 2,
        "pinCount": 0
      }
    }
  ],
  "next": 1
}
```

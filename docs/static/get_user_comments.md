# GET /users/:username/comments

Returns all replies made by a user.

### Resource URL
`https://api.nomadweb.io/users/:username/comments`

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
// curl https://api.nomadweb.io/users/@4813/comments?order=DESC&limit=1
{
  "items": [
    {
      "post": {
        "tld": "4813.",
        "subdomain": null,
        "guid": "834ff915b0b64151aee40fd581df63ab",
        "timestamp": "2020-03-28T05:39:27.000Z",
        "parent": "9b095edbf6ac030e61582bbd6cc0c2d1b548eac012b0f9030b3f1810c65311bb",
        "context": null,
        "content": "yep verified\n",
        "topic": "",
        "tags": [
          
        ]
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

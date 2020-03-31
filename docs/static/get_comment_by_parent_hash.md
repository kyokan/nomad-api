# GET /posts/:refhash/comments

Returns replies of a given refhash.

### Resource URL
`https://api.nomadweb.io/posts/:refhash/comments`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| refhash | Yes | Specify refhash of the post to be fetched |

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

### Sample Response

```typescript
// curl https://api.nomadweb.io/posts/e6c6bf61453010d1a3aee46200c022ce343c4791912ba89905ab016c3b60ed57/comments
{
  "items": [
    { 
      "post": {
        "tld": "9411.",
        "subdomain": "whogonnastopme",
        "guid": "4918d590c73e487e93fcc9bf54496cf4",
        "timestamp": "2020-03-12T04:27:02.000Z",
        "parent": "e6c6bf61453010d1a3aee46200c022ce343c4791912ba89905ab016c3b60ed57",
        "context": null,
        "content": "true that\n",
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
  "next": 1
}
```

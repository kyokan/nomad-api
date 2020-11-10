# GET /users/:username/likes

Returns list of all posts liked by a user.

### Resource URL
`https://api.nmd.co/users/:username/likes`

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
                "id": 6,
                "tld": "kyokan",
                "subdomain": "",
                "networkId": "",
                "refhash": "ec60461b1c80006d9ca70327714de3dc69bebb5ec70eded85a38300d3c8743ca6b796f6b616e",
                "createdAt": "2020-11-09T05:39:57.000Z",
                "message": {
                    "id": 6,
                    "body": "\"We can make openness irrevocable.\" - [](http://brewster.kahle.org/2015/08/11/locking-the-web-open-a-call-for-a-distributed-web-2/)\n",
                    "title": null,
                    "reference": null,
                    "topic": null,
                    "tags": [],
                    "replyCount": 0,
                    "likeCount": 1,
                    "pinCount": 0
                },
                "additionalData": null
            }
        ],
        "next": 6
    }
}
```

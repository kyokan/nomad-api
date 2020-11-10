# GET /users/:username/followees

Returns list of all users followed by a user.

### Resource URL
`https://api.nmd.co/users/:username/followees`

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
        "tld": "4813",
        "subdomain": null,
        "timestamp": "2020-03-23T06:11:40.000Z",
        "followeeTld": "9325",
        "followeeSubdomain": null
      }
    ],
    "next": null
  }
}
```

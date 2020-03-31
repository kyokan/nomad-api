# GET /users/:username/blockees

Returns list of all users blocked by a user.

### Resource URL
`https://api.nomadweb.io/users/:username/blockees`

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

### Sample Response

```typescript
// curl https://api.nomadweb.io/users/@4813/blockees?order=ASC&limit=1
{
  "items": [
    {
      "tld": "4813.",
      "subdomain": null,
      "guid": "69a1b8a050a649db93642183a8075a4a",
      "timestamp": "2020-03-23T02:51:19.000Z",
      "blockeeTld": "2062",
      "blockeeSubdomain": "test-cross-platform"
    }
  ],
  "next": null
}
```

# GET /users/:username/followees

Returns list of all users followed by a user.

### Resource URL
`https://api.nomadweb.io/users/:username/followees`

### Query Parameters
| Name | Required | Description | Default |
|--|--|--|--|
| order | No | Specify orders of posts. (DESC or ASC) | DESC  |
| limit | No | Specify the number of posts to fetch. (Maximum=1000) |  |
| offset | No | Specify the posts offset to begin the fetch. | 0 |

### Sample Response

```typescript
// curl https://api.nomadweb.io/users/@4813/followees?order=ASC&limit=1
{
  "items": [
    {
      "tld": "4813.",
      "subdomain": null,
      "guid": "027be7e39e054daa927adfcb3afe273b",
      "timestamp": "2020-03-23T06:11:40.000Z",
      "followeeTld": "9325.",
      "followeeSubdomain": null
    }
  ],
  "next": null
}
```

# GET /users/:username/profile

Returns user's profile info.

### Resource URL
`https://api.nomadweb.io/users/:username/profile`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| username | Yes | Username of the user to be fetched (e.g. @jackychan) |

### Sample Response

```typescript
// curl https://api.nomadweb.io/users/@whogonnastopme.9411/profile
{
  "profilePicture": "",
  "coverImage": "",
  "bio": "The Strongest Decoy 🏐\n",
  "avatarType": "jdenticon\n",
  "displayName": "Hinata Shōyō 日向翔陽\n"
}
```

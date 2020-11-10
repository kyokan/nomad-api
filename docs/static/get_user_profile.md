# GET /users/:username/profile

Returns user's profile info.

### Resource URL
`https://api.nmd.co/users/:username/profile`

### Path Parameters
| Name | Required | Description |
|--|--|--|
| username | Yes | Username of the user to be fetched (e.g. @jackychan) |

### Sample Response

```typescript
{
    "payload": {
        "profilePicture": "",
        "coverImage": "",
        "bio": "",
        "avatarType": "jdenticon",
        "displayName": "KYOKAN"
    }
}
```

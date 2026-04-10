# OpenID Federation Trust Anchor

This is a Trust Anchor server for OpenID Federation testing. The Trust Anchor maintains a registry of trusted entities (both Relying Parties and OpenID Providers) and issues entity statements for registered subordinates.

## Features

- ✅ **Entity Type Support** - Manages both RP and OP entities
- ✅ **Entity Statement Issuance** - Issues signed entity statements
- ✅ **Admin UI** - Web interface for entity management
- ✅ **Entity Discovery** - Serves entity configuration at `/.well-known/openid-federation`
- ✅ **Type-Specific Metadata** - Includes correct metadata type for each entity

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Configure your environment variables in `.env`

## Configuration

### Environment Variables

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `PORT` | Server port | No | `3010` | `3010` |
| `TRUST_ANCHOR_URL` | Trust Anchor public URL | **Yes** | - | `https://trust-anchor.example.com` |
| `ENTITY_TYPE_SUPPORT` | Enable entity type differentiation | No | `true` | `true` |

### Example Configuration

```bash
PORT=3010
TRUST_ANCHOR_URL=https://trust-anchor.example.com
ENTITY_TYPE_SUPPORT=true
```

## Entity Type Management

### Entity Types

The Trust Anchor supports two entity types:

1. **Relying Party (RP)** - `openid_relying_party`
   - Client applications that initiate authentication
   - Receive entity statements with `openid_relying_party` metadata

2. **OpenID Provider (OP)** - `openid_provider`
   - Authorization servers that authenticate users
   - Receive entity statements with `openid_provider` metadata

### Adding Entities

#### Via Admin UI

1. **Access the Admin UI**
   - Navigate to `http://localhost:3010/admin` (or your configured URL)
   - The admin interface displays all registered entities

2. **Add a New Entity**
   - Locate the "Add New Entity" form
   - Enter the **Entity ID** (must be a valid HTTPS URL)
   - Select the **Entity Type** from the dropdown:
     - `Relying Party (RP)` for client applications
     - `OpenID Provider (OP)` for authorization servers
   - Click "Add Entity"

3. **Verify Entity Registration**
   - The entity will appear in the entity list
   - Entity type is displayed with a colored badge:
     - 🔵 Blue badge for RPs
     - 🟢 Green badge for OPs

#### Via Admin API

**Add Entity Endpoint**

```http
POST /admin/entities
Content-Type: application/json

{
  "entityId": "https://op.example.com",
  "entityType": "openid_provider"
}
```

**Response**

```json
{
  "success": true,
  "message": "Entity added successfully",
  "entity": {
    "entityId": "https://op.example.com",
    "entityType": "openid_provider",
    "addedAt": 1234567890000
  }
}
```

**Entity Type Values**

- `openid_relying_party` - For RP entities
- `openid_provider` - For OP entities

### Viewing Entities

#### Via Admin UI

1. **View All Entities**
   - Navigate to `/admin`
   - All registered entities are displayed in a table
   - Columns include:
     - Entity ID
     - Entity Type (with colored badge)
     - Added Date
     - Actions (Remove button)

2. **Filter by Entity Type**
   - Use the filter buttons at the top of the entity list
   - Click "All" to show all entities
   - Click "RPs" to show only Relying Parties
   - Click "OPs" to show only OpenID Providers
   - Entity counts are displayed for each type

#### Via Admin API

**List Entities Endpoint**

```http
GET /admin/entities
```

**Response**

```json
{
  "entities": [
    {
      "entityId": "https://rp.example.com",
      "entityType": "openid_relying_party",
      "addedAt": 1234567890000
    },
    {
      "entityId": "https://op.example.com",
      "entityType": "openid_provider",
      "addedAt": 1234567891000
    }
  ]
}
```

### Removing Entities

#### Via Admin UI

1. Locate the entity in the entity list
2. Click the "Remove" button next to the entity
3. The entity will be removed immediately
4. Entity statements will no longer be served for this entity

#### Via Admin API

**Remove Entity Endpoint**

```http
DELETE /admin/entities/:entityId
```

**Example**

```http
DELETE /admin/entities/https%3A%2F%2Fop.example.com
```

**Response**

```json
{
  "success": true,
  "message": "Entity removed successfully"
}
```

## Entity Statements

### Entity Statement Structure

The Trust Anchor issues entity statements with type-specific metadata:

**For Relying Parties (RPs)**

```json
{
  "iss": "https://trust-anchor.example.com",
  "sub": "https://rp.example.com",
  "iat": 1234567890,
  "exp": 1234571490,
  "jwks": {
    "keys": [...]
  },
  "metadata": {
    "openid_relying_party": {
      "client_name": "Example RP",
      "redirect_uris": ["https://rp.example.com/callback"]
    }
  }
}
```

**For OpenID Providers (OPs)**

```json
{
  "iss": "https://trust-anchor.example.com",
  "sub": "https://op.example.com",
  "iat": 1234567890,
  "exp": 1234571490,
  "jwks": {
    "keys": [...]
  },
  "metadata": {
    "openid_provider": {
      "issuer": "https://op.example.com",
      "authorization_endpoint": "https://op.example.com/authorize"
    }
  }
}
```

### Fetching Entity Statements

Entity statements are served at:

```
GET /.well-known/openid-federation?sub=<entity_id>
```

**Example**

```bash
curl "https://trust-anchor.example.com/.well-known/openid-federation?sub=https://op.example.com"
```

**Response**

Returns a signed JWT containing the entity statement.

## Admin UI Usage Guide

### Accessing the Admin UI

1. Start the Trust Anchor server:
   ```bash
   npm start
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3010/admin
   ```

### Admin UI Features

#### Entity List Table

The main table displays all registered entities with the following columns:

- **Entity ID** - The unique identifier (HTTPS URL) for the entity
- **Entity Type** - Visual badge indicating RP (blue) or OP (green)
- **Added Date** - When the entity was registered
- **Actions** - Remove button to delete the entity

#### Add Entity Form

Located at the top of the page:

1. **Entity ID Field**
   - Enter the entity's unique identifier
   - Must be a valid HTTPS URL
   - Example: `https://op.example.com`

2. **Entity Type Dropdown**
   - Select "Relying Party (RP)" for client applications
   - Select "OpenID Provider (OP)" for authorization servers

3. **Add Entity Button**
   - Click to register the entity
   - Entity will appear in the list immediately

#### Entity Type Filter

Filter buttons allow you to view specific entity types:

- **All** - Shows all registered entities
- **RPs (X)** - Shows only Relying Parties (count displayed)
- **OPs (X)** - Shows only OpenID Providers (count displayed)

#### Entity Type Badges

Visual indicators for entity types:

- 🔵 **Blue Badge** - Relying Party (RP)
- 🟢 **Green Badge** - OpenID Provider (OP)

### Common Admin Tasks

#### Register a New OP

1. Navigate to `/admin`
2. In the "Add New Entity" form:
   - Entity ID: `https://op.example.com`
   - Entity Type: Select "OpenID Provider (OP)"
3. Click "Add Entity"
4. Verify the OP appears with a green badge

#### Register a New RP

1. Navigate to `/admin`
2. In the "Add New Entity" form:
   - Entity ID: `https://rp.example.com`
   - Entity Type: Select "Relying Party (RP)"
3. Click "Add Entity"
4. Verify the RP appears with a blue badge

#### View Only OPs

1. Navigate to `/admin`
2. Click the "OPs" filter button
3. Only OpenID Providers will be displayed

#### Remove an Entity

1. Locate the entity in the list
2. Click the "Remove" button
3. Entity is removed immediately
4. Entity statements will no longer be served

## Running the Trust Anchor

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Running Tests

```bash
npm test
```

## API Endpoints

### Public Endpoints

- **GET** `/.well-known/openid-federation` - Trust Anchor entity configuration
- **GET** `/.well-known/openid-federation?sub=<entity_id>` - Entity statement for subordinate

### Admin Endpoints

- **GET** `/admin` - Admin UI
- **GET** `/admin/entities` - List all entities (JSON)
- **POST** `/admin/entities` - Add new entity (JSON)
- **DELETE** `/admin/entities/:entityId` - Remove entity

## Entity Statement Validation

### Type Consistency

The Trust Anchor ensures entity statements match the registered entity type:

- **RP entities** always receive `openid_relying_party` metadata
- **OP entities** always receive `openid_provider` metadata
- Metadata type is validated on entity statement creation
- Type mismatches are prevented by the system

### Entity Type Persistence

Entity types are persisted in storage:

- Entity type is stored when entity is added
- Entity type is returned in all query results
- Entity type is included in entity statements
- Entity type cannot be changed (must remove and re-add)

## Security Considerations

- **HTTPS Required**: All entity IDs must use HTTPS protocol
- **JWT Signing**: All entity statements are signed with Trust Anchor's private key
- **Entity Validation**: Entity IDs are validated before registration
- **Type Validation**: Entity types are validated against allowed values

## Troubleshooting

### Entity Not Appearing in List

- Verify entity was added successfully (check for error messages)
- Refresh the admin page
- Check browser console for JavaScript errors

### Entity Statement Not Served

- Verify entity is registered in the Trust Anchor
- Check entity ID matches exactly (case-sensitive)
- Verify entity type is correct
- Check Trust Anchor logs for errors

### Wrong Metadata Type in Entity Statement

- Verify entity type is correct in admin UI
- Remove and re-add entity with correct type
- Check Trust Anchor logs for type consistency errors

## Related Documentation

- [RP OP Validation Configuration](../test-client-federation-valid/README.md)
- [OpenID Federation Specification](https://openid.net/specs/openid-federation-1_0.html)

## License

MIT

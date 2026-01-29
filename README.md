# OpenID Connect Authorization Server

An OpenID Connect Authorization Server built with Node.js/TypeScript and Express.js, integrated with Authlete's cloud-based authorization service.

## Features

- OAuth 2.0 Authorization Code Flow
- **OpenID Federation Dynamic Registration** 🆕
- Integration with Authlete API
- TypeScript support with strict type checking
- Express.js web framework
- Security middleware (Helmet)
- Session management
- Rate limiting capabilities
- Comprehensive logging
- Health check endpoint

## 📚 Documentation

### OpenID Federation
- **[クイックスタートガイド](QUICKSTART.md)** - 最速で環境を起動
- **[セットアップガイド](FEDERATION_SETUP_README.md)** - 詳細な設定手順とトラブルシューティング
- **[E2Eテスト結果](FEDERATION_E2E_TEST_RESULTS.md)** - 動作確認結果
- **[統合実装概要](FEDERATION_INTEGRATION_SUMMARY.md)** - アーキテクチャと実装詳細

### 仕様とタスク
- [要件定義](.kiro/specs/federation-dynamic-registration/requirements.md)
- [設計書](.kiro/specs/federation-dynamic-registration/design.md)
- [タスクリスト](.kiro/specs/federation-dynamic-registration/tasks.md)

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Authlete account and service credentials

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure your Authlete credentials in `.env`:
   ```
   AUTHLETE_BASE_URL=https://us.authlete.com
   AUTHLETE_SERVICE_ID=your_service_id_here
   AUTHLETE_SERVICE_ACCESS_TOKEN=your_service_access_token_here
   SESSION_SECRET=your_secure_session_secret_here
   ```

## Development

### Build the project:
```bash
npm run build
```

### Run in development mode:
```bash
npm run dev
```

### Run in production mode:
```bash
npm start
```

### Run tests:
```bash
npm test
```

### Lint code:
```bash
npm run lint
```

### Fix linting issues:
```bash
npm run lint:fix
```

## API Endpoints

### Health Check
- **GET** `/health` - Returns server health status

### Root
- **GET** `/` - Returns basic server information

### OpenID Federation
- **POST** `/federation/registration` - Dynamic client registration endpoint
- **GET** `/.well-known/openid-federation` - Entity configuration endpoint

## OpenID Federation Quick Start

OpenID Federationを使用した動的クライアント登録のテスト環境を起動する手順：

### 1. cloudflaredトンネルを起動
```bash
# Trust Anchor用
cloudflared tunnel --url http://localhost:3010

# Valid Client用
cloudflared tunnel --url http://localhost:3006
```

### 2. URL更新スクリプトを実行
```bash
./update-federation-urls.sh
```

### 3. サーバーを起動
```bash
# Trust Anchor
cd trust-anchor && npm start

# Valid Test Client
cd test-client-federation-valid && npm start

# Authorization Server
npm start
```

詳細は [QUICKSTART.md](QUICKSTART.md) を参照してください。

## Configuration

The application uses environment variables for configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTHLETE_BASE_URL` | Authlete API base URL | Required |
| `AUTHLETE_SERVICE_ID` | Authlete service ID | Required |
| `AUTHLETE_SERVICE_ACCESS_TOKEN` | Authlete service access token | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production/test) | development |
| `SESSION_SECRET` | Session encryption secret | Required |
| `HTTP_TIMEOUT` | HTTP request timeout (ms) | 10000 |
| `HTTP_RETRY_ATTEMPTS` | Number of retry attempts | 3 |

## Project Structure

```
src/
├── config/          # Configuration management
├── app.ts           # Express application setup
├── index.ts         # Server entry point
└── *.test.ts        # Test files
```

## Security Features

- Helmet.js for security headers
- Secure session configuration
- Input validation and sanitization
- Rate limiting protection
- HTTPS enforcement in production

## License

MIT
# OpenID Connect Authorization Server

OpenID Federation 1.0に対応したOAuth 2.0 / OpenID Connect認可サーバーです。Node.js/TypeScript + Express.jsで実装され、Authleteのクラウドベース認可サービスと統合されています。

## 主な機能

- ✅ OAuth 2.0 Authorization Code Flow
- ✅ **OpenID Federation 動的クライアント登録**
- ✅ **マルチOP選択機能**（複数のOPから選択可能）
- ✅ **Trust Chain検証**
- ✅ **Entity Discovery**
- ✅ **Request Object処理（JWT）**
- ✅ Exponential Backoffによるレート制限対策
- ✅ Authlete API統合
- ✅ TypeScript完全対応
- ✅ セキュリティミドルウェア（Helmet）
- ✅ セッション管理
- ✅ レート制限
- ✅ 包括的なロギング
- ✅ ヘルスチェックエンドポイント

## 📚 ドキュメント

### クイックスタート
- **[クイックスタートガイド](QUICKSTART.md)** - 5分で環境を起動
- **[マルチOP環境クイックリファレンス](MULTI_OP_QUICK_REFERENCE.md)** - 複数OP起動の簡易ガイド
- **[Federation実装ガイド](FEDERATION_README.md)** - 完全な実装ドキュメント

### セットアップガイド
- **[OP2セットアップガイド](OP2_SETUP.md)** - 2つ目のOPのセットアップ手順
- **[OP Federationセットアップ](OP_FEDERATION_SETUP.md)** - OPのFederation設定

### 仕様書
- [Federation動的登録](.kiro/specs/federation-dynamic-registration/) - 要件定義、設計書、タスクリスト
- [マルチOP選択機能](.kiro/specs/rp-multi-op-selection/) - 要件定義、設計書、タスクリスト
- [OP Trust検証機能](.kiro/specs/rp-op-trust-validation/) - 要件定義、設計書、タスクリスト

### その他
- **[プロジェクトサマリー](PROJECT_SUMMARY.md)** - プロジェクト全体の概要
- **[トラブルシューティング](TROUBLESHOOTING.md)** - よくある問題と解決方法

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

## OpenID Federation クイックスタート

```bash
# 1. 依存関係のインストール
npm install && npm run build
cd trust-anchor && npm install && cd ..
cd test-client-federation-valid && npm install && cd ..
cd test-client-federation-invalid && npm install && cd ..

# 2. cloudflaredトンネルを起動（別ターミナル）
cloudflared tunnel --url http://localhost:3010  # Trust Anchor
cloudflared tunnel --url http://localhost:3006  # Valid Client
cloudflared tunnel --url http://localhost:3007  # Invalid Client

# 3. URL設定を更新
./update-federation-urls.sh

# 4. サーバーを起動
cd trust-anchor && npm start                    # Trust Anchor
cd test-client-federation-valid && npm start    # Valid Client
cd test-client-federation-invalid && npm start  # Invalid Client
npm start                                        # Authorization Server
```

詳細は **[QUICKSTART.md](QUICKSTART.md)** を参照してください。

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
| `HTTP_RETRY_ATTEMPTS` | Number of retry attempts (recommended: 5 for rate limiting) | 3 |

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
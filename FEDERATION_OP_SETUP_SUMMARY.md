# 認可サーバ（OP）のFederation設定 - 変更サマリー

## 実施した変更

### 1. 環境変数の追加

**ファイル**: `.env`, `.env.example`

追加した設定：
```bash
# Authorization Server (OP) Entity ID
# This is the public URL where the OP is accessible (via cloudflared)
OP_ENTITY_ID=https://pete-moderator-looks-should.trycloudflare.com
```

### 2. URL更新スクリプトの拡張

**ファイル**: `update-federation-urls.sh`

変更内容：
- OPのcloudflaredURLを入力できるように拡張
- Trust AnchorのSUBORDINATE_ENTITIESにOPを追加
- OPのEntity IDを`.env`に自動設定

使用方法：
```bash
./update-federation-urls.sh

# プロンプトに従って入力：
# - Trust Anchor URL
# - Authorization Server (OP) URL  ← 新規追加
# - Valid Client URL
# - Invalid Client URL
```

### 3. クイックスタートガイドの更新

**ファイル**: `QUICKSTART.md`

変更内容：
- OPのcloudflaredトンネル設定手順を追加
- Trust AnchorへのOP登録手順を追加
- サーバー起動順序を更新

### 4. OPのEntity Configuration生成機能

**新規ファイル**: `src/federation/opEntityConfiguration.ts`

機能：
- OPのEntity ConfigurationをJWTとして生成
- Trust Anchorへのauthority_hintsを含む
- OpenID Provider metadataを含む
- RS256で署名

### 5. FederationControllerの拡張

**ファイル**: `src/controllers/federation.ts`

変更内容：
- Authleteの`federationConfiguration` APIが利用できない場合のフォールバック実装
- ローカルでEntity Configurationを生成
- `OP_ENTITY_ID`と`FEDERATION_TRUST_ANCHORS`の設定チェック

### 6. テストの追加

**新規ファイル**: `src/federation/opEntityConfiguration.test.ts`

テスト内容：
- Entity Configuration JWTの生成
- 必要なOP metadataの検証
- JWT署名の検証

### 7. ドキュメントの追加

**新規ファイル**: 
- `OP_FEDERATION_SETUP.md` - OP設定の詳細ガイド
- `FEDERATION_OP_SETUP_SUMMARY.md` - この変更サマリー

## セットアップ手順

### 現在の設定

```bash
# Trust Anchor
ENTITY_ID=https://toddler-del-benjamin-wholesale.trycloudflare.com

# Authorization Server (OP)
OP_ENTITY_ID=https://pete-moderator-looks-should.trycloudflare.com
FEDERATION_TRUST_ANCHORS=https://toddler-del-benjamin-wholesale.trycloudflare.com
```

### 必要な手順

1. **サーバーの再起動**（重要！）:
   ```bash
   # 既存のプロセスを停止してから
   npm start
   ```

2. **Entity Configurationの確認**:
   ```bash
   curl https://pete-moderator-looks-should.trycloudflare.com/.well-known/openid-federation
   ```
   
   期待される結果：JWTが返される
   ```
   eyJhbGciOiJSUzI1NiIsImtpZCI6Im9wLWtleS0xIiwidHlwIjoiZW50aXR5LXN0YXRlbWVudCtqd3QifQ...
   ```

3. **Trust AnchorへのOP登録**:
   - http://localhost:3010/admin にアクセス
   - Entity ID: `https://pete-moderator-looks-should.trycloudflare.com`
   - Entity Type: `openid_provider`
   - **Add Entity**をクリック

4. **登録の確認**:
   - Trust Anchor管理画面でOPが表示されることを確認
   - Entity TypeがOP（緑色のバッジ）であることを確認

## テスト実行

### 単体テスト

```bash
# OPのEntity Configuration生成テスト
npm test -- src/federation/opEntityConfiguration.test.ts

# すべてのテスト
npm test
```

### 統合テスト

```bash
# 1. すべてのサーバーを起動
cd trust-anchor && npm start &
npm start &
cd test-client-federation-valid && npm start &

# 2. cloudflaredトンネルを起動（別ターミナル）
cloudflared tunnel --url http://localhost:3010
cloudflared tunnel --url http://localhost:3001
cloudflared tunnel --url http://localhost:3006

# 3. OPのEntity Configurationを確認
curl https://pete-moderator-looks-should.trycloudflare.com/.well-known/openid-federation

# 4. Trust AnchorでOPを登録
# http://localhost:3010/admin にアクセス

# 5. RPから認証フローをテスト
# http://localhost:3006 にアクセス
```

## トラブルシューティング

### Entity Configuration unavailable

**症状**: 
```json
{"error":"server_error","error_description":"Entity configuration unavailable"}
```

**原因と解決方法**:

1. **サーバーが再起動されていない**
   ```bash
   # サーバーを再起動
   npm start
   ```

2. **OP_ENTITY_IDが設定されていない**
   ```bash
   # .envファイルを確認
   grep OP_ENTITY_ID .env
   
   # 設定されていない場合は追加
   echo "OP_ENTITY_ID=https://pete-moderator-looks-should.trycloudflare.com" >> .env
   ```

3. **FEDERATION_TRUST_ANCHORSが設定されていない**
   ```bash
   # .envファイルを確認
   grep FEDERATION_TRUST_ANCHORS .env
   
   # 設定されていない場合は追加
   echo "FEDERATION_TRUST_ANCHORS=https://toddler-del-benjamin-wholesale.trycloudflare.com" >> .env
   ```

### Trust Anchorに登録できない

**症状**: Trust Anchor管理画面でOPを追加しようとするとエラー

**原因と解決方法**:

1. **OPのEntity Configurationにアクセスできない**
   ```bash
   # cloudflaredトンネルが起動しているか確認
   curl https://pete-moderator-looks-should.trycloudflare.com/.well-known/openid-federation
   ```

2. **Entity IDのURLが間違っている**
   - cloudflaredで表示されたURLを正確に入力
   - 末尾のスラッシュは不要

## 次のステップ

1. ✅ OPのEntity Configuration生成機能を実装
2. ✅ 環境変数を設定
3. ✅ ドキュメントを更新
4. ⏳ サーバーを再起動
5. ⏳ Trust AnchorにOPを登録
6. ⏳ RPからの認証フローをテスト

## 参考資料

- [OP_FEDERATION_SETUP.md](./OP_FEDERATION_SETUP.md) - 詳細な設定ガイド
- [QUICKSTART.md](./QUICKSTART.md) - クイックスタート
- [FEDERATION_README.md](./FEDERATION_README.md) - Federation実装ガイド

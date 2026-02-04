# OP2セットアップガイド

このガイドでは、2つ目の認可サーバ（OP2）をセットアップして、マルチOP環境でのテストを可能にする手順を説明します。

## 概要

OP2は、RPクライアントが複数のOPから選択できる機能をテストするための2つ目の認可サーバです。OP1と同じ機能を持ちますが、異なるAuthlete Service IDとEntity IDを使用します。

## 前提条件

- OP1が正常に動作していること
- Trust Anchorが起動していること
- cloudflaredがインストールされていること
- Authleteで2つ目のサービスが作成されていること

## OP2の設定情報

### Authlete設定

- **Service ID**: 3125677441
- **Base URL**: https://jp.authlete.com
- **Port**: 3002
- **Entity ID**: https://op2.diddc.site

### 重要な注意事項

⚠️ **JWK Set設定が必須**: OP2のAuthlete Service（ID: 3125677441）には、JWK Set（JSON Web Key Set）の設定が必要です。設定されていない場合、JWT署名検証が失敗し、認証フローが完了しません。

## セットアップ手順

### 1. 環境変数ファイルの作成

`.env.op2`ファイルは既に作成されています：

```bash
# 内容確認
cat .env.op2
```

設定内容：
```bash
AUTHLETE_BASE_URL=https://jp.authlete.com
AUTHLETE_SERVICE_ID=3125677441
AUTHLETE_SERVICE_ACCESS_TOKEN=3nv1XyMB-ahEjdWqsxEdD3rHy2sfaJ_JT5nZ-qPFYSs
PORT=3002
NODE_ENV=development
SESSION_SECRET=development_session_secret_op2_change_in_production
HTTP_TIMEOUT=10000
HTTP_RETRY_ATTEMPTS=3

# OpenID Federation Configuration
FEDERATION_ENABLED=true
FEDERATION_TRUST_ANCHORS=https://ta.diddc.site

# Authorization Server (OP) Entity ID
OP_ENTITY_ID=https://op2.diddc.site
```

### 2. Authlete Service設定の確認

OP2を起動する前に、Authlete管理画面で以下を確認してください：

1. **Service ID 3125677441**にアクセス
2. **JWK Set**が設定されていることを確認
   - 設定されていない場合は、JWK Setを生成して設定
   - RS256アルゴリズムを使用
3. **Redirect URIs**が設定されていることを確認
4. **Grant Types**が適切に設定されていることを確認

### 3. Trust AnchorへのOP2登録

Trust Anchor管理画面でOP2を登録：

1. http://localhost:3010/admin にアクセス
2. **Add Entity**セクションで以下を入力：
   - **Entity ID**: `https://op2.diddc.site`
   - **Entity Type**: `openid_provider`を選択
3. **Add Entity**をクリック
4. ✅ OP2が登録されたことを確認

### 4. OP2サーバーの起動

OP2を起動するには、`.env.op2`ファイルを使用します：

```bash
# 方法1: 環境変数を直接指定
PORT=3002 \
AUTHLETE_SERVICE_ID=3125677441 \
AUTHLETE_SERVICE_ACCESS_TOKEN=3nv1XyMB-ahEjdWqsxEdD3rHy2sfaJ_JT5nZ-qPFYSs \
OP_ENTITY_ID=https://op2.diddc.site \
FEDERATION_TRUST_ANCHORS=https://ta.diddc.site \
npm start

# 方法2: .envファイルを一時的に切り替え
cp .env .env.op1.backup
cp .env.op2 .env
npm start
# 終了後: cp .env.op1.backup .env
```

### 5. Entity Configurationの確認

OP2のEntity Configurationエンドポイントが正しく動作することを確認：

```bash
curl https://op2.diddc.site/.well-known/openid-federation
```

正常な場合、JWTが返されます。

### 6. RPクライアントでのOP2選択

1. http://localhost:3006 にアクセス
2. **Select OP**セクションで`https://op2.diddc.site`を入力
3. **Select OP**をクリック
4. ✅ OP2が選択されたことを確認
5. **Start Login**をクリックして認証フローをテスト

## 複数OPの同時起動

OP1とOP2を同時に起動する場合：

### ターミナル構成

**ターミナル1: Trust Anchor**
```bash
cd trust-anchor && npm start
```

**ターミナル2: OP1**
```bash
npm start
```

**ターミナル3: OP2**
```bash
PORT=3002 \
AUTHLETE_SERVICE_ID=3125677441 \
AUTHLETE_SERVICE_ACCESS_TOKEN=3nv1XyMB-ahEjdWqsxEdD3rHy2sfaJ_JT5nZ-qPFYSs \
OP_ENTITY_ID=https://op2.diddc.site \
FEDERATION_TRUST_ANCHORS=https://ta.diddc.site \
npm start
```

**ターミナル4: RPクライアント**
```bash
cd test-client-federation-valid && npm start
```

### 起動確認

```bash
# Trust Anchor
curl http://localhost:3010/health

# OP1
curl http://localhost:3001/health

# OP2
curl http://localhost:3002/health

# RPクライアント
curl http://localhost:3006/health
```

## トラブルシューティング

### OP2が起動しない

**症状**: ポート3002が既に使用されている

**解決方法**:
```bash
# ポート3002を使用しているプロセスを確認
lsof -i :3002

# プロセスを終了
kill -9 <PID>
```

### JWK Set設定エラー

**症状**: 
```
Error: Authlete Service ID 3125677441 is missing JWK Set configuration
```

**原因**: Authlete ServiceにJWK Setが設定されていない

**解決方法**:
1. Authlete管理画面にアクセス
2. Service ID 3125677441を選択
3. **JWK Set**セクションでJWK Setを生成
4. RS256アルゴリズムを選択
5. 保存してOP2を再起動

### Trust Anchorに登録できない

**症状**: Trust Anchor管理画面でOP2を追加しようとするとエラー

**原因**: OP2のEntity Configurationにアクセスできない

**解決方法**:
1. OP2が起動していることを確認
2. Entity Configurationエンドポイントにアクセスできることを確認：
   ```bash
   curl https://op2.diddc.site/.well-known/openid-federation
   ```
3. Trust Anchorのログを確認

### RPからOP2への接続が失敗する

**症状**: OP2を選択して認証を開始するとエラー

**原因**:
- OP2がTrust Anchorに登録されていない
- OP2のJWK Set設定が不足している
- クライアント登録が失敗している

**解決方法**:
1. Trust Anchor管理画面でOP2が登録されていることを確認
2. Authlete管理画面でJWK Set設定を確認
3. RPのログを確認：
   ```bash
   cd test-client-federation-valid && npm start
   # ログを確認
   ```
4. OP2のログを確認

### クライアント登録が表示されない

**症状**: OP2で認証後、RPの画面に「Not registered」と表示される

**原因**: クライアント登録情報が正しく保存されていない

**解決方法**:
1. ブラウザのコンソールでエラーを確認
2. `.client-credentials.json`ファイルを確認：
   ```bash
   cat test-client-federation-valid/.client-credentials.json
   ```
3. 必要に応じてクライアント登録をクリア：
   - RPの画面で**Clear Client Registration**をクリック
   - 再度OP2を選択して認証フローを実行

## マルチOP機能のテスト

### テストシナリオ1: OP1とOP2の切り替え

1. OP1を選択して認証
2. ✅ 認証成功を確認
3. OP2を選択して認証
4. ✅ 認証成功を確認
5. 再度OP1を選択
6. ✅ 既存の登録情報が使用されることを確認

### テストシナリオ2: 複数OPの登録情報管理

1. OP1で認証（クライアント登録）
2. OP2で認証（クライアント登録）
3. RPの画面で両方のOPに「✅ Registered」が表示されることを確認
4. **Clear Client Registration**をクリック
5. ✅ 両方のOPの登録情報がクリアされることを確認

### テストシナリオ3: Trust Chain検証

1. Trust AnchorからOP2を削除
2. OP2を選択して認証を試行
3. ✅ Trust Chain検証エラーが表示されることを確認
4. Trust AnchorにOP2を再登録
5. ✅ 認証が成功することを確認

## 環境変数ファイルの管理

### ファイル一覧

- `.env` - OP1の設定（デフォルト）
- `.env.op2` - OP2の設定
- `.env.op2.example` - OP2の設定テンプレート（認証情報マスク済み）

### セキュリティ

⚠️ **重要**: `.env`と`.env.op2`は`.gitignore`に含まれており、Gitにコミットされません。

本番環境では：
- 環境変数を環境変数管理サービス（AWS Secrets Manager、Azure Key Vaultなど）で管理
- アクセストークンを定期的にローテーション
- 最小権限の原則に従ってアクセス制御

## 参考資料

- [QUICKSTART.md](./QUICKSTART.md) - クイックスタートガイド
- [OP_FEDERATION_SETUP.md](./OP_FEDERATION_SETUP.md) - OP1の設定ガイド
- [FEDERATION_README.md](./FEDERATION_README.md) - Federation実装ガイド
- [.kiro/specs/rp-multi-op-selection/](../.kiro/specs/rp-multi-op-selection/) - マルチOP選択機能の仕様書

## サポート

問題が発生した場合は、以下のログを確認してください：

- **OP2のログ**: OP2起動ターミナルの出力
- **Trust Anchorのログ**: Trust Anchor起動ターミナルの出力
- **RPのログ**: RPクライアント起動ターミナルの出力
- **ブラウザコンソール**: ブラウザの開発者ツールでJavaScriptエラーを確認

---

**最終更新**: 2026年2月4日  
**OP2 Entity ID**: https://op2.diddc.site  
**OP2 Port**: 3002  
**Authlete Service ID**: 3125677441

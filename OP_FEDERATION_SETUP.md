# 認可サーバ（OP）のOpenID Federation設定ガイド

このガイドでは、認可サーバ（OP）をOpenID Federationに参加させるための設定手順を説明します。

## 概要

OpenID Federationでは、RPだけでなくOPもTrust Anchorに登録する必要があります。これにより、RPはOPのトラストチェーンを検証できます。

## 前提条件

- 認可サーバがcloudflaredで公開されていること
- Trust Anchorが起動していること
- `.env`ファイルが正しく設定されていること

## 設定手順

### 1. 環境変数の確認

`.env`ファイルに以下の設定があることを確認：

```bash
# OpenID Federation Configuration
FEDERATION_ENABLED=true
FEDERATION_TRUST_ANCHORS=https://your-trust-anchor-url.trycloudflare.com

# Authorization Server (OP) Entity ID
OP_ENTITY_ID=https://your-op-url.trycloudflare.com
```

### 2. サーバーの再起動

設定を反映するために、認可サーバを再起動：

```bash
# 既存のプロセスを停止
# Ctrl+C または kill コマンド

# サーバーを再起動
npm start
```

### 3. Entity Configurationの確認

OPのEntity Configurationエンドポイントが正しく動作することを確認：

```bash
curl https://your-op-url.trycloudflare.com/.well-known/openid-federation
```

正常な場合、JWTが返されます：

```
eyJhbGciOiJSUzI1NiIsImtpZCI6Im9wLWtleS0xIiwidHlwIjoiZW50aXR5LXN0YXRlbWVudCtqd3QifQ...
```

エラーの場合：

```json
{"error":"server_error","error_description":"Entity configuration unavailable"}
```

### 4. Trust AnchorへのOP登録

Trust Anchor管理画面でOPを登録：

1. http://localhost:3010/admin にアクセス
2. **Add Entity**セクションで以下を入力：
   - **Entity ID**: `https://your-op-url.trycloudflare.com`
   - **Entity Type**: `openid_provider`を選択
3. **Add Entity**をクリック

### 5. 登録の確認

Trust Anchor管理画面で、OPが正しく登録されていることを確認：

- Entity Listに表示されること
- Entity TypeがOPであること（緑色のバッジ）
- Entity Statementが取得できること

### 6. Entity Statementの確認

Trust AnchorからOPのEntity Statementを取得：

```bash
curl https://your-trust-anchor-url.trycloudflare.com/.well-known/openid-federation/https%3A%2F%2Fyour-op-url.trycloudflare.com
```

## トラブルシューティング

### Entity Configuration unavailable

**原因**: 
- `OP_ENTITY_ID`が設定されていない
- `FEDERATION_TRUST_ANCHORS`が設定されていない
- サーバーが再起動されていない

**解決方法**:
1. `.env`ファイルを確認
2. サーバーを再起動
3. ログを確認

### Trust Anchorに登録できない

**原因**:
- OPのEntity Configurationエンドポイントにアクセスできない
- cloudflaredトンネルが起動していない

**解決方法**:
1. cloudflaredトンネルが起動していることを確認
2. OPのEntity Configurationエンドポイントにアクセスできることを確認
3. Trust Anchorのログを確認

### RPからOPへの接続が失敗する

**原因**:
- OPがTrust Anchorに登録されていない
- OPのEntity Configurationが無効

**解決方法**:
1. Trust Anchor管理画面でOPが登録されていることを確認
2. OPのEntity Configurationが正しく生成されていることを確認
3. RPのログを確認

## 動作確認

### 完全なフロー

1. **Trust Anchorの起動**:
   ```bash
   cd trust-anchor && npm start
   ```

2. **OPの起動**:
   ```bash
   npm start
   ```

3. **RPの起動**:
   ```bash
   cd test-client-federation-valid && npm start
   ```

4. **cloudflaredトンネルの起動**:
   ```bash
   # ターミナル1: Trust Anchor
   cloudflared tunnel --url http://localhost:3010
   
   # ターミナル2: OP
   cloudflared tunnel --url http://localhost:3001
   
   # ターミナル3: RP
   cloudflared tunnel --url http://localhost:3006
   ```

5. **Trust AnchorへのOP登録**:
   - http://localhost:3010/admin にアクセス
   - OPのEntity IDを登録（Entity Type: openid_provider）

6. **Trust AnchorへのRP登録**:
   - RPのEntity IDを登録（Entity Type: openid_relying_party）

7. **認証フローのテスト**:
   - http://localhost:3006 にアクセス
   - "Start Federation Login"をクリック
   - 認証フローが正常に完了することを確認

## 参考情報

- [QUICKSTART.md](./QUICKSTART.md) - クイックスタートガイド
- [FEDERATION_README.md](./FEDERATION_README.md) - Federation実装ガイド
- [update-federation-urls.sh](./update-federation-urls.sh) - URL更新スクリプト

## サポート

問題が発生した場合は、以下のログを確認してください：

- OPのログ: `npm start`の出力
- Trust Anchorのログ: `cd trust-anchor && npm start`の出力
- RPのログ: `cd test-client-federation-valid && npm start`の出力

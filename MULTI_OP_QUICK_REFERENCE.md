# マルチOP環境 - クイックリファレンス

複数のOPを同時に起動してテストするための簡易リファレンスです。

## サーバー起動コマンド

### 必須サーバー

```bash
# ターミナル1: Trust Anchor
cd trust-anchor && npm start

# ターミナル2: OP1
npm start

# ターミナル3: RPクライアント
cd test-client-federation-valid && npm start
```

### オプション: OP2

```bash
# ターミナル4: OP2
PORT=3002 \
AUTHLETE_SERVICE_ID=[OP2_SERVICE_ID] \
AUTHLETE_SERVICE_ACCESS_TOKEN=[OP2_ACCESS_TOKEN] \
OP_ENTITY_ID=https://op2.diddc.site \
FEDERATION_TRUST_ANCHORS=https://ta.diddc.site \
npm start
```

## アクセスURL

| サーバー | URL | 用途 |
|---------|-----|------|
| Trust Anchor | http://localhost:3010/admin | エンティティ管理 |
| OP1 | http://localhost:3001 | 認可サーバー1 |
| OP2 | http://localhost:3002 | 認可サーバー2 |
| RP (Valid) | http://localhost:3006 | テストクライアント |

## ヘルスチェック

```bash
curl http://localhost:3010/health  # Trust Anchor
curl http://localhost:3001/health  # OP1
curl http://localhost:3002/health  # OP2
curl http://localhost:3006/health  # RP
```

## Trust Anchorへの登録

### OP1

- Entity ID: `https://op.diddc.site`
- Entity Type: `openid_provider`

### OP2

- Entity ID: `https://op2.diddc.site`
- Entity Type: `openid_provider`

## RPでのOP選択

1. http://localhost:3006 にアクセス
2. **Select OP**セクションでEntity IDを入力:
   - OP1: `https://op.diddc.site`
   - OP2: `https://op2.diddc.site`
3. **Select OP**をクリック
4. **Start Login**をクリック

## よく使うコマンド

### すべてのサーバーを停止

```bash
# Ctrl+C を各ターミナルで実行
# または
pkill -f "node.*trust-anchor"
pkill -f "node.*dist/index.js"
pkill -f "node.*test-client"
```

### ポート使用状況の確認

```bash
lsof -i :3001  # OP1
lsof -i :3002  # OP2
lsof -i :3006  # RP
lsof -i :3010  # Trust Anchor
```

### クライアント登録のクリア

```bash
# RPの画面で「Clear Client Registration」をクリック
# または
rm test-client-federation-valid/.client-credentials.json
```

## トラブルシューティング

### OP2が起動しない

```bash
# ポート3002が使用中か確認
lsof -i :3002

# 使用中の場合は停止
kill -9 <PID>
```

### Trust Chain検証エラー

```bash
# Trust AnchorにOPが登録されているか確認
curl http://localhost:3010/admin

# OPのEntity Configurationを確認
curl https://op.diddc.site/.well-known/openid-federation
curl https://op2.diddc.site/.well-known/openid-federation
```

### クライアント登録が表示されない

```bash
# 登録情報ファイルを確認
cat test-client-federation-valid/.client-credentials.json

# ファイルが存在しない場合は再登録
# RPの画面で再度認証フローを実行
```

## 詳細ドキュメント

- [OP2_SETUP.md](./OP2_SETUP.md) - OP2の詳細セットアップ
- [QUICKSTART.md](./QUICKSTART.md) - 完全なセットアップガイド
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - トラブルシューティング

---

**最終更新**: 2026年2月4日

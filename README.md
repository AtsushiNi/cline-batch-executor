# Cline Batch Executor

Cline APIを使用して複数ファイルに対して一括でAI処理を実行するVSCode拡張機能です。

## 機能

- **バッチファイル処理**: ワークスペース内の複数ファイルを選択して一括処理
- **Cline AI連携**: Cline拡張機能と連携してAIによるコード変換を実行
- **進捗表示**: 処理中のファイル数、完了状況をリアルタイム表示
- **カスタムタスク**: 各ファイルに対して実行するタスクを自由に定義
- **キャンセル可能**: 処理中のバッチ処理をいつでもキャンセル可能

## 必要条件

- Visual Studio Code 1.60.0以上
- [Cline拡張機能 (saoudrizwan.claude-dev)](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) がインストールされていること

## インストール方法

1. Visual Studio Codeを開く
2. 拡張機能ビューを表示 (Ctrl+Shift+X)
3. "Cline Batch Executor"を検索
4. インストールをクリック

または、VSIXファイルから手動インストール:
```bash
code --install-extension cline-batch-executor-0.1.0.vsix
```

## 使用方法

1. **コマンドパレットを開く** (Ctrl+Shift+P)
2. **"Cline Batch Executor: Start Batch Processing"** を選択
3. **処理するファイルを選択** (複数選択可能)
4. **タスク説明を入力** (例: "すべてのTypeScriptファイルをリファクタリング")
5. **処理の実行** - 進捗が表示され、各ファイルが順次処理されます

## コマンド

- `cline-batch-executor.startBatchProcessing`: バッチ処理を開始

## 開発者向け

### プロジェクトのセットアップ

```bash
git clone <repository-url>
cd cline-batch-executor
npm install
```

### ビルド

```bash
npm run compile
```

### 開発モードでの実行

1. F5キーを押してデバッグを開始
2. 新しいVSCodeウィンドウが開く
3. 拡張機能をテスト

### パッケージ化

```bash
npm run package
```

## ライセンス

MIT License

## フィードバックと貢献

バグ報告や機能リクエストはGitHubのIssueトラッカーまでお願いします。

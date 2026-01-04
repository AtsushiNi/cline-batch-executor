import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'jsonc-parser';
import { HookConfig, BatchProcessingStats } from './interfaces';

// ホームディレクトリの.cline-batch-executorディレクトリのパスを取得する関数
function getHomeConfigDir(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.cline-batch-executor');
}

// ホームディレクトリの.cline-batch-executorディレクトリを確実に作成する関数
export async function ensureHomeConfigDir(): Promise<string> {
    const configDir = getHomeConfigDir();
    const configDirUri = vscode.Uri.file(configDir);
    
    try {
        await vscode.workspace.fs.stat(configDirUri);
    } catch {
        // ディレクトリが存在しない場合は作成
        await vscode.workspace.fs.createDirectory(configDirUri);
    }
    
    return configDir;
}

// フック設定を読み込む関数
export async function loadHookConfigs(): Promise<HookConfig[]> {
    try {
        // ホームディレクトリの設定ファイルを探す
        const configDir = getHomeConfigDir();
        const configFilePath = path.join(configDir, 'cline-hooks.jsonc');
        const configFileUri = vscode.Uri.file(configFilePath);
        
        try {
            const fileContent = await vscode.workspace.fs.readFile(configFileUri);
            const configText = new TextDecoder('utf-8').decode(fileContent);
            const config = parse(configText);
            
            if (config && Array.isArray(config.hooks)) {
                return config.hooks;
            }
            return [];
        } catch (error) {
            // ファイルが存在しない場合はフック処理なし
            console.log('フック設定ファイルが見つかりません。フック処理は実行されません。');
            return [];
        }
    } catch (error) {
        console.error(`フック設定の読み込みに失敗しました: ${error}`);
        return [];
    }
}

// フックの条件を評価する関数
function evaluateCondition(condition: string, stats: BatchProcessingStats): boolean {
    if (!condition || condition.trim() === '') {
        return true; // 条件がない場合は常に実行
    }

    try {
        // シンプルな条件評価
        const conditions = condition.split('&&').map(c => c.trim());

        for (const cond of conditions) {
            if (cond.includes('>=')) {
                const [varName, value] = cond.split('>=').map(s => s.trim());
                const varValue = getVariableValue(varName, stats);
                if (varValue < parseInt(value)) return false;
            } else if (cond.includes('<=')) {
                const [varName, value] = cond.split('<=').map(s => s.trim());
                const varValue = getVariableValue(varName, stats);
                if (varValue > parseInt(value)) return false;
            } else if (cond.includes('>')) {
                const [varName, value] = cond.split('>').map(s => s.trim());
                const varValue = getVariableValue(varName, stats);
                if (varValue <= parseInt(value)) return false;
            } else if (cond.includes('<')) {
                const [varName, value] = cond.split('<').map(s => s.trim());
                const varValue = getVariableValue(varName, stats);
                if (varValue >= parseInt(value)) return false;
            } else if (cond.includes('==')) {
                const [varName, value] = cond.split('==').map(s => s.trim());
                const varValue = getVariableValue(varName, stats);
                if (varValue !== parseInt(value)) return false;
            }
        }
        
        return true;
    } catch (error) {
        console.error(`条件の評価に失敗しました: ${condition}, error: ${error}`);
        return false;
    }
}

// 統計情報から変数値を取得する関数
function getVariableValue(varName: string, stats: BatchProcessingStats): number {
    switch (varName) {
        case 'totalFiles':
            return stats.totalFiles;
        case 'processedFiles':
            return stats.processedFiles;
        case 'successfulFiles':
            return stats.successfulFiles;
        case 'failedFiles':
            return stats.failedFiles;
        case 'modifiedFiles':
            return stats.modifiedFiles;
        case 'errorCount':
            return stats.errorCount;
        default:
            return 0;
    }
}

// フック設定ファイルを取得または作成する
export async function getOrCreateHookConfigFile(): Promise<vscode.Uri> {
    const configDir = getHomeConfigDir();
    const configFilePath = path.join(configDir, 'cline-hooks.jsonc');
    const configFileUri = vscode.Uri.file(configFilePath);
    
    // ディレクトリが存在するか確認
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(configDir));
    } catch {
        // ディレクトリが存在しない場合は作成
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(configDir));
    }
    
    // ファイルが存在するか確認
    try {
        await vscode.workspace.fs.stat(configFileUri);
        return configFileUri;
    } catch {
        // ファイルが存在しない場合はデフォルト設定で作成
        const defaultConfig = `{
  // Cline Batch Executor フック設定ファイル
  // このファイルはJSONC (JSON with Comments) 形式で、コメントを記載できます
  // 
  // hooks: フックの配列。各フックは特定の条件で実行される処理を定義します
  "hooks": [
    {
      // フックの名前（任意）
      "name": "git-commit-after-10-files",
      
      // 実行条件（JavaScript風の式）
      // 利用可能な変数:
      //   - totalFiles: 総ファイル数
      //   - processedFiles: 処理済みファイル数
      //   - successfulFiles: 成功したファイル数
      //   - failedFiles: 失敗したファイル数
      //   - modifiedFiles: 変更されたファイル数
      //   - errorCount: エラー数
      // 比較演算子: >, <, >=, <=, ==
      // 論理演算子: && (AND)
      "condition": "modifiedFiles >= 10 && errorCount == 0",
      
      // 実行するコマンド（シェルコマンド）
      // vscode: プレフィックスでVS Codeコマンドも実行可能（例: "vscode:workbench.action.reloadWindow"）
      "command": "git add . && git commit -m \\"Auto-commit by Cline Batch Executor\\" && git push",
      
      // 実行タイミング:
      //   - 'beforeBatch': バッチ処理開始前
      //   - 'afterBatch': バッチ処理完了後
      //   - 'beforeFile': 各ファイル処理前
      //   - 'afterFile': 各ファイル処理後
      //   - 'onError': エラー発生時
      "runAt": "afterBatch"
    }
    // 新しいフックを追加する場合は、この配列にオブジェクトを追加してください
    // 
    // 使用例:
    // 
    // 1. エラー発生時にログを記録:
    // {
    //   "name": "log-errors",
    //   "condition": "errorCount > 0",
    //   "command": "echo \\"Batch processing completed with \\$errorCount errors\\" >> ~/.cline-batch-executor/error.log",
    //   "runAt": "afterBatch"
    // }
    // 
    // 2. バッチ処理開始前に環境をチェック:
    // {
    //   "name": "check-environment",
    //   "condition": "",
    //   "command": "echo \\"Starting batch processing at \\$(date)\\" && git status",
    //   "runAt": "beforeBatch"
    // }
    // 
    // 3. 進捗通知（50%ごと）:
    // {
    //   "name": "progress-notification",
    //   "condition": "processedFiles % Math.floor(totalFiles / 2) == 0 && processedFiles > 0",
    //   "command": "echo \\"Progress: \\$processedFiles/\\$totalFiles files processed\\"",
    //   "runAt": "afterFile"
    // }
    // 
    // 4. VS Codeコマンドの実行（エラー時にウィンドウをリロード）:
    // {
    //   "name": "reload-on-multiple-errors",
    //   "condition": "errorCount >= 5",
    //   "command": "vscode:workbench.action.reloadWindow",
    //   "runAt": "onError"
    // }
    // 
    // 5. 自動バックアップ（10ファイル処理ごと）:
    // {
    //   "name": "auto-backup",
    //   "condition": "processedFiles % 10 == 0 && processedFiles > 0",
    //   "command": "git add . && git commit -m \\"Auto-backup after \\$processedFiles files\\"",
    //   "runAt": "afterFile"
    // }
    // 
    // 6. クロスプラットフォームな通知:
    // {
    //   "name": "notify-on-completion-cross-platform",
    //   "condition": "processedFiles === totalFiles",
    //   "command": "if [[ \\"\\$OSTYPE\\" == \\"darwin\\"* ]]; then osascript -e 'display notification \\"完了\\" with title \\"Cline\\"'; elif command -v notify-send >/dev/null 2>&1; then notify-send \\"Cline\\" \\"バッチ処理完了\\"; else echo \\"Notification not supported\\"; fi",
    //   "runAt": "afterBatch"
    // }
  ]
}`;

        await vscode.workspace.fs.writeFile(
            configFileUri,
            new TextEncoder().encode(defaultConfig)
        );
        
        return configFileUri;
    }
}

// フックを実行する関数
export async function executeHooks(hooks: HookConfig[], runAt: HookConfig['runAt'], stats: BatchProcessingStats, fileUri?: vscode.Uri): Promise<void> {
    const filteredHooks = hooks.filter(hook => hook.runAt === runAt);
    
    for (const hook of filteredHooks) {
        // 条件を評価
        if (hook.condition && !evaluateCondition(hook.condition, stats)) {
            console.log(`フック "${hook.name}" の条件が満たされませんでした: ${hook.condition}`);
            continue;
        }

        try {
            console.log(`フックを実行中: ${hook.name}`);
            
            // コマンドを実行
            if (hook.command.startsWith('vscode:')) {
                // VS Codeコマンド
                const command = hook.command.substring(7);
                await vscode.commands.executeCommand(command);
            } else {
                // シェルコマンド
                const terminal = vscode.window.createTerminal(`Cline Hook: ${hook.name}`);
                terminal.show(false);
                terminal.sendText(hook.command);
                
                // コマンドが完了するのを少し待つ
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log(`フックが正常に実行されました: ${hook.name}`);
        } catch (error) {
            console.error(`フックの実行に失敗しました: ${hook.name}, error: ${error}`);
        }
    }
}

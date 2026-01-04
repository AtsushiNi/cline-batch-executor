import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { BatchProcessingStats, HookConfig } from './interfaces';
import { loadHookConfigs } from './hookManager';
import { createSampleTaskFile } from './taskManager';

interface DashboardResult {
    stats: BatchProcessingStats;
    durationSeconds: string;
    completedAt: number;
}

let activePanel: vscode.WebviewPanel | undefined;
let latestResult: DashboardResult | undefined;

// WebViewダッシュボードを開く関数
export async function openDashboard(context: vscode.ExtensionContext): Promise<void> {
    // WebViewパネルを作成
    const panel = vscode.window.createWebviewPanel(
        'clineDashboard',
        'Cline Batch Executor Dashboard',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media')
            ]
        }
    );

    activePanel = panel;
    panel.onDidDispose(() => {
        activePanel = undefined;
    });

    // WebViewのHTMLコンテンツを設定
    panel.webview.html = getDashboardHtml(panel.webview, context.extensionUri);

    // メッセージ受信の処理
    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'startBatchProcessing':
                    vscode.commands.executeCommand('cline-batch-executor.startBatchProcessing');
                    break;
                case 'loadHookConfigs':
                    const hooks = await loadHookConfigs();
                    panel.webview.postMessage({ command: 'hookConfigsLoaded', hooks });
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(message.text);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(message.text);
                    break;
                case 'openHookConfig':
                    await openHookConfig();
                    break;
                case 'createTaskFile':
                    await createTaskFile();
                    break;
                case 'requestLatestStats':
                    if (latestResult) {
                        panel.webview.postMessage({
                            command: 'batchProcessingCompleted',
                            ...latestResult
                        });
                    }
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    // 直近の結果があればロード時に通知
    if (latestResult) {
        panel.webview.postMessage({
            command: 'batchProcessingCompleted',
            ...latestResult
        });
    }
}

// バッチ/エラー処理完了時にダッシュボードへ結果を通知する関数
export function notifyDashboardResult(
    stats: BatchProcessingStats
): void {
    const durationSeconds = (((stats.endTime ?? Date.now()) - stats.startTime) / 1000).toFixed(2);
    latestResult = {
        stats,
        durationSeconds,
        completedAt: stats.endTime ?? Date.now()
    };

    if (activePanel) {
        activePanel.webview.postMessage({
            command: 'batchProcessingCompleted',
            ...latestResult
        });
    }
}

// フック設定ファイルを開く関数
async function openHookConfig(): Promise<void> {
    try {
        // hookManager.ts の関数を使用してフック設定ファイルを確実に作成
        const { getOrCreateHookConfigFile } = await import('./hookManager');
        const configFileUri = await getOrCreateHookConfigFile();
        
        // ファイルを開く
        const document = await vscode.workspace.openTextDocument(configFileUri);
        await vscode.window.showTextDocument(document);
        
    } catch (error) {
        console.error(`フック設定ファイルのオープンに失敗しました: ${error}`);
        vscode.window.showErrorMessage(`フック設定ファイルのオープンに失敗しました: ${error}`);
    }
}

// 新しいタスクファイルを作成する関数
async function createTaskFile(): Promise<void> {
    try {
        // hookManager.ts の関数を使用して設定ディレクトリを確実に作成
        const { ensureHomeConfigDir } = await import('./hookManager');
        const configDir = await ensureHomeConfigDir();
        const defaultFileName = `task-${new Date().toISOString().slice(0, 10)}.jsonc`;
        const defaultFilePath = path.join(configDir, defaultFileName);
        
        // ファイル保存ダイアログを表示（デフォルトはホームディレクトリの.cline-batch-executor）
        const selectedFileUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultFilePath),
            filters: {
                'JSONCファイル': ['jsonc', 'json']
            },
            title: 'タスクファイルを作成',
            saveLabel: '作成'
        });

        if (!selectedFileUri) {
            return; // ユーザーがキャンセルした場合
        }

        // サンプルタスクファイルを作成（単一ファイル）
        await createSampleTaskFile(selectedFileUri);
        
    } catch (error) {
        console.error(`サンプルタスクファイルの作成に失敗しました: ${error}`);
        vscode.window.showErrorMessage(`サンプルタスクファイルの作成に失敗しました: ${error}`);
    }
}

// ダッシュボードのHTMLコンテンツを生成する関数
export function getDashboardHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cline Batch Executor Dashboard</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            margin: 0;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); }
        .header h1 { margin: 0; color: var(--vscode-foreground); }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); }
        .tab { padding: 10px 20px; background: none; border: none; color: var(--vscode-foreground); cursor: pointer; border-bottom: 2px solid transparent; }
        .tab.active { border-bottom-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .card { background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 20px; margin-bottom: 20px; }
        .card h2 { margin-top: 0; margin-bottom: 15px; }
        .button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-right: 10px; margin-bottom: 10px; }
        .button:hover { background-color: var(--vscode-button-hoverBackground); }
        .button-group { margin-top: 20px; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 10px; }
        .stat { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-input-background); }
        .stat-label { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
        .stat-value { font-size: 20px; font-weight: 600; }
        .meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--vscode-descriptionForeground); }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Cline Batch Executor Dashboard</h1>
        </div>
        
        <div class="tabs">
            <button class="tab active" onclick="switchTab('dashboard')">ダッシュボード</button>
            <button class="tab" onclick="switchTab('settings')">設定管理</button>
        </div>
        
        <div id="dashboard-tab" class="tab-content active">
            <div class="card">
                <h2>処理の開始</h2>
                <div class="button-group">
                    <p>複数のファイルやフォルダを選択し、1ファイルずつClineによるタスクを実行します</p>
                    <button class="button" onclick="startBatchProcessing()">バッチ処理を開始</button>
                </div>
            </div>
            
            <div class="card">
                <h2>統計情報</h2>
                <p id="no-results">統計情報は処理実行後に表示されます。</p>
                <div id="results" class="hidden">
                    <div class="meta">
                        <span id="result-time">-</span>
                        <span id="result-duration">-</span>
                    </div>
                    <div class="stat-grid">
                        <div class="stat">
                            <div class="stat-label">総ファイル</div>
                            <div class="stat-value" id="total-files">0</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">処理済み</div>
                            <div class="stat-value" id="processed-files">0</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">成功</div>
                            <div class="stat-value" id="successful-files">0</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">失敗</div>
                            <div class="stat-value" id="failed-files">0</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">変更ファイル</div>
                            <div class="stat-value" id="modified-files">0</div>
                        </div>
                        <div class="stat">
                            <div class="stat-label">エラー数</div>
                            <div class="stat-value" id="error-count">0</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="settings-tab" class="tab-content">
            <div class="card">
                <h2>フック設定</h2>
                <p>各ファイルへのClineタスク実行前後に任意の処理を実行することができます</p>
                <div class="button-group">
                    <button class="button" onclick="openHookConfig()">フック設定ファイルを開く</button>
                </div>
            </div>
            
            <div class="card">
                <h2>タスクファイル管理</h2>
                <p>タスクファイルを新しく作成できます。</p>
                <div class="button-group">
                    <button class="button" onclick="createTaskFile()">タスクファイルを作成</button>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let latestResult = null;

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'batchProcessingCompleted') {
                latestResult = message;
                renderResults(message);
            }
        });
        vscode.postMessage({ command: 'requestLatestStats' });
        
        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            const tabButton = Array.from(document.querySelectorAll('.tab')).find(tab => 
                tab.getAttribute('onclick').includes(tabName)
            );
            if (tabButton) tabButton.classList.add('active');
            
            const tabContent = document.getElementById(tabName + '-tab');
            if (tabContent) tabContent.classList.add('active');
        }
        
        function startBatchProcessing() {
            vscode.postMessage({ command: 'startBatchProcessing' });
        }
        
        function openHookConfig() {
            vscode.postMessage({ command: 'openHookConfig' });
        }
        
        function createTaskFile() {
            vscode.postMessage({ command: 'createTaskFile' });
        }

        function renderResults(result) {
            if (!result || !result.stats) return;
            
            document.getElementById('no-results')?.classList.add('hidden');
            document.getElementById('results')?.classList.remove('hidden');

            const { stats, durationSeconds, completedAt } = result;
            document.getElementById('result-time').textContent = '完了: ' + formatDate(completedAt);
            document.getElementById('result-duration').textContent = '処理時間: ' + durationSeconds + '秒';

            document.getElementById('total-files').textContent = stats.totalFiles ?? 0;
            document.getElementById('processed-files').textContent = stats.processedFiles ?? 0;
            document.getElementById('successful-files').textContent = stats.successfulFiles ?? 0;
            document.getElementById('failed-files').textContent = stats.failedFiles ?? 0;
            document.getElementById('modified-files').textContent = stats.modifiedFiles ?? 0;
            document.getElementById('error-count').textContent = stats.errorCount ?? 0;
        }

        function formatDate(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleString();
        }
    </script>
</body>
</html>`;
}

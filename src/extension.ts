import * as vscode from 'vscode';
import { startBatchProcessing } from './batchProcessor';
import { openDashboard } from './dashboard';

// VS Code拡張機能のアクティベート関数
export function activate(context: vscode.ExtensionContext) {
    console.log('Cline Batch Executor extension is now active!');

    // コマンドを登録
    // バッチ処理を開始するコマンドをVS Codeに登録
    const startBatchProcessingDisposable = vscode.commands.registerCommand('cline-batch-executor.startBatchProcessing', async () => {
        try {
            await startBatchProcessing();
        } catch (error) {
            vscode.window.showErrorMessage(`Batch processing failed: ${error}`);
        }
    });

    // WebViewダッシュボードを開くコマンドを登録
    const openDashboardDisposable = vscode.commands.registerCommand('cline-batch-executor.openDashboard', async () => {
        try {
            await openDashboard(context);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open dashboard: ${error}`);
        }
    });

    context.subscriptions.push(
        startBatchProcessingDisposable,
        openDashboardDisposable
    );
}

// VS Code拡張機能のデアクティベート関数
export function deactivate() {
    // 拡張機能が無効化されたときにクリーンアップする処理があればここに記述
}

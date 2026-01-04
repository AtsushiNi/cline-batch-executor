import * as vscode from 'vscode';
import { ClineAPI } from './interfaces';

// Clineを使用して単一ファイルを処理する関数
export async function processFileWithCline(cline: ClineAPI, fileUri: vscode.Uri, taskDescription: string): Promise<void> {
    const filePath = vscode.workspace.asRelativePath(fileUri, false) || fileUri.fsPath;

    // Cline用のプロンプトを作成
    // ファイルの内容をプロンプトに埋め込む代わりに、ファイルパスを渡す
    const prompt = `ファイル: ${filePath}\n\nタスク: ${taskDescription}\n\n指示: 指定されたタスクをこのファイルに対して実行してください。`;

    // Clineで新しいタスクを開始
    await cline.startNewTask(prompt);
    
    // Clineが処理するのを少し待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // プライマリボタンを押して変更を適用する（シミュレーション）
    await cline.pressPrimaryButton();
    
    // getTaskStatusを使用してタスクの完了を待機
    const maxWaitTime = 10 * 60 * 1000; // 最大10分
    const checkInterval = 5000; // 5秒ごとにチェック
    let elapsedTime = 0;
    
    while (elapsedTime < maxWaitTime) {
        const status = await cline.getTaskStatus();
        
        if (status === "completed" || status === "cancelled" || status === "none") {
            console.log(`Task completed with status: ${status}`);
            break;
        }
        
        if (status === "active") {
            console.log(`Task still active, waiting... (${elapsedTime / 1000}s)`);
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        elapsedTime += checkInterval;
    }
    
    if (elapsedTime >= maxWaitTime) {
        console.warn("Task timeout reached, proceeding to next file");
    }
}

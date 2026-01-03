import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Cline API インターフェース
// Cline拡張機能との通信に使用するAPIの型定義
interface ClineAPI {
    startNewTask(message: string, images?: string[]): Promise<void>;
    sendMessage(message: string): Promise<void>;
    pressPrimaryButton(): Promise<void>;
    pressSecondaryButton(): Promise<void>;
    getTaskStatus(): Promise<"none" | "active" | "completed" | "cancelled">;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Cline Batch Executor extension is now active!');

    // コマンドを登録
    // バッチ処理を開始するコマンドをVS Codeに登録
    const disposable = vscode.commands.registerCommand('cline-batch-executor.startBatchProcessing', async () => {
        try {
            await startBatchProcessing();
        } catch (error) {
            vscode.window.showErrorMessage(`Batch processing failed: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // 拡張機能が無効化されたときにクリーンアップする処理があればここに記述
}

async function startBatchProcessing(): Promise<void> {
    // ステップ1: Cline拡張機能を取得
    // VS Codeの拡張機能APIを使用してCline拡張機能を取得
    const clineExtension = vscode.extensions.getExtension<ClineAPI>("saoudrizwan.claude-dev");
    
    if (!clineExtension) {
        throw new Error("Cline extension (saoudrizwan.claude-dev) is not installed. Please install it first.");
    }

    if (!clineExtension.isActive) {
        await clineExtension.activate();
    }

    const cline = clineExtension.exports;
    
    if (!cline) {
        throw new Error("Cline API is not available");
    }

    // ステップ2: バッチ処理するファイルを選択
    // ユーザーに処理対象のファイルとフォルダを選択させる
    const files = await selectFilesAndFolders();
    if (files.length === 0) {
        vscode.window.showInformationMessage('No files selected for batch processing.');
        return;
    }

    // ステップ3: ユーザーからタスクの説明を取得
    // Clineに実行させるタスクの内容をユーザーに入力させる
    const taskDescription = await vscode.window.showInputBox({
        placeHolder: 'Enter the task you want Cline to perform on each file (e.g., "Refactor this code", "Add comments", "Fix linting issues")',
        prompt: 'Task Description',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Please enter a task description';
            }
            return null;
        }
    });

    if (!taskDescription) {
        return; // ユーザーがキャンセルした場合
    }

    // ステップ4: 進捗状況を表示
    // VS Codeのプログレス表示機能を使用して処理状況を表示
    const progressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: "Cline Batch Processing",
        cancellable: true
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
        token.onCancellationRequested(() => {
            vscode.window.showInformationMessage('Batch processing cancelled.');
        });

        const totalFiles = files.length;
        
        for (let i = 0; i < files.length; i++) {
            if (token.isCancellationRequested) {
                break;
            }

            const file = files[i];
            const relativePath = vscode.workspace.asRelativePath(file);
            
            progress.report({
                message: `Processing file ${i + 1} of ${totalFiles}: ${relativePath}`,
                increment: (100 / totalFiles)
            });

            try {
                await processFileWithCline(cline, file, taskDescription);
                vscode.window.showInformationMessage(`Successfully processed: ${relativePath}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to process ${relativePath}: ${error}`);
            }
        }

        progress.report({ message: 'Batch processing completed!' });
    });
}

async function selectFilesAndFolders(): Promise<vscode.Uri[]> {
    // ファイルとフォルダ選択ダイアログを表示してユーザーに選択させる
    const options: vscode.OpenDialogOptions = {
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: true,
        openLabel: 'Select Files and/or Folders for Batch Processing',
        filters: {
            'All files': ['*']
        }
    };

    const selectedUris = await vscode.window.showOpenDialog(options);
    if (!selectedUris || selectedUris.length === 0) {
        return [];
    }

    // 選択されたURI（ファイルとフォルダ）を処理してファイルリストを作成
    const allFiles: vscode.Uri[] = [];
    
    for (const uri of selectedUris) {
        const files = await getFilesFromUri(uri);
        allFiles.push(...files);
    }

    return allFiles;
}

async function getFilesFromUri(uri: vscode.Uri): Promise<vscode.Uri[]> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        
        if (stat.type === vscode.FileType.File) {
            // URIがファイルの場合はそのファイルを返す
            return [uri];
        } else if (stat.type === vscode.FileType.Directory) {
            // URIがフォルダの場合はフォルダ内のすべてのファイルを再帰的に取得
            return await getAllFilesInDirectory(uri);
        } else {
            // シンボリックリンクなどの場合はスキップ
            console.warn(`Skipping unsupported file type: ${uri.fsPath}`);
            return [];
        }
    } catch (error) {
        console.error(`Error accessing ${uri.fsPath}: ${error}`);
        return [];
    }
}

async function getAllFilesInDirectory(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
    const allFiles: vscode.Uri[] = [];
    
    try {
        const entries = await vscode.workspace.fs.readDirectory(directoryUri);
        
        for (const [name, type] of entries) {
            // 隠しファイル（.で始まるファイル）をスキップ
            if (name.startsWith('.')) {
                continue;
            }
            
            const entryUri = vscode.Uri.joinPath(directoryUri, name);
            
            if (type === vscode.FileType.File) {
                allFiles.push(entryUri);
            } else if (type === vscode.FileType.Directory) {
                // サブディレクトリを再帰的に処理
                const subDirFiles = await getAllFilesInDirectory(entryUri);
                allFiles.push(...subDirFiles);
            }
            // シンボリックリンクなどはスキップ
        }
    } catch (error) {
        console.error(`Error reading directory ${directoryUri.fsPath}: ${error}`);
    }
    
    return allFiles;
}

async function processFileWithCline(cline: ClineAPI, fileUri: vscode.Uri, taskDescription: string): Promise<void> {
    const filePath = fileUri.fsPath;

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

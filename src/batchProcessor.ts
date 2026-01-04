import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { ClineAPI, HookConfig, BatchProcessingStats, ClineMessage } from './interfaces';
import { executeHooks, loadHookConfigs, ensureHomeConfigDir } from './hookManager';
import { getTaskDescription } from './taskManager';
import { processFileWithCline } from './clineIntegration';
import { notifyDashboardResult } from './dashboard';

// ファイルとフォルダを選択する関数
export async function selectFilesAndFolders(): Promise<vscode.Uri[]> {
    // ワークスペースフォルダを取得
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('ワークスペースが開かれていません。まずプロジェクトを開いてください。');
        return [];
    }

    // メインのワークスペースフォルダを使用（複数ある場合は最初のもの）
    const workspaceFolder = workspaceFolders[0];
    
    // ファイルとフォルダ選択ダイアログを表示してユーザーに選択させる
    // ワークスペース内でのみ選択可能にする
    const options: vscode.OpenDialogOptions = {
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: true,
        openLabel: 'バッチ処理対象のファイル/フォルダを選択',
        defaultUri: workspaceFolder.uri,
        filters: {
            'All files': ['*']
        }
    };

    const selectedUris = await vscode.window.showOpenDialog(options);
    if (!selectedUris || selectedUris.length === 0) {
        return [];
    }

    // 選択されたURIがワークスペース内にあるか確認
    const workspacePath = workspaceFolder.uri.fsPath;
    const validUris: vscode.Uri[] = [];
    
    for (const uri of selectedUris) {
        if (uri.fsPath.startsWith(workspacePath)) {
            validUris.push(uri);
        } else {
            vscode.window.showWarningMessage(
                `ファイル "${vscode.workspace.asRelativePath(uri) || uri.fsPath}" はワークスペース外です。スキップします。`
            );
        }
    }

    if (validUris.length === 0) {
        vscode.window.showInformationMessage('ワークスペース内のファイルが選択されませんでした。');
        return [];
    }

    // 選択されたURI（ファイルとフォルダ）を処理してファイルリストを作成
    const allFiles: vscode.Uri[] = [];
    
    for (const uri of validUris) {
        const files = await getFilesFromUri(uri);
        allFiles.push(...files);
    }

    return allFiles;
}

// URIからファイルリストを取得する関数
export async function getFilesFromUri(uri: vscode.Uri): Promise<vscode.Uri[]> {
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
            const relativePath = vscode.workspace.asRelativePath(uri, false) || uri.fsPath;
            console.warn(`Skipping unsupported file type: ${relativePath}`);
            return [];
        }
    } catch (error) {
        const relativePath = vscode.workspace.asRelativePath(uri, false) || uri.fsPath;
        console.error(`Error accessing ${relativePath}: ${error}`);
        return [];
    }
}

// ディレクトリ内のすべてのファイルを再帰的に取得する関数
export async function getAllFilesInDirectory(directoryUri: vscode.Uri): Promise<vscode.Uri[]> {
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
        const relativePath = vscode.workspace.asRelativePath(directoryUri, false) || directoryUri.fsPath;
        console.error(`Error reading directory ${relativePath}: ${error}`);
    }
    
    return allFiles;
}

function getLogDirectoryPath(): string {
    return path.join(os.homedir(), '.cline-batch-executor', 'logs');
}

async function ensureLogDirectory(): Promise<vscode.Uri> {
    // ベースの設定ディレクトリを確実に作成
    await ensureHomeConfigDir();

    const logsDir = getLogDirectoryPath();
    const logsDirUri = vscode.Uri.file(logsDir);

    try {
        await vscode.workspace.fs.stat(logsDirUri);
    } catch {
        await vscode.workspace.fs.createDirectory(logsDirUri);
    }

    return logsDirUri;
}

function formatClineMessage(message: ClineMessage, index: number): string {
    const timestamp = message.ts ? new Date(message.ts).toISOString() : new Date().toISOString();
    const contentParts: string[] = [];
    if (message.say) {
        contentParts.push(message.say);
    }
    if (message.ask) {
        contentParts.push(message.ask);
    }
    if (message.text) {
        contentParts.push(message.text);
    }
    const content = contentParts.length > 0 ? contentParts.join('\n  ') : '';
    const reasoning = message.reasoning ? `\n  reasoning: ${message.reasoning}` : '';
    const files = message.files && message.files.length > 0 ? `\n  files: ${message.files.join(', ')}` : '';
    const contentBlock = content ? ` ${content}` : '';
    return `${index + 1}. [${timestamp}] (${message.type})${contentBlock}${reasoning}${files}`;
}

function formatMessagesSection(messages: ClineMessage[]): string {
    return messages.length > 0
        ? messages.map((message, index) => formatClineMessage(message, index)).join('\n\n')
        : 'No messages from Cline.';
}

function formatHookRunSection(hookLogs: string[]): string {
    return hookLogs.length > 0
        ? hookLogs.join('\n')
        : 'No hooks were executed.';
}

function execFileAsync(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { cwd }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.toString());
        });
    });
}

async function isGitRepository(cwd: string): Promise<boolean> {
    try {
        const output = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], cwd);
        return output.trim() === 'true';
    } catch {
        return false;
    }
}

async function getGitModifiedCount(cwd: string): Promise<number | null> {
    try {
        const output = await execFileAsync('git', ['status', '--porcelain'], cwd);
        const lines = output.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        return lines.length;
    } catch (error) {
        console.warn(`Failed to read git status: ${error}`);
        return null;
    }
}

async function createBatchLogFile(
    hooks: HookConfig[],
    stats: BatchProcessingStats,
    taskDescription: string
): Promise<string | null> {
    try {
        const logsDirUri = await ensureLogDirectory();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFilePath = path.join(logsDirUri.fsPath, `batch-${timestamp}.log`);
        const durationSeconds = stats.endTime
            ? ((stats.endTime - stats.startTime) / 1000).toFixed(2)
            : 'N/A';

        const hookConfigSection = hooks.length > 0
            ? hooks.map(hook =>
                `- ${hook.name || '(no name)'} [${hook.runAt}] condition: ${hook.condition || 'なし'} command: ${hook.command}`
            ).join('\n')
            : 'No hook configs loaded.';

        const logContent = [
            '=== Cline Batch Executor Log ===',
            `Timestamp: ${new Date().toISOString()}`,
            `Task: ${taskDescription}`,
            `Duration(s): ${durationSeconds}`,
            `Files: total=${stats.totalFiles}, processed=${stats.processedFiles}, success=${stats.successfulFiles}, failed=${stats.failedFiles}, errors=${stats.errorCount}`,
            '',
            '-- Hook Configs --',
            hookConfigSection,
            '',
            'Log output is appended per task.',
            ''
        ].join('\n');

        await fs.promises.writeFile(logFilePath, logContent);

        return logFilePath;
    } catch (error) {
        console.error(`ログの出力に失敗しました: ${error}`);
        vscode.window.showErrorMessage(`ログの出力に失敗しました: ${error}`);
        return null;
    }
}

async function appendLogSection(logFilePath: string, content: string): Promise<void> {
    await fs.promises.appendFile(logFilePath, `${content}\n`);
}

function buildHookRunBlock(title: string, hookLogs: string[]): string {
    return [
        `-- Hook Runs (${title}) --`,
        formatHookRunSection(hookLogs),
        ''
    ].join('\n');
}

function buildTaskLogBlock(
    fileLabel: string,
    status: 'success' | 'failed',
    messages: ClineMessage[],
    hookLogs: string[],
    stats: BatchProcessingStats
): string {
    return [
        `-- Task Completed --`,
        `Timestamp: ${new Date().toISOString()}`,
        `File: ${fileLabel}`,
        `Status: ${status}`,
        `Files: total=${stats.totalFiles}, processed=${stats.processedFiles}, success=${stats.successfulFiles}, failed=${stats.failedFiles}, errors=${stats.errorCount}`,
        '',
        '-- Hook Runs --',
        formatHookRunSection(hookLogs),
        '',
        '-- Cline Messages --',
        formatMessagesSection(messages),
        ''
    ].join('\n');
}

async function runHooksWithLogging(
    hooks: HookConfig[],
    runAt: HookConfig['runAt'],
    stats: BatchProcessingStats,
    hookLogs: string[],
    fileUri?: vscode.Uri
): Promise<void> {
    const targetHooks = hooks.filter(hook => hook.runAt === runAt);
    const fileLabel = fileUri ? (vscode.workspace.asRelativePath(fileUri, false) || fileUri.fsPath) : '';
    const hookNames = targetHooks.length > 0
        ? targetHooks.map(hook => hook.name || '(no name)').join(', ')
        : 'no hooks';

    const prefix = `[${new Date().toISOString()}] ${runAt}${fileLabel ? ` (${fileLabel})` : ''}`;
    hookLogs.push(`${prefix} start: ${hookNames}`);

    try {
        await executeHooks(hooks, runAt, stats, fileUri);
        hookLogs.push(`${prefix} completed`);
    } catch (error) {
        hookLogs.push(`${prefix} failed: ${error}`);
    }
}

// バッチ処理を開始するメイン関数
export async function startBatchProcessing(): Promise<void> {
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

    // ステップ3: タスクの説明を取得（ダイアログ入力 or ファイルから読み込み）
    const taskDescription = await getTaskDescription();
    if (!taskDescription) {
        return; // ユーザーがキャンセルした場合
    }

    // ステップ4: フック設定を読み込み
    const hooks = await loadHookConfigs();
    const hookLogs: string[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const gitAvailable = workspaceRoot ? await isGitRepository(workspaceRoot) : false;

    // ステップ5: 統計情報の初期化
    const stats: BatchProcessingStats = {
        totalFiles: files.length,
        processedFiles: 0,
        successfulFiles: 0,
        failedFiles: 0,
        modifiedFiles: 0, // 実際の実装ではファイル変更を追跡する必要あり
        errorCount: 0,
        startTime: Date.now()
    };

    // ステップ6: ログファイルを作成
    const logFilePath = await createBatchLogFile(hooks, stats, taskDescription);
    let lastHookLogIndex = 0;

    const refreshModifiedFilesCount = async () => {
        if (!gitAvailable || !workspaceRoot) {
            return;
        }
        const gitCount = await getGitModifiedCount(workspaceRoot);
        if (gitCount !== null) {
            stats.modifiedFiles = gitCount;
        }
    };

    // ステップ7: バッチ処理開始前のフックを実行
    await refreshModifiedFilesCount();
    await runHooksWithLogging(hooks, 'beforeBatch', stats, hookLogs);
    if (logFilePath) {
        const hookLogSlice = hookLogs.slice(lastHookLogIndex);
        lastHookLogIndex = hookLogs.length;
        await appendLogSection(logFilePath, buildHookRunBlock('beforeBatch', hookLogSlice));
    }

    // ステップ8: 進捗状況を表示
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
            const fileLabel = relativePath || file.fsPath;
            
            progress.report({
                message: `Processing file ${i + 1} of ${totalFiles}: ${relativePath}`,
                increment: (100 / totalFiles)
            });

            // ファイル処理前のフックを実行
            await refreshModifiedFilesCount();
            await runHooksWithLogging(hooks, 'beforeFile', stats, hookLogs, file);

            let taskStatus: 'success' | 'failed' = 'success';
            try {
                await processFileWithCline(cline, file, taskDescription);
                stats.successfulFiles++;
                vscode.window.showInformationMessage(`Successfully processed: ${fileLabel}`);
            } catch (error) {
                taskStatus = 'failed';
                stats.failedFiles++;
                stats.errorCount++;
                vscode.window.showErrorMessage(`Failed to process ${fileLabel}: ${error}`);
                // エラー発生時のフックを実行
                await refreshModifiedFilesCount();
                await runHooksWithLogging(hooks, 'onError', stats, hookLogs, file);
            }

            stats.processedFiles++;
            
            // ファイル処理後のフックを実行
            await refreshModifiedFilesCount();
            await runHooksWithLogging(hooks, 'afterFile', stats, hookLogs, file);

            if (logFilePath) {
                const messages = await cline.getTaskMessages();
                const hookLogSlice = hookLogs.slice(lastHookLogIndex);
                lastHookLogIndex = hookLogs.length;
                const taskLogBlock = buildTaskLogBlock(fileLabel, taskStatus, messages, hookLogSlice, stats);
                await appendLogSection(logFilePath, taskLogBlock);
            }
        }

        progress.report({ message: 'Batch processing completed!' });
    });

    // ステップ9: 統計情報を更新
    stats.endTime = Date.now();

    // ステップ10: バッチ処理完了後のフックを実行
    await refreshModifiedFilesCount();
    await runHooksWithLogging(hooks, 'afterBatch', stats, hookLogs);
    if (logFilePath) {
        const hookLogSlice = hookLogs.slice(lastHookLogIndex);
        lastHookLogIndex = hookLogs.length;
        await appendLogSection(logFilePath, buildHookRunBlock('afterBatch', hookLogSlice));
        const durationSeconds = stats.endTime
            ? ((stats.endTime - stats.startTime) / 1000).toFixed(2)
            : 'N/A';
        const summaryBlock = [
            '-- Batch Summary --',
            `Timestamp: ${new Date().toISOString()}`,
            `Duration(s): ${durationSeconds}`,
            `Files: total=${stats.totalFiles}, processed=${stats.processedFiles}, success=${stats.successfulFiles}, failed=${stats.failedFiles}, errors=${stats.errorCount}`,
            ''
        ].join('\n');
        await appendLogSection(logFilePath, summaryBlock);
    }

    // ダッシュボードへ結果を通知
    notifyDashboardResult(stats);

    if (logFilePath) {
        vscode.window.showInformationMessage(`バッチ処理のログを出力しました: ${logFilePath}`);
    }

    // ステップ11: 処理結果を表示
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
    vscode.window.showInformationMessage(
        `バッチ処理が完了しました！\n` +
        `処理時間: ${duration}秒\n` +
        `総ファイル数: ${stats.totalFiles}\n` +
        `成功: ${stats.successfulFiles}, 失敗: ${stats.failedFiles}`
    );
}

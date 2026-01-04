import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';
import { TaskConfig } from './interfaces';

// タスクの説明を取得する関数。ユーザーはダイアログ入力またはファイルから読み込みを選択できる
export async function getTaskDescription(): Promise<string | undefined> {
    // 入力方法を選択
    const method = await vscode.window.showQuickPick(
        [
            { label: '📝 ダイアログで入力', description: 'タスクを直接入力します', value: 'dialog' },
            { label: '📄 ファイルから読み込み', description: '用意した設定ファイルからタスクを読み込みます', value: 'file' }
        ],
        {
            placeHolder: 'タスクの入力方法を選択してください',
            title: 'タスク入力方法'
        }
    );

    if (!method) {
        return undefined; // ユーザーがキャンセル
    }

    if (method.value === 'dialog') {
        // ダイアログ入力
        return await vscode.window.showInputBox({
            placeHolder: 'Clineに実行させるタスクを入力してください (例: "コードをリファクタリング", "コメントを追加", "リントエラーを修正")',
            prompt: 'タスク説明',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'タスク説明を入力してください';
                }
                return null;
            }
        });
    } else {
        // ファイルから読み込み
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'タスクファイルを選択',
            filters: {
                'JSONCファイル': ['jsonc', 'json']
            }
        });

        if (!fileUris || fileUris.length === 0) {
            return undefined;
        }

        const fileUri = fileUris[0];
        try {
            // JSONCファイルの処理
            const taskConfig = await loadTaskConfig(fileUri);
            
            // taskSummaryとtaskDescriptionを結合して返す
            const combinedTask = `${taskConfig.taskSummary}\n\n詳細:\n${taskConfig.taskDescription.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
            
            vscode.window.showInformationMessage(`タスク設定を読み込みました: ${taskConfig.taskSummary.substring(0, 50)}...`);
            return combinedTask;
        } catch (error) {
            vscode.window.showErrorMessage(`タスクファイルの読み込みに失敗しました: ${error}`);
            return undefined;
        }
    }
}

// JSONCファイルからタスク設定を読み込む関数
async function loadTaskConfig(fileUri: vscode.Uri): Promise<TaskConfig> {
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const contentString = new TextDecoder('utf-8').decode(fileContent);
    
    // JSONCパーサーを使用してコメント付きJSONを解析
    const parseErrors: jsoncParser.ParseError[] = [];
    const parsed = jsoncParser.parse(contentString, parseErrors, {
        allowTrailingComma: true,
        disallowComments: false
    });

    if (parseErrors.length > 0) {
        const errorMessage = parseErrors.map(error => 
            `Error at offset ${error.offset}: ${jsoncParser.printParseErrorCode(error.error)}`
        ).join('\n');
        throw new Error(`JSONC解析エラー:\n${errorMessage}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('無効なJSONC形式です。オブジェクトである必要があります。');
    }

    const taskConfig = parsed as Partial<TaskConfig>;
    
    // 必須フィールドの検証
    if (!taskConfig.taskSummary || typeof taskConfig.taskSummary !== 'string') {
        throw new Error('"taskSummary" フィールドが必須です（文字列）。');
    }
    
    if (!taskConfig.taskDescription || !Array.isArray(taskConfig.taskDescription)) {
        throw new Error('"taskDescription" フィールドが必須です（文字列の配列）。');
    }
    
    if (!taskConfig.taskDescription.every(item => typeof item === 'string')) {
        throw new Error('"taskDescription" のすべての要素は文字列である必要があります。');
    }

    // filePatternsの検証（存在する場合）
    if (taskConfig.filePatterns !== undefined) {
        if (!Array.isArray(taskConfig.filePatterns)) {
            throw new Error('"filePatterns" は配列である必要があります。');
        }
        if (!taskConfig.filePatterns.every(pattern => typeof pattern === 'string')) {
            throw new Error('"filePatterns" のすべての要素は文字列である必要があります。');
        }
    }

    return {
        taskSummary: taskConfig.taskSummary.trim(),
        taskDescription: taskConfig.taskDescription.map(item => item.trim()),
        filePatterns: taskConfig.filePatterns
    };
}

// サンプルタスクファイルを作成する関数
export async function createSampleTaskFile(fileUri: vscode.Uri): Promise<void> {
    // デフォルトのサンプルタスク内容（新しい形式）
    const sampleContent = `{
  // タスクの概要（短い説明）
  "taskSummary": "コードをリファクタリングして品質を向上",
  
  // タスクの詳細説明（各項目が具体的な指示）
  "taskDescription": [
    "関数名をキャメルケースに統一してください",
    "冗長なコードを削除して簡潔にしてください",
    "未使用の変数やインポートを削除してください",
    "コメントを追加して可読性を向上させてください",
    "型注釈を適切に追加してください"
  ],
  
  // タスクを適用するファイルパターン（オプション）
  "filePatterns": ["*.ts", "*.js"]
}`;

    await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(sampleContent)
    );

    // ファイルを開く
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    vscode.window.showInformationMessage(`タスクファイルを作成しました: ${vscode.workspace.asRelativePath(fileUri)}`);
}

import * as vscode from 'vscode';

// Cline API インターフェース
// Cline拡張機能との通信に使用するAPIの型定義
export interface ClineAPI {
    startNewTask(message: string, images?: string[]): Promise<void>;
    sendMessage(message: string): Promise<void>;
    pressPrimaryButton(): Promise<void>;
    pressSecondaryButton(): Promise<void>;
    getTaskStatus(): Promise<"none" | "active" | "completed" | "cancelled">;
    getTaskMessages(): Promise<ClineMessage[]>;
}

export interface ClineMessage {
	ts: number
	type: "ask" | "say"
	ask?: string
	say?: string
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	commandCompleted?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number]
	modelInfo?: any
}

// フック設定のインターフェース
export interface HookConfig {
    name: string;
    condition?: string;
    command: string;
    runAt: 'beforeBatch' | 'afterBatch' | 'beforeFile' | 'afterFile' | 'onError';
}

export interface BatchProcessingStats {
    totalFiles: number;
    processedFiles: number;
    successfulFiles: number;
    failedFiles: number;
    modifiedFiles: number;
    errorCount: number;
    startTime: number;
    endTime?: number;
}

// タスク設定のインターフェース (.jsoncファイル用)
export interface TaskConfig {
    // タスクの概要（必須、短い説明）
    taskSummary: string;
    
    // タスクの詳細説明（必須、各項目が詳細な指示）
    taskDescription: string[];
    
    // ファイルパターン（オプション）
    filePatterns?: string[];
}

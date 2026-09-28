/** Small capabilities shared by application services and host adapters. */
interface NotificationOptions {
    type?: "info" | "success" | "warning" | "error";
    title?: string;
    autoHide?: boolean;
}

export interface Feedback {
    notify(message: string, options?: NotificationOptions): void;
    reportError(error: unknown, operation: string): void;
}

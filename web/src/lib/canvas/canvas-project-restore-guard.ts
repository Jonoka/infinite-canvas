export type CanvasProjectRestoreInstance = {
    projectId: string;
    token: number;
};

export function createCanvasProjectRestoreGuard() {
    let current: CanvasProjectRestoreInstance | null = null;
    let nextToken = 0;
    return {
        begin(projectId: string): CanvasProjectRestoreInstance {
            current = { projectId, token: ++nextToken };
            return current;
        },
        isCurrent(instance: CanvasProjectRestoreInstance): boolean {
            return current?.projectId === instance.projectId && current.token === instance.token;
        },
        invalidate(instance: CanvasProjectRestoreInstance): void {
            if (current?.projectId === instance.projectId && current.token === instance.token) current = null;
        },
    };
}

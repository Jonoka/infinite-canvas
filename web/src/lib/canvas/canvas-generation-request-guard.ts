export type CanvasGenerationRequestIdentity = {
    controller: AbortController;
    token: object;
};

export const createCanvasGenerationRequestGuard = (
    nodeId: string,
    controller: AbortController,
    requestToken: object,
    projectInstance: object,
    getProjectInstance: () => object,
    requests: ReadonlyMap<string, CanvasGenerationRequestIdentity>,
    nodeExists: (nodeId: string) => boolean,
) => () => {
    const active = requests.get(nodeId);
    return !controller.signal.aborted && getProjectInstance() === projectInstance && active?.controller === controller && active.token === requestToken && nodeExists(nodeId);
};

export function commitCanvasVideoResultIfCurrent<T>(input: { isCurrentRequest: () => boolean; result: T; commit: (result: T) => void }) {
    if (!input.isCurrentRequest()) return false;
    input.commit(input.result);
    return true;
}

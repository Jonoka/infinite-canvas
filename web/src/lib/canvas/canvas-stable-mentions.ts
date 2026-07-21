export type CanvasMentionToken = { type: "text"; value: string } | { type: "reference"; nodeId: string };
export type CanvasMentionKind = "image" | "video" | "audio" | "text";
export type CanvasMentionProjectionInput = { nodeId: string; kind: CanvasMentionKind; text?: string };

export class CanvasMentionResolutionError extends Error {
    constructor(public readonly nodeIds: string[]) {
        super(`无法解析画布引用: ${nodeIds.join(", ")}`);
        this.name = "CanvasMentionResolutionError";
    }
}

const TOKEN_LOOKALIKE = /(@+)\[node:([A-Za-z0-9_-]+)\]/g;
const VALID_NODE_ID = /^[A-Za-z0-9_-]+$/;

function assertValidNodeId(nodeId: string) {
    if (!VALID_NODE_ID.test(nodeId)) throw new CanvasMentionResolutionError([nodeId]);
}

export function parseCanvasMentionTokens(value: string): CanvasMentionToken[] {
    const tokens: CanvasMentionToken[] = [];
    let text = "";
    let lastIndex = 0;
    for (const match of value.matchAll(TOKEN_LOOKALIKE)) {
        text += value.slice(lastIndex, match.index);
        if (match[1].length === 1) {
            if (text) tokens.push({ type: "text", value: text });
            text = "";
            tokens.push({ type: "reference", nodeId: match[2] });
        } else {
            text += `${"@".repeat(match[1].length - 1)}[node:${match[2]}]`;
        }
        lastIndex = (match.index || 0) + match[0].length;
    }
    text += value.slice(lastIndex);
    if (text) tokens.push({ type: "text", value: text });
    return tokens;
}

export function serializeCanvasMentionTokens(tokens: CanvasMentionToken[]) {
    return tokens.map((token) => {
        if (token.type === "text") return escapePastedMentionText(token.value);
        assertValidNodeId(token.nodeId);
        return `@[node:${token.nodeId}]`;
    }).join("");
}

export function escapePastedMentionText(value: string) {
    return value.replace(TOKEN_LOOKALIKE, (match) => `@${match}`);
}

export function projectCanvasMentions(prompt: string, inputs: CanvasMentionProjectionInput[]) {
    inputs.forEach((input) => assertValidNodeId(input.nodeId));
    const tokens = parseCanvasMentionTokens(prompt);
    const hasMentions = tokens.some((token) => token.type === "reference");
    const counts: Record<CanvasMentionKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    if (!hasMentions) return { hasMentions, prompt: tokens.map((token) => token.type === "text" ? token.value : "").join(""), orderedNodeIds: [], counts, textBlocks: [] };

    const duplicateNodeIds = Array.from(new Set(inputs.filter((input, index) => inputs.findIndex((candidate) => candidate.nodeId === input.nodeId) !== index).map((input) => input.nodeId)));
    if (duplicateNodeIds.length) throw new CanvasMentionResolutionError(duplicateNodeIds);
    const inputById = new Map(inputs.map((input) => [input.nodeId, input]));
    const missing = Array.from(new Set(tokens.flatMap((token) => token.type === "reference" && !inputById.has(token.nodeId) ? [token.nodeId] : [])));
    if (missing.length) throw new CanvasMentionResolutionError(missing);

    const labels = new Map<string, string>();
    const orderedNodeIds: string[] = [];
    const textBlocks: string[] = [];
    const projected = tokens.map((token) => {
        if (token.type === "text") return token.value;
        const input = inputById.get(token.nodeId)!;
        let label = labels.get(token.nodeId);
        if (!label) {
            label = `${kindName(input.kind)}${++counts[input.kind]}`;
            labels.set(token.nodeId, label);
            orderedNodeIds.push(token.nodeId);
            if (input.kind === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
        }
        return input.kind === "text" ? `【${label}】` : label;
    }).join("");
    return { hasMentions, prompt: textBlocks.length ? `${projected.trim()}\n\n${textBlocks.join("\n\n")}` : projected, orderedNodeIds, counts, textBlocks };
}

export function serializeTrustedMentionDom(editor: HTMLElement, allowedNodeIds: ReadonlySet<string>) {
    const serialize = (nodes: NodeListOf<ChildNode>): string => Array.from(nodes).map((node) => {
        if (node.nodeType === Node.TEXT_NODE) return escapePastedMentionText(node.textContent || "");
        if (!(node instanceof HTMLElement)) return "";
        const nodeId = node.dataset.referenceNodeId;
        if (nodeId && allowedNodeIds.has(nodeId)) {
            assertValidNodeId(nodeId);
            return `@[node:${nodeId}]`;
        }
        if (node.tagName === "BR") return "\n";
        return serialize(node.childNodes);
    }).join("");
    return serialize(editor.childNodes).replace(/\uFEFF/g, "");
}

export function isSelectionInsideEditor(editor: HTMLElement, selection = window.getSelection()) {
    return Boolean(selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer));
}

export function insertPlainTextAtSelection(editor: HTMLElement, text: string) {
    const selection = window.getSelection();
    if (!isSelectionInsideEditor(editor, selection)) return false;
    const range = selection!.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
    return true;
}

function kindName(kind: CanvasMentionKind) {
    return kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本";
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Button, Image } from "antd";
import { FileText, Image as ImageIcon, Music2, Video, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { insertPlainTextAtSelection, isSelectionInsideEditor, parseCanvasMentionTokens, serializeTrustedMentionDom } from "@/lib/canvas/canvas-stable-mentions";
import { isImeComposing } from "@/lib/keyboard-event";
import type { NodeGenerationInput } from "./canvas-node-generation";

type CanvasConfigComposerProps = {
    value: string;
    inputs: NodeGenerationInput[];
    onChange: (value: string) => void;
    onClose: () => void;
};


type MentionState = {
    query: string;
};


export function CanvasConfigComposer({ value, inputs, onChange, onClose }: CanvasConfigComposerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const tokens = useMemo(() => parseCanvasMentionTokens(value), [value]);
    const referenceById = useMemo(() => new Map(inputs.map((input) => [input.nodeId, input])), [inputs]);
    const trustedNodeIds = useMemo(() => {
        const ids = new Set(referenceById.keys());
        tokens.forEach((token) => {
            if (token.type === "reference") ids.add(token.nodeId);
        });
        return ids;
    }, [referenceById, tokens]);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = (mention.query || "").trim().toLowerCase();
        if (!query) return inputs;
        return inputs.filter((input) => `${resourceLabel(input, inputs)} ${input.title} ${input.text || ""}`.toLowerCase().includes(query));
    }, [inputs, mention]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (document.activeElement === editor && value === lastEmittedRef.current) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const input = referenceById.get(token.nodeId);
            if (input) editor.append(createReferenceChip(input, inputs, theme, setImagePreview));
            else editor.append(createUnresolvedReferenceChip(token.nodeId, theme));
        });
        lastEmittedRef.current = value;
    }, [inputs, referenceById, theme, tokens, value]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        const next = serializeTrustedMentionDom(editor, trustedNodeIds);
        emit(next);
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !inputs.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "" });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (input: NodeGenerationInput) => {
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention(editor);
        const chip = createReferenceChip(input, inputs, theme, setImagePreview);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = isSelectionInsideEditor(editor, selection) ? selection!.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeTrustedMentionDom(editor, trustedNodeIds));
    };

    const handlePlainTextPaste = (event: ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        const editor = editorRef.current;
        if (editor && insertPlainTextAtSelection(editor, event.clipboardData.getData("text/plain"))) syncFromEditor();
    };
    const preventMentionDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={stopCanvasInteraction}
            onPointerDown={stopCanvasInteraction}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                    <div className="shrink-0 text-xs font-semibold">组装提示词</div>
                    <div className="truncate text-[11px] opacity-55">@ 引用已连接资产，发送前按当前连接重新编号</div>
                </div>
                <Button size="small" type="text" className="!h-7 !w-7 !min-w-7 !p-0" icon={<X className="size-3.5" />} onClick={onClose} />
            </div>
            <div className="relative rounded-xl">
                {!value.trim() ? <div className="pointer-events-none absolute left-3 top-2 text-sm leading-7" style={{ color: theme.node.placeholder }}>输入提示词，按 @ 引用连接的图片或文本</div> : null}
                <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="thin-scrollbar min-h-28 w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm leading-7 outline-none"
                    style={{ color: theme.node.text }}
                    onInput={() => {
                        if (!composingRef.current) syncFromEditor();
                    }}
                    onCompositionStart={() => {
                        composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        composingRef.current = false;
                        syncFromEditor();
                    }}
                    onPaste={handlePlainTextPaste}
                    onDrop={preventMentionDrop}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        event.stopPropagation();
                        if (isImeComposing(event)) return;
                        if (mention && candidates.length) {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                setActiveIndex((index) => (index + 1) % candidates.length);
                                return;
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                                return;
                            }
                            if (event.key === "Enter") {
                                event.preventDefault();
                                insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                                return;
                            }
                            if (event.key === "Escape") {
                                event.preventDefault();
                                closeMention();
                                return;
                            }
                        }
                        if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(editorRef.current, event.key, trustedNodeIds)) {
                            event.preventDefault();
                            requestAnimationFrame(syncFromEditor);
                            return;
                        }
                        requestAnimationFrame(syncMention);
                    }}
                    onBlur={() => window.setTimeout(closeMention, 120)}
                />
                {mention && candidates.length ? <MentionMenu inputs={candidates} allInputs={inputs} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null}
            </div>
            {imagePreview ? <Image src={imagePreview} alt="引用图片预览" style={{ display: "none" }} preview={{ visible: true, src: imagePreview, onVisibleChange: (visible) => !visible && setImagePreview(null) }} /> : null}
        </div>
    );

}

function MentionMenu({ inputs, allInputs, activeIndex, theme, onSelect }: { inputs: NodeGenerationInput[]; allInputs: NodeGenerationInput[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (input: NodeGenerationInput) => void }) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, inputs]);

    const selectInput = (input: NodeGenerationInput) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(input);
    };

    return (
        <div className="absolute left-2 top-[calc(100%+6px)] z-[90] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            {inputs.map((input, index) => (
                <button
                    key={input.nodeId}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectInput(input);
                    }}
                >
                    <ResourcePreview input={input} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{resourceLabel(input, allInputs)}</span>
                        <span className="block truncate opacity-65">{input.text || input.title}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

function ResourcePreview({ input }: { input: NodeGenerationInput }) {
    if (input.type === "image" && input.image) return <img src={input.image.dataUrl} alt="" referrerPolicy="no-referrer" className="size-9 rounded-md object-cover" />;
    const Icon = input.type === "audio" ? Music2 : input.type === "video" ? Video : input.type === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(input: NodeGenerationInput, inputs: NodeGenerationInput[], theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (url: string) => void) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.setAttribute("data-reference-node-id", input.nodeId);
    wrapper.className = "mx-px inline-flex h-7 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
    Object.assign(wrapper.style, chipStyle(theme));
    if (input.type === "image" && input.image) {
        const image = document.createElement("img");
        image.src = input.image.dataUrl;
        image.alt = input.title;
        image.referrerPolicy = "no-referrer";
        image.className = "size-6 rounded object-cover";
        wrapper.className = "mx-px inline-flex size-6 items-center justify-center overflow-hidden rounded align-middle";
        wrapper.appendChild(image);
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(input.image?.dataUrl || "");
        });
    } else {
        wrapper.title = input.text || input.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = input.type === "text" ? input.text || input.title : input.title;
        wrapper.appendChild(text);
    }
    return wrapper;
}

function createUnresolvedReferenceChip(nodeId: string, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.setAttribute("data-reference-node-id", nodeId);
    wrapper.className = "mx-px inline-flex h-7 max-w-48 items-center justify-center overflow-hidden rounded-md border border-dashed px-1 text-xs leading-none align-middle";
    Object.assign(wrapper.style, chipStyle(theme));
    wrapper.title = `引用资源不可用：${nodeId}`;
    const text = document.createElement("span");
    text.className = "block truncate opacity-70";
    text.textContent = "资源已删除或未连接";
    wrapper.appendChild(text);
    return wrapper;
}

function removeActiveMention(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || !isSelectionInsideEditor(editor, selection)) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret(editor);
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

function deleteAdjacentReference(editor: HTMLElement | null, key: string, trustedNodeIds: ReadonlySet<string>) {
    const selection = window.getSelection();
    if (!editor || !isSelectionInsideEditor(editor, selection) || !selection?.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    const nodeId = target?.dataset.referenceNodeId;
    if (!target || !nodeId || !trustedNodeIds.has(nodeId) || !editor.contains(target)) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.referenceNodeId ? current : null;
}

function textBeforeCaret(editor?: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const activeEditor = editor || closestEditor(range.startContainer);
    if (!activeEditor || !isSelectionInsideEditor(activeEditor, selection)) return "";
    range.setStart(activeEditor, 0);
    return range.toString();
}

function closestEditor(node: Node): HTMLElement | null {
    const element = node instanceof Element ? node : node.parentElement;
    const editor = element?.closest("[contenteditable='true']");
    return editor instanceof HTMLElement ? editor : null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}


function resourceLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {
    const sameTypeInputs = inputs.filter((item) => item.type === input.type);
    const index = Math.max(0, sameTypeInputs.findIndex((item) => item.nodeId === input.nodeId));
    if (input.type === "image") return `图片${index + 1}`;
    if (input.type === "video") return `视频${index + 1}`;
    if (input.type === "audio") return `音频${index + 1}`;
    return `文本${index + 1}`;
}

function chipStyle(theme: (typeof canvasThemes)[keyof typeof canvasThemes]): CSSProperties {
    return { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text };
}

import { Modal } from "antd";

export type LiteToProConsentInput = {
    failedCount: number;
    fromGroup: string;
    toGroup: string;
    switchesToAuto: boolean;
    cost: { cost: number; group: string } | null;
    pricingAvailable: boolean;
};

type ModalProps = { title: string; content: string; okText?: string; cancelText?: string; onOk: () => void; onCancel: () => void };

export function buildLiteToProConsentCopy(input: LiteToProConsentInput) {
    const route = input.switchesToAuto
        ? `本次将从 ${input.fromGroup} 临时切换到自动分组 ${input.toGroup}`
        : `本次继续保持分组 ${input.fromGroup}，不切换分组`;
    const price = input.pricingAvailable && input.cost
        ? `实时预计费用 $${input.cost.cost.toFixed(2)}（当前实际计价候选分组：${input.cost.group}；仅为估算，最终费用以实际路由为准，不保证路由到该分组）。`
        : "实时价格暂时无法获取；确认后仍可能产生费用。";
    return {
        title: "确认使用 Pro 专业版付费重试",
        content: `${input.failedCount} 张 Lite 图片因资源池耗尽而失败。${route}，仅对这些失败图片使用 Pro 重试。${price} 此授权仅限本次一次性重试，不会修改或保存长期配置。`,
        confirmLabel: "确认使用 Pro 付费重试",
        cancelLabel: "取消，不使用",
    };
}

export function createLiteToProConsentModalAdapter(adapter: { open: (props: ModalProps) => void }) {
    return (input: LiteToProConsentInput) => new Promise<boolean>((resolve) => {
        const copy = buildLiteToProConsentCopy(input);
        let settled = false;
        const finish = (value: boolean) => { if (!settled) { settled = true; resolve(value); } };
        adapter.open({ title: copy.title, content: copy.content, okText: copy.confirmLabel, cancelText: copy.cancelLabel, onOk: () => finish(true), onCancel: () => finish(false) });
    });
}

export const liteToProConsentModalAdapter = {
    open: (props: ModalProps) => { Modal.confirm(props); },
};

export const confirmLiteToProFallback = createLiteToProConsentModalAdapter(liteToProConsentModalAdapter);

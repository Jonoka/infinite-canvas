import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Modal, Popconfirm, Switch, Tabs } from "antd";
import { Download, Puzzle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { installOfficialPlugin, prepareOfficialPlugin, setPluginEnabled, uninstallPlugin, updatePlugin, type PluginInstallCandidate } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, hasUpgrade, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message, modal } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const developmentPlugins = useMemo(() => plugins.filter((item) => item.trust === "development"), [plugins]);
    const unverifiedPlugins = useMemo(() => plugins.filter((item) => item.trust === "legacy-unverified"), [plugins]);

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    // 打开面板时拉取官方清单(仅在尚未加载过时,避免重复请求)
    useEffect(() => {
        if (open && official.length === 0 && !loadingOfficial && !officialError) void loadOfficial();
    }, [open, official.length, loadingOfficial, officialError, loadOfficial]);

    const confirmCandidate = (candidate: PluginInstallCandidate) =>
        new Promise<boolean>((resolve) => {
            const manifest = candidate.manifest;
            modal.confirm({
                title: `确认安装 ${manifest.name}`,
                width: 560,
                okText: "确认安装",
                cancelText: "取消",
                content: (
                    <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt>来源域名</dt>
                        <dd className="break-all">{candidate.sourceDomain}</dd>
                        <dt>插件 ID</dt>
                        <dd>{manifest.id}</dd>
                        <dt>版本</dt>
                        <dd>{manifest.version}</dd>
                        <dt>节点类型</dt>
                        <dd className="break-all">{manifest.nodeTypes.join(", ")}</dd>
                        <dt>权限</dt>
                        <dd>{manifest.permissions.length ? manifest.permissions.join(", ") : "无"}</dd>
                        <dt>SHA-256</dt>
                        <dd className="break-all font-mono">{manifest.sha256}</dd>
                    </dl>
                ),
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const candidate = await prepareOfficialPlugin(entry);
            if (!(await confirmCandidate(candidate))) return;
            const plugin = await installOfficialPlugin(candidate);
            message.success(`已安装 ${plugin.name}`);
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // 已安装插件的操作区:启用开关 +(非本地)更新/卸载
    // upgradable=true 时(远程有更高版本),更新按钮高亮为主色以提示升级
    const installedControls = (record: InstalledPlugin, entry: OfficialPluginEntry, upgradable = false) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), checked ? "已启用" : "已禁用")} />
            {!record.local && (
                <>
                    <Button
                        type={upgradable ? "primary" : "text"}
                        size="small"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        title={upgradable ? "有新版本，点击升级" : "从来源更新"}
                        onClick={() =>
                            runOnPlugin(
                                record,
                                async () => {
                                    const candidate = await prepareOfficialPlugin(entry);
                                    if (await confirmCandidate(candidate)) await updatePlugin(record, candidate);
                                },
                                "已更新",
                            )
                        }
                    />
                    <Popconfirm title="卸载该插件？" okText="卸载" cancelText="取消" onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="卸载" />
                    </Popconfirm>
                </>
            )}
        </>
    );

    // 图标外挂一个绿点(右上角),用于「有可升级版本」的提示。
    // boxShadow 画一圈与卡片同色的描边环,让绿点从图标上「浮起」。
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.node.fill}` }} title="有新版本可升级" />
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // 通用插件行:图标 + 标题(名称 + 版本)+ 描述 + 右侧操作
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    本项目官方插件,来自仓库注册表
                </div>
                <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`} />} onClick={loadOfficial} disabled={loadingOfficial}>
                    刷新
                </Button>
            </div>
            {officialError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    加载失败：{officialError}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint("正在获取官方插件…")
            ) : official.length === 0 ? (
                emptyHint("暂无官方插件")
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {official.map((entry) => {
                        const record = recordById.get(entry.id);
                        // 已安装且远程版本更高 → 显示绿点并高亮升级按钮
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            // 有升级时标题版本展示为「本地 → 远程」,让用户看清升级到哪个版本
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, entry, upgradable)
                            ) : (
                                <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => handleInstallOfficial(entry)}>
                                    安装
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const unverifiedTab = (
        <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">
            {unverifiedPlugins.length === 0
                ? emptyHint("没有遗留记录")
                : unverifiedPlugins.map((record) =>
                      row(
                          record.id,
                          <Puzzle className="size-4" />,
                          record.name,
                          record.version,
                          "未验证，已禁用，仅保留供审计或卸载",
                          <Popconfirm title="删除该遗留记录？" okText="删除" cancelText="取消" onConfirm={() => uninstallPlugin(record.id)}>
                              <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="删除" />
                          </Popconfirm>,
                      ),
                  )}
        </div>
    );

    const developmentTab = (
        <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">
            {developmentPlugins.map((record) =>
                row(
                    record.id,
                    <Puzzle className="size-4" />,
                    record.name,
                    record.version,
                    record.url,
                    <>
                        <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), checked ? "已启用" : "已禁用")} />
                        <Popconfirm title="删除开发插件记录？" okText="删除" cancelText="取消" onConfirm={() => uninstallPlugin(record.id)}>
                            <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="删除" />
                        </Popconfirm>
                    </>,
                ),
            )}
        </div>
    );

    const tabs = [
        { key: "official", label: "官方插件", children: officialTab },
        ...(import.meta.env.DEV && developmentPlugins.length > 0 ? [{ key: "development", label: "本地开发", children: developmentTab }] : []),
        ...(unverifiedPlugins.length > 0 ? [{ key: "legacy", label: "遗留记录", children: unverifiedTab }] : []),
    ];

    return (
        <Modal title="节点插件" open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span>仅可安装官方注册表中经过清单、版本与 SHA-256 验证的插件。</span>
                </div>
                <Tabs defaultActiveKey="official" items={tabs} />
            </div>
        </Modal>
    );
}

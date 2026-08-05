# 便利贴节点插件

Infinite Canvas 画布节点插件:彩色便利贴,可换色、编辑,并演示用 `ctx.applyOps` 衍生一个连到自己的文本节点(节点间交互示例)。

## 构建

```bash
npm install
npm run build      # 产物 dist/sticky-note.js,并同步到 web/public/plugins/sticky-note.js
npm run dev        # watch
```

## 安装

生产环境从「节点插件」→「官方插件」安装并确认清单；`/plugins/sticky-note.js` 仅用于本地开发自动发现。

插件契约见 `plugins/canvas/README.md`。

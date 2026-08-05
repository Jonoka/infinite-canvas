# HTML 节点插件

Infinite Canvas 画布节点插件:用沙箱 iframe 渲染 HTML。源码里的 `{{input}}` 会被替换为上游文本节点内容。

## 构建

```bash
npm install
npm run build      # 产物 dist/html.js,并同步到 web/public/plugins/html.js
npm run dev        # watch
```

## 安装

生产环境从「节点插件」→「官方插件」安装并确认清单；`/plugins/html.js` 仅用于本地开发自动发现。

插件契约见 `plugins/canvas/README.md`。

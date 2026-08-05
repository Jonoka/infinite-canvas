# SVG 节点插件

Infinite Canvas 画布节点插件:编辑与渲染 SVG,无自身内容时自动取上游文本节点里的 SVG 源码。

## 构建

```bash
npm install
npm run build      # 产物 dist/svg.js,并同步到 web/public/plugins/svg.js
npm run dev        # watch
```

## 安装

生产环境从「节点插件」→「官方插件」安装并确认清单；`/plugins/svg.js` 仅用于本地开发自动发现。

插件契约见 `plugins/canvas/README.md`。

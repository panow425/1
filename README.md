# VIVIDSTORM Shopify Smart Filter

这是一个可替代基础付费筛选器的 Shopify 2.0 主题组件，实现了：

- 移动端抽屉筛选
- 多维筛选（直接使用 Shopify `collection.filters`）
- 价格区间筛选
- 已选条件 chips + 一键清空
- 排序联动（`sort_by`）
- 中 / 英 / 日三语文案自动切换（根据 `request.locale.iso_code`）
- 更有活力的交互反馈（按钮动效、chip 悬停、提交按钮动态计数）

## 文件

- `sections/vs-smart-filter.liquid`
- `assets/vs-smart-filter.css`
- `assets/vs-smart-filter.js`

## 安装

1. 将上述 3 个文件放入主题对应目录。
2. 在集合页模板中添加 section：`VIVIDSTORM Smart Filter`。
3. 在 Shopify 后台（Search & Discovery）配置筛选字段（标签、类型、元字段等）。

## 注意

- 本组件依赖 Shopify 原生筛选能力，不需要额外付费 App。
- 若需要无刷新体验，可在后续迭代中加入 Section Rendering / Predictive Filtering。

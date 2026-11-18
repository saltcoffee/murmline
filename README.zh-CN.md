# Murmur

[English](README.md) · [更新记录](CHANGELOG.md)

把 Obsidian 变成自己的私人微博。每条最多 140 字，一天想发多少条都可以。新想法出现在最上方；向下翻阅时，一条细线标出日期的变化。

## 安装

支持桌面端和移动端 Obsidian，最低版本为 **1.8.7**。

1. 打开 [GitHub Releases](https://github.com/saltcoffee/murmur/releases)，从最新版本的附件中下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在仓库中创建 `.obsidian/plugins/murmur/` 文件夹，把这三个文件直接放进去。
3. 重启 Obsidian，打开 **设置 → 第三方插件**，按提示允许使用第三方插件，然后启用 **Murmur**。

## 记录想法

点击侧栏的羽毛图标，或在命令面板中选择 **Murmur: 记录想法**。想更快打开输入框，可以在 **设置 → 快捷键** 中给这条命令绑定快捷键。

写好后点 **发布**。Mac 可按 **⌘ Enter**，Windows 和 Linux 可按 **Ctrl Enter**，单按 Enter 换行。空格和换行都计入 140 字，像 👨‍👩‍👧‍👦 这样的组合表情计为一个字。粘贴的内容超长时可以直接删改。

发布成功后可接着写下一条。切到其他标签页时，草稿会留在原处。关闭时间线标签页或重启 Obsidian 前，记得先发布想保留的内容。

## 回看与删除

向下滚动时间线，点 **加载更早记录** 可继续查看，每次最多加载 50 条。时分和日期分隔跟随设备的当前时区。要删除一条想法，点它右侧的 **更多（⋯）→ 删除**，核对正文后确认。文件按当前仓库的删除设置处理。

## 保存位置与语言

每条想法都是仓库 `Murmur/` 文件夹里的一份 Markdown 文件。停用插件后仍能打开阅读。断网也能发布；仓库已有的同步、备份和共享设置同样适用于这些文件。

界面跟随 Obsidian 的语言设置。选择中文时显示简体中文，其他语言设置显示英文。

## 打赏支持

如果你喜欢 Murmur，欢迎扫码打赏作者。

| 微信支付 | 支付宝 |
| :---: | :---: |
| <img src="assets/donations/wechat-pay.jpg" width="180" alt="微信打赏二维码"> | <img src="assets/donations/alipay.jpg" width="180" alt="支付宝打赏二维码"> |
